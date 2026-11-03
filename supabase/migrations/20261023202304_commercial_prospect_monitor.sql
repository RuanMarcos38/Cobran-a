begin;
-- Additive commercial queue. The existing calendar token retains its original scope.
create table cobranca_private.prospect_connections (
 tenant_id uuid primary key references public.cobranca_tenants(id),
 owner_id uuid not null references public.cobranca_profiles(id), token_hash text not null,
 account_id uuid not null references cobranca_private.attendance_accounts(id),
 sheet_id text not null check(sheet_id ~ '^[A-Za-z0-9_-]{20,150}$'),
 paused boolean not null default true, last_sync_at timestamptz, updated_at timestamptz not null default now()
);
create table cobranca_private.prospect_leads (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.cobranca_tenants(id),
 owner_id uuid not null references public.cobranca_profiles(id), source_key text not null,
 email text not null, company text not null, document text not null default '', source jsonb not null,
 status text not null default 'pending' check(status in ('pending','ready','sending','accepted','reported','blocked','review','responded')),
 suppressed boolean not null default false, version int not null default 1,
 subject text not null default '', message text not null default '', approved_by uuid references public.cobranca_profiles(id),
 imported_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,source_key), unique(tenant_id,email)
);
create table cobranca_private.prospect_attempts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.cobranca_tenants(id),
 lead_id uuid not null unique references cobranca_private.prospect_leads(id),
 status text not null default 'sending' check(status in ('sending','accepted','unknown','rejected')),
 subject text not null, message text not null, provider_id text, claimed_at timestamptz not null default now(), finished_at timestamptz
);
create index prospect_list on cobranca_private.prospect_leads(tenant_id,owner_id,status,imported_at);
create index prospect_attempt_day on cobranca_private.prospect_attempts(tenant_id,claimed_at desc);
alter table cobranca_private.prospect_connections enable row level security;
alter table cobranca_private.prospect_leads enable row level security;
alter table cobranca_private.prospect_attempts enable row level security;
do $$declare tab text;begin foreach tab in array array['prospect_connections','prospect_leads','prospect_attempts'] loop
 execute format('revoke all on cobranca_private.%I from public,anon,authenticated',tab);
 execute format('create policy deny_direct on cobranca_private.%I to anon,authenticated using(false) with check(false)',tab);
end loop;end$$;

create function cobranca_private.prospect_panel(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;c cobranca_private.prospect_connections;l cobranca_private.prospect_leads;
 secret text; owner uuid; result jsonb; manager boolean; account cobranca_private.attendance_accounts; owner_profile public.cobranca_profiles;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if p.id is null or p.role not in ('admin','master','commercial_manager','commercial') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Área comercial não autorizada';end if;
 manager:=p.role in ('admin','master','commercial_manager');
 select * into c from cobranca_private.prospect_connections where tenant_id=p.tenant_id for update;
 if action='list' then
  select jsonb_build_object('total',count(*),'pending',count(*) filter(where status='pending'),'ready',count(*) filter(where status='ready'),'sending',count(*) filter(where status='sending'),'accepted',count(*) filter(where status='accepted'),'reported',count(*) filter(where status='reported'),'review',count(*) filter(where status='review'),'blocked',count(*) filter(where status='blocked'),'responded',count(*) filter(where status='responded')) into result from cobranca_private.prospect_leads where tenant_id=p.tenant_id and (manager or owner_id=p.id);
  return jsonb_build_object('manager',manager,'admin',p.role in ('admin','master'),'summary',result,'connection',case when c.tenant_id is null then null else to_jsonb(c)-'token_hash' end,
  'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address)) from cobranca_private.attendance_accounts where tenant_id=p.tenant_id and channel='email' and sector='commercial' and active and cobranca_private.attendance_allowed(p,attendance_accounts)),'[]'),
  'users',case when p.role in ('admin','master') then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_profiles where tenant_id=p.tenant_id and active and role in ('admin','master','commercial_manager','commercial')),'[]') else '[]'::jsonb end,
  'rows',coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id) from (
   select q.*,a.id attempt_id,a.status attempt_status,a.provider_id,a.claimed_at,a.finished_at from cobranca_private.prospect_leads q left join cobranca_private.prospect_attempts a on a.lead_id=q.id
   where q.tenant_id=p.tenant_id and (manager or q.owner_id=p.id) and (coalesce(payload->>'status','')='' or q.status=payload->>'status')
    and (coalesce(payload->>'search','')='' or position(lower(left(payload->>'search',150)) in lower(q.company||' '||q.email||' '||q.document))>0)
   order by q.updated_at desc,q.id limit 100 offset least(100000,greatest(0,coalesce((payload->>'offset')::int,0)))
  ) x),'[]'));
 elsif action='configure' then
  if p.role not in ('admin','master') then raise exception 'Administrador necessário';end if;
  owner:=(payload->>'owner_id')::uuid;
  if not exists(select 1 from public.cobranca_profiles where id=owner and tenant_id=p.tenant_id and active and role in ('admin','master','commercial_manager','commercial')) then raise exception 'Responsável comercial inválido';end if;
  select * into owner_profile from public.cobranca_profiles where id=owner;
  select * into account from cobranca_private.attendance_accounts where id=(payload->>'account_id')::uuid and tenant_id=p.tenant_id and active and sector='commercial' and channel='email';
  if account.id is null or not cobranca_private.attendance_allowed(owner_profile,account) then raise exception 'Selecione uma conta de e-mail comercial acessível ao responsável';end if;
  if c.owner_id is not null and c.owner_id<>owner and exists(select 1 from cobranca_private.prospect_leads where tenant_id=p.tenant_id) then raise exception 'Mantenha o responsável da integração existente';end if;
  if c.sheet_id is not null and c.sheet_id<>payload->>'sheet_id' then raise exception 'Mantenha a planilha da integração existente';end if;
  secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into cobranca_private.prospect_connections(tenant_id,owner_id,account_id,sheet_id,token_hash) values(p.tenant_id,owner,account.id,payload->>'sheet_id',encode(sha256(convert_to(secret,'UTF8')),'hex'))
  on conflict(tenant_id) do update set token_hash=excluded.token_hash,account_id=excluded.account_id,paused=true,updated_at=now();
  perform cobranca_private.audit(p.tenant_id,'prospect_connection','prospect_connections',p.tenant_id,null,jsonb_build_object('rotated',true));
  return jsonb_build_object('token',secret,'paused',true);
 elsif action='pause' then
  if not manager or c.tenant_id is null then raise exception 'Gestor comercial necessário';end if;
  update cobranca_private.prospect_connections set paused=coalesce((payload->>'paused')::boolean,true),updated_at=now() where tenant_id=p.tenant_id;
  return jsonb_build_object('saved',true);
 elsif action in ('approve','block') then
  if not manager then raise exception 'Gestor comercial necessário';end if;
  select * into l from cobranca_private.prospect_leads where id=(payload->>'id')::uuid and tenant_id=p.tenant_id for update;
  if l.id is null or l.version is distinct from (payload->>'version')::int then raise exception 'Registro alterado. Atualize o painel' using errcode='40001';end if;
  if action='block' then
   update cobranca_private.prospect_leads set suppressed=true,status=case when status in ('sending','accepted','reported') then status else 'blocked' end,version=version+1,updated_at=now() where id=l.id;
  else
   if l.status<>'pending' or l.suppressed or exists(select 1 from cobranca_private.prospect_attempts where lead_id=l.id) then raise exception 'Lead bloqueado ou já contatado';end if;
   if upper(trim(coalesce(l.source->>'b2b_confirmado','')))<>'SIM' or upper(trim(coalesce(l.source->>'status_email','')))<>'VERIFICADO' or coalesce(l.source->>'fonte_url','') !~ '^https://[^[:space:]]+$' then raise exception 'Confirme B2B, status do e-mail VERIFICADO e fonte HTTPS na planilha antes de aprovar';end if;
   if l.email !~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+$' or length(l.email)>254 then raise exception 'E-mail inválido';end if;
   if length(trim(coalesce(payload->>'subject',''))) not between 1 and 180 or coalesce(payload->>'subject','') ~ '[\r\n]' or length(trim(coalesce(payload->>'message',''))) not between 10 and 20000 then raise exception 'Confira assunto e mensagem';end if;
   if l.document<>'' and exists(select 1 from cobranca_private.prospect_leads where tenant_id=p.tenant_id and id<>l.id and document=l.document and status in ('ready','sending','accepted','reported','review','responded')) then raise exception 'CNPJ já reservado ou contatado';end if;
   update cobranca_private.prospect_leads set status='ready',subject=trim(payload->>'subject'),message=trim(payload->>'message')||E'\n\nR&R Estratégia Performance\ncontato@rrestrategiaperformance.com.br\nSe não deseja receber novos contatos comerciais, responda a este e-mail solicitando a remoção.',approved_by=p.id,version=version+1,updated_at=now() where id=l.id;
  end if;
  perform cobranca_private.audit(p.tenant_id,'prospect_'||action,'prospect_leads',l.id,null,jsonb_build_object('email',l.email));return jsonb_build_object('saved',true);
 end if;
 raise exception 'Operação comercial inválida';
end$$;
revoke all on function cobranca_private.prospect_panel(text,jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.prospect_panel(text,jsonb) to authenticated;
create function public.cobranca_prospect(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.prospect_panel(action,payload)$$;
revoke all on function public.cobranca_prospect(text,jsonb) from public,anon;
grant execute on function public.cobranca_prospect(text,jsonb) to authenticated;

create function cobranca_private.prospect_receive(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c cobranca_private.prospect_connections;l cobranca_private.prospect_leads;a cobranca_private.prospect_attempts;account cobranca_private.attendance_accounts;owner_profile public.cobranca_profiles;
 item jsonb; cleaned jsonb; addr text; doc text; key text; block boolean; contacted boolean; state text; n int:=0; op text:=payload->>'operation';
begin
 if length(coalesce(token,''))<>64 or token !~ '^[a-f0-9]+$' or octet_length(payload::text)>900000 then raise exception 'Integração não autorizada' using errcode='28000';end if;
 select * into c from cobranca_private.prospect_connections where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
 if c.tenant_id is null or not exists(select 1 from public.cobranca_tenants where id=c.tenant_id and active) or not exists(select 1 from public.cobranca_profiles where id=c.owner_id and tenant_id=c.tenant_id and active and role in ('admin','master','commercial_manager','commercial')) then raise exception 'Integração não autorizada' using errcode='28000';end if;
 if op='health' then return jsonb_build_object('connected',true,'scope','commercial_prospection','paused',c.paused);end if;
 if op='sender' then
  select * into owner_profile from public.cobranca_profiles where id=c.owner_id;
  select * into account from cobranca_private.attendance_accounts where id=c.account_id and tenant_id=c.tenant_id and sector='commercial' and channel='email';
  if account.id is null or not cobranca_private.attendance_allowed(owner_profile,account) then raise exception 'Conta comercial indisponível';end if;
  return jsonb_build_object('id',account.id,'tenant_id',account.tenant_id,'cipher',account.cipher,'address',account.address);
 end if;
 if op='mirror' then
  if payload->>'sheet_id' is distinct from c.sheet_id or jsonb_typeof(payload->'rows') is distinct from 'array' or jsonb_array_length(payload->'rows')>500 then raise exception 'Planilha ou lote inválido';end if;
  for item in select value from jsonb_array_elements(payload->'rows') loop
   select coalesce(jsonb_object_agg(k,left(coalesce(item->>k,''),20000)),'{}') into cleaned from unnest(array['empresa','cnpj','dominio','segmento','cidade_uf','email','whatsapp','fonte_url','data_verificacao','b2b_confirmado','justificativa','status_email','status_whatsapp','situacao','data_contato','tentativas','optout','bloqueado','assunto','mensagem']) k;
   addr:=lower(trim(coalesce(item->>'email','')));doc:=regexp_replace(coalesce(item->>'cnpj',''),'[^0-9]','','g');
   if addr='' or length(addr)>254 then continue;end if;
   key:=addr;
   block:=upper(coalesce(item->>'optout',''))='SIM' or upper(coalesce(item->>'bloqueado',''))='SIM' or upper(coalesce(item->>'situacao','')) in ('OPTOUT','OPT_OUT','DESCADASTRADO','BOUNCE','BLOQUEADO') or addr !~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+$';
   contacted:=trim(coalesce(item->>'data_contato',''))<>'' or coalesce(item->>'tentativas','0') !~ '^(0|)$' or upper(coalesce(item->>'status_email','')) in ('ENVIADO','ENVIANDO','ERRO_REVISAO') or upper(coalesce(item->>'situacao','')) in ('CONTATADO','RESPONDEU','AGUARDANDO_HORARIO','REUNIAO_AGENDADA');
   state:=case when block then 'blocked' when upper(coalesce(item->>'status_email',''))='ENVIADO' then 'reported' when contacted then 'review' else 'pending' end;
   insert into cobranca_private.prospect_leads(tenant_id,owner_id,source_key,email,company,document,source,status,suppressed)
   values(c.tenant_id,c.owner_id,key,addr,left(coalesce(nullif(item->>'empresa',''),addr),250),doc,cleaned,state,block)
   on conflict(tenant_id,email) do update set company=excluded.company,document=excluded.document,source=excluded.source,
    suppressed=prospect_leads.suppressed or excluded.suppressed,
    status=case when prospect_leads.status in ('sending','accepted','reported','review','responded') then prospect_leads.status when prospect_leads.suppressed or excluded.suppressed then 'blocked' when excluded.status<>'pending' then excluded.status
     when prospect_leads.status='ready' and (prospect_leads.source->>'b2b_confirmado' is distinct from excluded.source->>'b2b_confirmado' or prospect_leads.source->>'status_email' is distinct from excluded.source->>'status_email' or prospect_leads.source->>'fonte_url' is distinct from excluded.source->>'fonte_url') then 'pending' else prospect_leads.status end,
    version=prospect_leads.version+1,last_seen_at=now(),updated_at=now();n:=n+1;
  end loop;
  update cobranca_private.prospect_connections set last_sync_at=now() where tenant_id=c.tenant_id;return jsonb_build_object('mirrored',n);
 elsif op='claim' then
  if c.paused then return jsonb_build_object('lead',null,'reason','paused');end if;
  if c.last_sync_at is null or c.last_sync_at<now()-interval '20 minutes' then return jsonb_build_object('lead',null,'reason','stale_sheet');end if;
  if exists(select 1 from cobranca_private.prospect_attempts where tenant_id=c.tenant_id and status in ('sending','unknown')) then return jsonb_build_object('lead',null,'reason','review_required');end if;
  if exists(select 1 from cobranca_private.prospect_attempts where tenant_id=c.tenant_id and claimed_at>now()-interval '15 minutes') or exists(select 1 from cobranca_private.prospect_leads where tenant_id=c.tenant_id and nullif(source->>'data_contato','')::timestamptz>now()-interval '15 minutes') or (select count(*) from (
   select q.email from cobranca_private.prospect_attempts attempts join cobranca_private.prospect_leads q on q.id=attempts.lead_id where attempts.tenant_id=c.tenant_id and (attempts.claimed_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date
   union select email from cobranca_private.prospect_leads where tenant_id=c.tenant_id and (nullif(source->>'data_contato','')::timestamptz at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date
  ) daily)>=20 then return jsonb_build_object('lead',null,'reason','rate_limit');end if;
  select * into l from cobranca_private.prospect_leads x where x.tenant_id=c.tenant_id and x.status='ready' and not x.suppressed and x.last_seen_at>now()-interval '20 minutes'
   and not exists(select 1 from cobranca_private.prospect_attempts where lead_id=x.id)
   and (x.document='' or not exists(select 1 from cobranca_private.prospect_leads y where y.tenant_id=c.tenant_id and y.id<>x.id and y.document=x.document and (y.suppressed or y.status in ('sending','accepted','reported','review','responded'))))
   order by x.imported_at,x.id limit 1 for update;
  if l.id is null then return jsonb_build_object('lead',null,'reason','empty');end if;
  insert into cobranca_private.prospect_attempts(tenant_id,lead_id,subject,message) values(c.tenant_id,l.id,l.subject,l.message) returning * into a;
  update cobranca_private.prospect_leads set status='sending',version=version+1,updated_at=now() where id=l.id;
  return jsonb_build_object('lead',jsonb_build_object('id',l.id,'email',l.email,'empresa',l.company,'assunto',a.subject,'mensagem',a.message,'attempt_id',a.id));
 elsif op='finish' then
  select * into a from cobranca_private.prospect_attempts where id=(payload->>'attempt_id')::uuid and tenant_id=c.tenant_id for update;
  if a.id is null or payload->>'status' is null or payload->>'status' not in ('accepted','unknown','rejected') then raise exception 'Resultado inválido';end if;
  if a.status<>'sending' then
   if a.status=payload->>'status' and coalesce(a.provider_id,'')=coalesce(payload->>'provider_id','') then return jsonb_build_object('saved',true,'duplicate',true);end if;raise exception 'Resultado já registrado';
  end if;
  if payload->>'status'='accepted' and length(trim(coalesce(payload->>'provider_id',''))) not between 1 and 500 then raise exception 'Confirmação SMTP obrigatória';end if;
  update cobranca_private.prospect_attempts set status=payload->>'status',provider_id=left(payload->>'provider_id',500),finished_at=now() where id=a.id;
  update cobranca_private.prospect_leads set status=case payload->>'status' when 'accepted' then 'accepted' else 'review' end,version=version+1,updated_at=now() where id=a.lead_id;
  return jsonb_build_object('saved',true);
 end if;
 raise exception 'Operação de prospecção inválida';
end$$;
revoke all on function cobranca_private.prospect_receive(text,jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.prospect_receive(text,jsonb) to anon,authenticated;
create function public.cobranca_prospect_sync(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.prospect_receive(token,payload)$$;
revoke all on function public.cobranca_prospect_sync(text,jsonb) from public;
grant execute on function public.cobranca_prospect_sync(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
