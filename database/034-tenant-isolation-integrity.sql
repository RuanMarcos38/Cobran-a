-- Additive isolation: no tenant, customer, credential or business rule is rewritten.
begin;
-- Relations must remain within one tenant, even for trusted integrations.
do $migration$
declare r record; index_name text; constraint_name text;
begin
 for r in
  select distinct cn.nspname child_schema,ct.relname child_table,ca.attname child_column,
         pn.nspname parent_schema,pt.relname parent_table,pa.attname parent_column
  from pg_constraint fk
  join pg_class ct on ct.oid=fk.conrelid join pg_namespace cn on cn.oid=ct.relnamespace
  join pg_class pt on pt.oid=fk.confrelid join pg_namespace pn on pn.oid=pt.relnamespace
  join pg_attribute ca on ca.attrelid=ct.oid and ca.attnum=fk.conkey[1]
  join pg_attribute pa on pa.attrelid=pt.oid and pa.attnum=fk.confkey[1]
  where fk.contype='f' and cardinality(fk.conkey)=1 and cardinality(fk.confkey)=1
   and (cn.nspname='cobranca_private' or (cn.nspname='public' and ct.relname like 'cobranca_%'))
   and (pn.nspname='cobranca_private' or (pn.nspname='public' and pt.relname like 'cobranca_%'))
   and ca.attname<>'tenant_id'
   and exists(select 1 from pg_attribute where attrelid=ct.oid and attname='tenant_id' and not attisdropped)
   and exists(select 1 from pg_attribute where attrelid=pt.oid and attname='tenant_id' and not attisdropped)
 loop
  index_name:='tenant_iso_u_'||substr(md5(r.parent_schema||'.'||r.parent_table||'.'||r.parent_column),1,20);
  constraint_name:='tenant_iso_fk_'||substr(md5(r.child_schema||'.'||r.child_table||'.'||r.child_column),1,20);
  execute format('create unique index if not exists %I on %I.%I (tenant_id,%I)',index_name,r.parent_schema,r.parent_table,r.parent_column);
  if not exists(select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where c.conname=constraint_name and n.nspname=r.child_schema and t.relname=r.child_table) then
   execute format('alter table %I.%I add constraint %I foreign key (tenant_id,%I) references %I.%I(tenant_id,%I) not valid',r.child_schema,r.child_table,constraint_name,r.child_column,r.parent_schema,r.parent_table,r.parent_column);
  end if;
  execute format('alter table %I.%I validate constraint %I',r.child_schema,r.child_table,constraint_name);
 end loop;
end$migration$;

create or replace function cobranca_private.tenant_ownership_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.tenant_id is distinct from old.tenant_id then
  raise exception using errcode='23514',message='Não é permitido transferir registros entre empresas';
 end if;
 return new;
end$$;
revoke all on function cobranca_private.tenant_ownership_guard() from public,anon,authenticated;
do $$declare r record;begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind='r' and (n.nspname='cobranca_private' or (n.nspname='public' and c.relname like 'cobranca_%'))
 and exists(select 1 from pg_attribute where attrelid=c.oid and attname='tenant_id' and not attisdropped)
 loop
  execute format('create trigger tenant_ownership_guard before update of tenant_id on %I.%I for each row execute function cobranca_private.tenant_ownership_guard()',r.nspname,r.relname);
 end loop;
end$$;

-- Arrays have no ordinary foreign keys: validate every authorized member.
create or replace function cobranca_private.tenant_members_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from unnest(new.members) member where not exists(select 1 from public.cobranca_profiles p where p.id=member and p.tenant_id=new.tenant_id)) then
  raise exception using errcode='23514',message='Os usuários devem pertencer à mesma empresa';
 end if;
 return new;
end$$;
revoke all on function cobranca_private.tenant_members_guard() from public,anon,authenticated;
create trigger tenant_members_guard before insert or update of members,tenant_id on cobranca_private.attendance_accounts for each row execute function cobranca_private.tenant_members_guard();
create trigger tenant_members_guard before insert or update of members,tenant_id on cobranca_private.distribution_rules for each row execute function cobranca_private.tenant_members_guard();

-- This bridge table inherits ownership through its receipt and installment.
create or replace function cobranca_private.tenant_allocation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare receipt_tenant uuid;agreement_tenant uuid;
begin
 select tenant_id into receipt_tenant from public.cobranca_receipts where id=new.receipt_id;
 select a.tenant_id into agreement_tenant from public.cobranca_agreement_installments i join public.cobranca_agreements a on a.id=i.agreement_id where i.id=new.installment_id;
 if receipt_tenant is distinct from agreement_tenant then
  raise exception using errcode='23514',message='Recebimento e parcela devem pertencer à mesma empresa';
 end if;
 return new;
end$$;
revoke all on function cobranca_private.tenant_allocation_guard() from public,anon,authenticated;
create trigger tenant_allocation_guard before insert or update on public.cobranca_payment_allocations for each row execute function cobranca_private.tenant_allocation_guard();

-- Existing deny-by-grant boundary stays in place, with RLS as another layer.
alter table cobranca_private.bootstrap enable row level security;
alter table cobranca_private.invitations enable row level security;
create policy tenant_isolation_deny_direct on cobranca_private.bootstrap to anon,authenticated using(false) with check(false);
create policy tenant_isolation_deny_direct on cobranca_private.invitations to anon,authenticated using(false) with check(false);
notify pgrst,'reload schema';
commit;
