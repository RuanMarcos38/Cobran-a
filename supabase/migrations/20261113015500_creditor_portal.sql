begin;
create table if not exists cobranca_private.creditor_messages (
 id bigint generated always as identity primary key,
 tenant_id uuid not null,
 creditor_id uuid not null,
 sender_id uuid not null,
 sender_name text not null,
 staff boolean not null,
 body text not null check (length(body) between 1 and 2000),
 created_at timestamptz not null default now()
);
alter table cobranca_private.creditor_messages enable row level security;
revoke all on cobranca_private.creditor_messages from public,anon,authenticated;
create index if not exists creditor_messages_thread on cobranca_private.creditor_messages(tenant_id,creditor_id,id desc);
create or replace function cobranca_private.creditor_portal(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles; c public.cobranca_creditors; summary jsonb; terms jsonb; owner_id uuid; body_text text;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso negado'; end if;
 if p.role='creditor' then
  owner_id:=p.creditor_id;
 elsif p.role in ('admin','master') then
  owner_id:=nullif(payload->>'creditor_id','')::uuid;
 else raise exception 'Acesso negado'; end if;
 if p.role='creditor' and not coalesce((p.client_access->>'processes')::boolean,false) then raise exception 'Consulta não autorizada'; end if;
 select * into c from public.cobranca_creditors where id=owner_id and tenant_id=p.tenant_id;
 if not found then raise exception 'Credor não encontrado'; end if;
 if action='creditor_portal_summary' then
  summary:=cobranca_private.registry_safety('creditor_dashboard',payload);
  terms:=to_jsonb(c);
  return summary||jsonb_build_object('capital',(select coalesce(sum(d.original_amount),0) from public.cobranca_debts d where d.tenant_id=p.tenant_id and d.creditor_id=c.id),
   'fee_percent',coalesce(terms->'fee_percent',terms->'billing_policy'->'fee_percent'),
   'agreements_total',(select count(*) from public.cobranca_agreements a join public.cobranca_debts d on d.id=a.debt_id where a.tenant_id=p.tenant_id and d.tenant_id=p.tenant_id and d.creditor_id=c.id),
   'recent_contacts',case when p.role<>'creditor' or coalesce((p.client_access->>'history')::boolean,false) then coalesce((
    select jsonb_agg(to_jsonb(log) order by log.created_at desc,log.id desc) from (
     select l.id,l.created_at,l.channel,l.subject,l.content,b.name as debtor_name
     from public.cobranca_interaction_logs l left join public.cobranca_debtors b on b.id=l.debtor_id and b.tenant_id=p.tenant_id and b.creditor_id=c.id
     where l.tenant_id=p.tenant_id and l.creditor_id=c.id and l.direction in ('inbound','outbound')
      and (l.debtor_id is null or b.id is not null)
      and (l.debt_id is null or exists(select 1 from public.cobranca_debts d where d.id=l.debt_id and d.tenant_id=p.tenant_id and d.creditor_id=c.id))
     order by l.created_at desc,l.id desc limit 20
    ) log),'[]'::jsonb) else null end);
 elsif action='creditor_portal_send' then
  body_text:=trim(coalesce(payload->>'body',''));
  if length(body_text) not between 1 and 2000 then raise exception 'Informe uma mensagem de até 2.000 caracteres'; end if;
  insert into cobranca_private.creditor_messages(tenant_id,creditor_id,sender_id,sender_name,staff,body)
  values(p.tenant_id,c.id,p.id,coalesce(p.name,'Usuário'),p.role<>'creditor',body_text);
  return jsonb_build_object('sent',true);
 elsif action='creditor_portal_messages' then
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from
   (select id,sender_name,staff,body,created_at from cobranca_private.creditor_messages where tenant_id=p.tenant_id and creditor_id=c.id order by id desc limit 100) m),'[]'::jsonb);
 end if;
 raise exception 'Ação não disponível';
end $$;
revoke all on function cobranca_private.creditor_portal(text,jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.creditor_portal(text,jsonb) to authenticated;
do $route$
declare definition text := pg_get_functiondef('public.cobranca_app(text,jsonb)'::regprocedure);
begin
 if position('creditor_portal_summary' in definition)=0 then
  if position('select case' in definition)=0 then raise exception 'Roteador inesperado'; end if;
  execute replace(definition,'select case','select case when action in (''creditor_portal_summary'',''creditor_portal_send'',''creditor_portal_messages'') then cobranca_private.creditor_portal(action,payload)');
 end if;
end $route$;
notify pgrst,'reload schema';
commit;
