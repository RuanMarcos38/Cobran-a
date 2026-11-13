begin;
create table cobranca_private.bordero_first_email (
 tenant_id uuid not null, creditor_id uuid not null, debtor_id uuid not null,
 batch_id uuid not null, reserved_at timestamptz not null default now(),
 primary key(tenant_id,creditor_id,debtor_id)
);
alter table cobranca_private.bordero_first_email enable row level security;
revoke all on cobranca_private.bordero_first_email from public,anon,authenticated;
create function cobranca_private.reserve_bordero_first_email(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles; batch uuid:=(payload->>'batch_id')::uuid; result jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','supervisor') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso negado';end if;
 with candidates as (
  select distinct b.id as debtor_id,c.id as creditor_id,b.name,c.name as creditor_name,b.email
  from public.cobranca_debts d
  join public.cobranca_debtors b on b.id=d.debtor_id and b.tenant_id=d.tenant_id and b.creditor_id=d.creditor_id
  join public.cobranca_creditors c on c.id=d.creditor_id and c.tenant_id=d.tenant_id and c.active
  where d.tenant_id=p.tenant_id and d.metadata->>'bordero_id'=batch::text
   and d.created_at >= now()-interval '1 hour'
   and not coalesce(b.opt_out,false) and d.current_amount>0 and d.due_date<(now() at time zone 'America/Sao_Paulo')::date
   and b.email ~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+[.][^[:space:]@<>;,]+$'
   and not exists(select 1 from public.cobranca_debtors other where other.tenant_id=b.tenant_id and lower(trim(other.email))=lower(trim(b.email)) and other.id<>b.id)
 ), claimed as (
  insert into cobranca_private.bordero_first_email(tenant_id,creditor_id,debtor_id,batch_id)
  select p.tenant_id,creditor_id,debtor_id,batch from candidates
  on conflict do nothing returning creditor_id,debtor_id
 )
 select coalesce(jsonb_agg(to_jsonb(candidates)),'[]') into result from candidates join claimed using(creditor_id,debtor_id);
 return result;
end $$;
revoke all on function cobranca_private.reserve_bordero_first_email(jsonb) from public,anon;
grant execute on function cobranca_private.reserve_bordero_first_email(jsonb) to authenticated;
do $route$
declare definition text:=pg_get_functiondef('public.cobranca_app(text,jsonb)'::regprocedure);
begin
 if position('select case' in definition)=0 then raise exception 'Roteador inesperado';end if;
 execute replace(definition,'select case','select case when action=''reserve_bordero_first_email'' then cobranca_private.reserve_bordero_first_email(payload)');
end $route$;
notify pgrst,'reload schema';
commit;
