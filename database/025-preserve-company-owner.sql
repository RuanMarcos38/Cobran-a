begin;
-- Preserve existing internal company ownership, including administrator-assigned imports.
create or replace function cobranca_private.assign_automatically() returns trigger language plpgsql security definer set search_path='' as $$
declare r cobranca_private.distribution_rules;chosen uuid;owners integer;company text;
begin
 select * into r from cobranca_private.distribution_rules where tenant_id=new.tenant_id and enabled for update;
 if not found then return new;end if;
 company:=cobranca_private.debtor_identity(new.debtor_id);
 select count(distinct d.assigned_to),(array_agg(d.assigned_to order by d.created_at,d.id))[1] into owners,chosen
 from public.cobranca_debts d join public.cobranca_profiles p on p.id=d.assigned_to and p.active and p.role not in ('commercial','commercial_manager','creditor') and p.tenant_id=new.tenant_id
 where d.tenant_id=new.tenant_id and cobranca_private.debtor_identity(d.debtor_id)=company and d.status not in ('paid','uncollectible','cancelled','canceled');
 if owners>1 then raise exception 'Empresa devedora possui mais de um cobrador. Distribua seus títulos em conjunto antes de importar novos títulos';end if;
 if chosen is null then
  select id into chosen from public.cobranca_profiles where tenant_id=new.tenant_id and active and role='collector' and id=any(r.members) and (r.last_assigned is null or id>r.last_assigned) order by id limit 1;
  if chosen is null then select id into chosen from public.cobranca_profiles where tenant_id=new.tenant_id and active and role='collector' and id=any(r.members) order by id limit 1;end if;
  if chosen is null then raise exception 'Distribuição automática ativa sem negociadores habilitados';end if;
  update cobranca_private.distribution_rules set last_assigned=chosen where tenant_id=new.tenant_id;
 end if;
 new.assigned_to:=chosen;return new;
end$$;
notify pgrst,'reload schema';
commit;
