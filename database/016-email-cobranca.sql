begin;
-- Extensão independente: não substitui a API, tabelas ou regras financeiras existentes.
create table if not exists cobranca_private.email_config (
 tenant_id uuid primary key references public.cobranca_tenants(id),
 cipher text not null, updated_by uuid not null, updated_at timestamptz not null default now()
);
create table if not exists cobranca_private.email_dispatch (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 debt_id uuid not null references public.cobranca_debts(id),actor uuid not null,
 snapshot jsonb not null,message jsonb not null,hash text not null,
 status text not null default 'previa',claim uuid,created_at timestamptz not null default now(),sent_at timestamptz
);
create index if not exists email_dispatch_debt on cobranca_private.email_dispatch(tenant_id,debt_id,created_at);
alter table cobranca_private.email_config enable row level security;
alter table cobranca_private.email_dispatch enable row level security;
revoke all on cobranca_private.email_config,cobranca_private.email_dispatch from public,anon,authenticated;

create or replace function cobranca_private.email_context(ident uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;d public.cobranca_debts;b public.cobranca_debtors;c public.cobranca_creditors;q jsonb;s jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','supervisor','collector','finance') then raise exception 'Acesso de cobrança necessário';end if;
 if not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Assessoria inativa';end if;
 select * into d from public.cobranca_debts where id=ident;
 if not found or not cobranca_private.can_read_debt(p,d) then raise exception 'Processo não encontrado';end if;
 select * into b from public.cobranca_debtors where id=d.debtor_id and tenant_id=p.tenant_id;
 select * into c from public.cobranca_creditors where id=d.creditor_id and tenant_id=p.tenant_id;
 q:=cobranca_private.financial_quote(d);
 s:=jsonb_build_object('process',to_jsonb(d),'debtor',jsonb_build_object('id',b.id,'name',b.name,'email',b.email,'active',coalesce((b.metadata->>'active')::boolean,true),'opt_out',b.opt_out,'dispute_status',b.dispute_status,'human_required',b.human_required),'creditor',jsonb_build_object('id',c.id,'name',c.name,'active',c.active),'amount',q->'total','as_of',q->'as_of','agency',(select name from public.cobranca_tenants where id=p.tenant_id));
 return s||jsonb_build_object('snapshot',s,'profile',to_jsonb(p)||jsonb_build_object('tenant_name',s->>'agency'));
end $$;
revoke all on function cobranca_private.email_context(uuid) from public,anon,authenticated;

create or replace function cobranca_private.email_api(action text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;ctx jsonb;r cobranca_private.email_dispatch;ident uuid;cfg text;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','supervisor','collector','finance') then raise exception 'Acesso de cobrança necessário';end if;
 if not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Assessoria inativa';end if;
 if action='config' then
  select cipher into cfg from cobranca_private.email_config where tenant_id=p.tenant_id;
  return jsonb_build_object('cipher',cfg);
 elsif action='config_save' then
  if p.role not in ('admin','master') or length(coalesce(payload->>'cipher','')) not between 20 and 4000 then raise exception 'Configuração não autorizada';end if;
  insert into cobranca_private.email_config(tenant_id,cipher,updated_by) values(p.tenant_id,payload->>'cipher',p.id)
   on conflict(tenant_id) do update set cipher=excluded.cipher,updated_by=p.id,updated_at=now();
  perform cobranca_private.audit(p.tenant_id,'email_configure','tenants',p.tenant_id,null,jsonb_build_object('sender','cobranca@rrestrategiaperformance.com.br'));
  return jsonb_build_object('ok',true);
 end if;
 ident:=(payload->>'id')::uuid;
 -- Serialize the claim with financial/status changes on the same process.
 perform 1 from public.cobranca_debts where id=ident for update;
 ctx:=cobranca_private.email_context(ident);
 if action='context' then return ctx;end if;
 if action='history' then return jsonb_build_object('rows',coalesce((select jsonb_agg(x order by x.created_at desc) from (select id,status,message->>'to' recipient,message->>'subject' subject,message->>'template' template,actor,created_at,sent_at from cobranca_private.email_dispatch where tenant_id=p.tenant_id and debt_id=ident order by created_at desc limit 30)x),'[]'));end if;
 if action='prepare' then
  if payload->'snapshot' is distinct from ctx->'snapshot' then raise exception 'Dados alterados. Gere nova prévia';end if;
  if jsonb_typeof(payload->'message')<>'object' or length(coalesce(payload->'message'->>'text','')) not between 1 and 15000 or length(coalesce(payload->'message'->>'subject','')) not between 1 and 500 or length(coalesce(payload->>'hash',''))<>64 then raise exception 'Mensagem inválida';end if;
  if payload->'message'->>'to' is distinct from ctx->'debtor'->>'email' then raise exception 'Destinatário não corresponde ao devedor';end if;
  if coalesce((payload->'message'->>'legal')::boolean,false) and (p.role not in ('admin','master') or length(trim(coalesce(payload->'message'->>'approval','')))<10) then raise exception 'Aprovação jurídica obrigatória';end if;
  insert into cobranca_private.email_dispatch(tenant_id,debt_id,actor,snapshot,message,hash) values(p.tenant_id,ident,p.id,ctx->'snapshot',payload->'message',payload->>'hash') returning * into r;
  return jsonb_build_object('preview_id',r.id,'expires_at',r.created_at+interval '15 minutes');
 end if;
 select * into r from cobranca_private.email_dispatch where id=(payload->>'preview_id')::uuid and tenant_id=p.tenant_id and debt_id=ident and actor=p.id for update;
 if not found then raise exception 'Prévia não encontrada para este operador';end if;
 if action='draft' then return jsonb_build_object('message',r.message,'hash',r.hash);end if;
 if action='claim' then
  if r.status<>'previa' or r.created_at<now()-interval '15 minutes' then raise exception 'Prévia utilizada ou expirada. Consulte o histórico';end if;
  if r.snapshot is distinct from ctx->'snapshot' or r.hash is distinct from payload->>'hash' then raise exception 'Dados alterados. Gere nova prévia';end if;
  if ctx->'process'->>'status' in ('paid','cancelled','canceled','disputed','uncollectible','legal_review') or ctx->'process'->>'app_status' in ('Quitado','Suspenso','Devolvido ao cliente','Encerrado') or coalesce((ctx->>'amount')::numeric,0)<=0 or coalesce((ctx->'debtor'->>'opt_out')::boolean,true) or ctx->'debtor'->>'dispute_status'='open' then raise exception 'Cobrança bloqueada';end if;
  if exists(select 1 from cobranca_private.email_dispatch where tenant_id=p.tenant_id and debt_id=ident and status in ('enviando','aceito_smtp','incerto') and created_at>now()-interval '24 hours') then raise exception 'Já existe envio ou tentativa pendente nas últimas 24 horas. Confira o histórico';end if;
  update cobranca_private.email_dispatch set status='enviando',claim=gen_random_uuid() where id=r.id returning * into r;
  insert into public.cobranca_interaction_logs(tenant_id,creditor_id,debtor_id,debt_id,channel,direction,status,subject,content,payload)
  values(p.tenant_id,(ctx->'creditor'->>'id')::uuid,(ctx->'debtor'->>'id')::uuid,ident,'email','outbound','pending',r.message->>'subject',r.message->>'text',jsonb_build_object('actor',p.id,'email_dispatch_id',r.id,'template',r.message->>'template','approval',r.message->>'approval','sender','cobranca@rrestrategiaperformance.com.br'));
  return jsonb_build_object('id',r.id,'claim',r.claim);
 elsif action='finish' then
  if r.status<>'enviando' or r.claim is distinct from (payload->>'claim')::uuid or payload->>'status' not in ('aceito_smtp','incerto') then raise exception 'Atualização de envio inválida';end if;
  update cobranca_private.email_dispatch set status=payload->>'status',sent_at=now() where id=r.id;
  update public.cobranca_interaction_logs set status=case when email_api.payload->>'status'='aceito_smtp' then 'accepted' else 'unknown' end,provider_message_id='<'||r.id||'@rrestrategiaperformance.com.br>',payload=public.cobranca_interaction_logs.payload||jsonb_build_object('smtp_status',email_api.payload->>'status') where debt_id=ident and tenant_id=p.tenant_id and public.cobranca_interaction_logs.payload->>'email_dispatch_id'=r.id::text;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Operação de email inválida';
end $$;
revoke all on function cobranca_private.email_api(text,jsonb) from public,anon;
grant execute on function cobranca_private.email_api(text,jsonb) to authenticated;
create or replace function public.cobranca_email(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.email_api(action,payload)$$;
revoke all on function public.cobranca_email(text,jsonb) from public,anon;
grant execute on function public.cobranca_email(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
