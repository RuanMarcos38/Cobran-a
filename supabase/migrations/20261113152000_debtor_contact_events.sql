begin;
create table cobranca_private.debtor_contact_events (
 id bigint generated always as identity primary key,
 tenant_id uuid not null,
 creditor_id uuid not null,
 debtor_id uuid not null,
 actor_id uuid not null,
 actor_name text not null,
 occurred_at timestamptz not null,
 created_at timestamptz not null default now(),
 channel text not null check (channel in ('Ligação','E-mail','WhatsApp','Outro')),
 outcome text not null check (outcome in ('Sem resposta','Contato efetivo','Retorno combinado','Promessa de pagamento','Contato inválido')),
 note text not null check (char_length(note) between 1 and 2000),
 shared boolean not null default false
);
alter table cobranca_private.debtor_contact_events enable row level security;
revoke all on cobranca_private.debtor_contact_events from public,anon,authenticated;
create index on cobranca_private.debtor_contact_events(tenant_id,creditor_id,debtor_id,occurred_at desc,id desc);
create function cobranca_private.debtor_contact_events(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles; b public.cobranca_debtors; portfolio uuid; debtor uuid; base jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso negado'; end if;
 if action='creditor_portal_summary' then
  base:=cobranca_private.creditor_portal(action,payload);
  if p.role='creditor' and not coalesce((p.client_access->>'history')::boolean,false) then return base; end if;
  portfolio:=case when p.role='creditor' then p.creditor_id else (payload->>'creditor_id')::uuid end;
 else
  select * into b from public.cobranca_debtors where id=(payload->>'id')::uuid and tenant_id=p.tenant_id;
  if not found or b.creditor_id is null then raise exception 'Cadastro indisponível'; end if;
  portfolio:=b.creditor_id;
  debtor:=b.id;
  if p.role='creditor' then
   if portfolio is distinct from p.creditor_id or not coalesce((p.client_access->>'processes')::boolean,false) or not coalesce((p.client_access->>'history')::boolean,false) or action<>'debtor_contact_events' then raise exception 'Histórico não autorizado'; end if;
  elsif p.role not in ('admin','master') then
   if p.role not in ('supervisor','collector') or not exists(select 1 from public.cobranca_debts d where d.debtor_id=b.id and d.tenant_id=b.tenant_id and d.creditor_id=b.creditor_id and cobranca_private.can_read_debt(p,d)) then raise exception 'Histórico não autorizado'; end if;
  end if;
  if action='debtor_contact_event_add' then
   insert into cobranca_private.debtor_contact_events(tenant_id,creditor_id,debtor_id,actor_id,actor_name,occurred_at,channel,outcome,note,shared)
   values(p.tenant_id,portfolio,debtor,p.id,coalesce(p.name,'Usuário'),(payload->>'occurred_at')::timestamptz,payload->>'channel',payload->>'outcome',trim(payload->>'note'),coalesce((payload->>'shared')::boolean,false));
  elsif action<>'debtor_contact_events' then raise exception 'Ação indisponível'; end if;
 end if;
 return coalesce(base,'{}'::jsonb)||(
  with visible as materialized (
   select e.id,e.occurred_at,e.created_at,e.channel,e.outcome,e.note,e.shared,e.actor_name,d.name as debtor_name
   from cobranca_private.debtor_contact_events e
   join public.cobranca_debtors d on d.id=e.debtor_id and d.tenant_id=e.tenant_id and d.creditor_id=e.creditor_id
   where e.tenant_id=p.tenant_id and e.creditor_id=portfolio and (debtor is null or e.debtor_id=debtor)
    and ((p.role<>'creditor' and action<>'creditor_portal_summary') or e.shared)
  )
  select jsonb_build_object('debtor_contacts',jsonb_build_object(
   'attempts',count(*),'effective',count(*) filter (where outcome in ('Contato efetivo','Retorno combinado','Promessa de pagamento')),
   'rows',coalesce((select jsonb_agg(to_jsonb(r) order by occurred_at desc,id desc) from
    (select * from visible order by occurred_at desc,id desc limit 50) r),'[]'::jsonb)))
  from visible
 );
end $$;
revoke all on function cobranca_private.debtor_contact_events(text,jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.debtor_contact_events(text,jsonb) to authenticated;
do $route$
declare definition text:=pg_get_functiondef('public.cobranca_app(text,jsonb)'::regprocedure);
begin
 if position('select case' in definition)=0 then raise exception 'Roteador inesperado';end if;
 execute replace(definition,'select case','select case when action in (''debtor_contact_events'',''debtor_contact_event_add'',''creditor_portal_summary'') then cobranca_private.debtor_contact_events(action,payload)');
end $route$;
notify pgrst,'reload schema';
commit;
