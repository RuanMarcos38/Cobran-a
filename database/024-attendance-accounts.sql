begin;
create table cobranca_private.attendance_accounts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 name text not null check(length(trim(name)) between 1 and 120),sector text not null check(sector in ('collections','commercial')),
 channel text not null check(channel in ('whatsapp','email')),address text not null,cipher text not null,
 members uuid[] not null default '{}',active boolean not null default true,created_at timestamptz not null default now(),
 unique(tenant_id,channel,address),check((channel='email' and address=lower(trim(address))) or (channel='whatsapp' and address ~ '^[1-9][0-9]{11,14}$'))
);
create table cobranca_private.attendance_threads(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),account_id uuid not null references cobranca_private.attendance_accounts(id),
 address text not null,name text not null,subject text not null default '',owner_id uuid references public.cobranca_profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(account_id,address)
);
create table cobranca_private.attendance_messages(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),thread_id uuid not null references cobranca_private.attendance_threads(id),
 nonce uuid not null default gen_random_uuid(),provider_id text,direction text not null check(direction in ('inbound','outbound','note')),
 content text not null check(length(content)<=100000),subject text not null default '',status text not null default 'registered' check(status in ('registered','sending','accepted','unknown','received')),
 actor uuid references public.cobranca_profiles(id),provider_ref text,html text not null default '' check(length(html)<=100000),attachments jsonb not null default '[]' check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=20),created_at timestamptz not null default now(),unique(thread_id,nonce),unique(thread_id,provider_id)
);
create index attendance_threads_account on cobranca_private.attendance_threads(account_id,updated_at desc);
create index attendance_messages_thread on cobranca_private.attendance_messages(thread_id,created_at);
do $$declare tab text;begin foreach tab in array array['attendance_accounts','attendance_threads','attendance_messages'] loop
 execute format('alter table cobranca_private.%I enable row level security',tab);
 execute format('revoke all on cobranca_private.%I from public,anon,authenticated',tab);
 execute format('create policy deny_direct on cobranca_private.%I to anon,authenticated using(false) with check(false)',tab);
end loop;end$$;
create function cobranca_private.attendance_allowed(p public.cobranca_profiles,a cobranca_private.attendance_accounts) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p.active and a.active and p.tenant_id=a.tenant_id and (p.role in ('admin','master') or (p.id=any(a.members) and ((a.sector='commercial' and p.role in ('commercial','commercial_manager')) or (a.sector='collections' and p.role in ('collector','supervisor','finance'))))),false)
$$;
revoke all on function cobranca_private.attendance_allowed(public.cobranca_profiles,cobranca_private.attendance_accounts) from public,anon,authenticated;
create function cobranca_private.attendance(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;a cobranca_private.attendance_accounts;t cobranca_private.attendance_threads;m cobranca_private.attendance_messages;ident uuid;members uuid[];result jsonb;item jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;
 if action='accounts' then
  return jsonb_build_object('admin',p.role in ('admin','master'),'manager',p.role in ('admin','master','supervisor','commercial_manager'),'accounts',coalesce((select jsonb_agg(to_jsonb(x)-'cipher' order by x.sector,x.name) from cobranca_private.attendance_accounts x where cobranca_private.attendance_allowed(p,x)),'[]'),'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role)) from public.cobranca_profiles where tenant_id=p.tenant_id and active and (p.role in ('admin','master') or id in (select unnest(x.members) from cobranca_private.attendance_accounts x where cobranca_private.attendance_allowed(p,x)))),'[]'));
 elsif action='account_save' then
  if p.role not in ('admin','master') then raise exception 'Administrador necessário';end if;
  select coalesce(array_agg(distinct value::uuid),'{}') into members from jsonb_array_elements_text(coalesce(payload->'members','[]'));
  if exists(select 1 from unnest(members) member where not exists(select 1 from public.cobranca_profiles where id=member and tenant_id=p.tenant_id and active and ((payload->>'sector'='commercial' and role in ('commercial','commercial_manager')) or (payload->>'sector'='collections' and role in ('collector','supervisor','finance'))))) then raise exception 'Usuários devem pertencer ao setor da conta';end if;
  ident:=(payload->>'id')::uuid;
  if ident is null or length(coalesce(payload->>'cipher','')) not between 20 and 16000 then raise exception 'Configuração protegida inválida';end if;
  select * into a from cobranca_private.attendance_accounts where id=ident for update;
  if found and (a.tenant_id<>p.tenant_id or a.channel is distinct from payload->>'channel' or a.sector is distinct from payload->>'sector' or a.address is distinct from payload->>'address') then raise exception 'Crie uma nova conta para outro número, canal ou setor';end if;
  if exists(select 1 from unnest(members) member join cobranca_private.attendance_accounts other on member=any(other.members) where other.tenant_id=p.tenant_id and other.active and other.sector<>payload->>'sector') then raise exception 'Um atendente não pode participar de setores diferentes';end if;
  if length(trim(coalesce(payload->>'name',''))) not between 1 and 120 or payload->>'channel' not in ('whatsapp','email') or payload->>'sector' not in ('commercial','collections') or length(coalesce(payload->>'address','')) not between 3 and 254 then raise exception 'Nome, setor, canal ou endereço inválidos';end if;
  if exists(select 1 from cobranca_private.attendance_accounts where tenant_id=p.tenant_id and channel=payload->>'channel' and address=payload->>'address' and id<>ident) then raise exception 'Esta conta já está cadastrada';end if;
  if payload->>'validate_only'='true' then return jsonb_build_object('valid',true);end if;
  insert into cobranca_private.attendance_accounts(id,tenant_id,name,sector,channel,address,cipher,members) values(ident,p.tenant_id,payload->>'name',payload->>'sector',payload->>'channel',payload->>'address',payload->>'cipher',members) on conflict(id) do update set name=excluded.name,cipher=excluded.cipher,members=excluded.members;
  perform cobranca_private.audit(p.tenant_id,'attendance_account_save','attendance_accounts',ident,null,payload-'cipher');return jsonb_build_object('saved',true,'id',ident);
 end if;
 if action in ('thread_messages','thread_assign','message_prepare','message_claim','message_finish') then
  select * into t from cobranca_private.attendance_threads where id=(payload->>'thread_id')::uuid and tenant_id=p.tenant_id;
  select * into a from cobranca_private.attendance_accounts where id=t.account_id;
 else select * into a from cobranca_private.attendance_accounts where id=(payload->>'account_id')::uuid;end if;
 if not cobranca_private.attendance_allowed(p,a) then raise exception 'Conta de atendimento não autorizada';end if;
 if t.id is not null and p.role not in ('admin','master','supervisor','commercial_manager') and t.owner_id is distinct from p.id then raise exception 'Atendimento reservado a outro responsável';end if;
 if action='account_secret' then return to_jsonb(a); -- Only encrypted data; server owns the key.
 elsif action='threads' then return coalesce((select jsonb_agg(to_jsonb(x) order by updated_at desc) from cobranca_private.attendance_threads x where account_id=a.id and (p.role in ('admin','master','supervisor','commercial_manager') or owner_id=p.id)),'[]');
 elsif action='thread_open' then
  payload:=jsonb_set(payload,'{address}',to_jsonb(case when a.channel='email' then lower(trim(payload->>'address')) else regexp_replace(payload->>'address','[^0-9]','','g') end));
  if length(trim(coalesce(payload->>'address',''))) not between 3 and 254 or length(trim(coalesce(payload->>'name',''))) not between 1 and 250 then raise exception 'Informe nome e destinatário';end if;
  insert into cobranca_private.attendance_threads(tenant_id,account_id,address,name,owner_id) values(p.tenant_id,a.id,payload->>'address',payload->>'name',p.id) on conflict(account_id,address) do nothing;
  select * into t from cobranca_private.attendance_threads where account_id=a.id and address=payload->>'address';
  if p.role not in ('admin','master','supervisor','commercial_manager') and t.owner_id is distinct from p.id then raise exception 'Contato já atendido por outro responsável';end if;
  return to_jsonb(t);
 elsif action='thread_assign' then
  if p.role not in ('admin','master','supervisor','commercial_manager') or nullif(payload->>'owner_id','') is null or not (nullif(payload->>'owner_id','')::uuid=any(a.members)) then raise exception 'Escolha um atendente autorizado desta conta';end if;
  update cobranca_private.attendance_threads set owner_id=(payload->>'owner_id')::uuid where id=t.id;
  perform cobranca_private.audit(p.tenant_id,'attendance_assign','attendance_threads',t.id,jsonb_build_object('owner_id',t.owner_id),jsonb_build_object('owner_id',payload->>'owner_id'));return '{}';
 elsif action='thread_messages' then return jsonb_build_object('thread',to_jsonb(t),'messages',coalesce((select jsonb_agg(to_jsonb(x) order by created_at) from (select * from cobranca_private.attendance_messages where thread_id=t.id order by created_at desc limit 300) x),'[]'));
 elsif action='message_prepare' then
  if length(trim(coalesce(payload->>'content',''))) not between 1 and 100000 or length(coalesce(payload->>'subject',''))>250 then raise exception 'Mensagem vazia ou muito extensa';end if;
  if payload->'attachment' is not null and payload->'attachment'<>'null'::jsonb then
   if coalesce(payload#>>'{attachment,mime}','') not in ('image/png','image/jpeg','application/pdf','text/plain','text/csv','audio/webm','audio/ogg','audio/mpeg','audio/wav') or length(coalesce(payload#>>'{attachment,base64}',''))>6990508 or coalesce(payload#>>'{attachment,base64}','')!~'^[A-Za-z0-9+/]+={0,2}$' or octet_length(decode(payload#>>'{attachment,base64}','base64'))>5242880 or length(coalesce(payload#>>'{attachment,name}','')) not between 1 and 200 then raise exception 'Anexo inválido ou maior que 5 MB';end if;
  end if;
  insert into cobranca_private.attendance_messages(tenant_id,thread_id,nonce,direction,content,subject,actor,attachments) values(p.tenant_id,t.id,(payload->>'nonce')::uuid,case when payload->>'note'='true' then 'note' else 'outbound' end,payload->>'content',coalesce(payload->>'subject',''),p.id,case when jsonb_typeof(payload->'attachment')='object' then jsonb_build_array(payload->'attachment') else '[]'::jsonb end) on conflict(thread_id,nonce) do nothing;
  select * into m from cobranca_private.attendance_messages where thread_id=t.id and nonce=(payload->>'nonce')::uuid;
  if m.content is distinct from payload->>'content' then raise exception 'Identificador já utilizado por outra mensagem';end if;
  update cobranca_private.attendance_threads set updated_at=now() where id=t.id;return to_jsonb(m);
 elsif action='message_claim' then
  update cobranca_private.attendance_messages set status='sending' where id=(payload->>'message_id')::uuid and thread_id=t.id and status='registered' and direction='outbound' returning * into m;
  if not found then raise exception 'Mensagem já enviada ou com envio pendente. Atualize antes de tentar novamente';end if;
  return jsonb_build_object('message',to_jsonb(m),'thread',to_jsonb(t),'account',to_jsonb(a),'reply_to',(select provider_ref from cobranca_private.attendance_messages where thread_id=t.id and direction='inbound' and provider_ref is not null order by created_at desc limit 1));
 elsif action='message_finish' then
  if payload->>'status' not in ('accepted','unknown') then raise exception 'Estado inválido';end if;
  update cobranca_private.attendance_messages set status=payload->>'status',provider_id=nullif(payload->>'provider_id','') where id=(payload->>'message_id')::uuid and thread_id=t.id and status='sending';return '{}';
 elsif action='sync' then
  -- Provider data is inert content. Never executes actions or changes financial records.
  if jsonb_typeof(payload->'messages') is distinct from 'array' or jsonb_array_length(payload->'messages')>100 then raise exception 'Lote inválido';end if;
  for item in select value from jsonb_array_elements(payload->'messages') loop
   if length(coalesce(item->>'provider_id','')) not between 1 and 500 or length(coalesce(item->>'address','')) not between 3 and 254 or length(coalesce(item->>'content',''))>100000 then raise exception 'Mensagem recebida inválida';end if;
   select * into t from cobranca_private.attendance_threads where account_id=a.id and address=item->>'address';
   if p.role not in ('admin','master','supervisor','commercial_manager') and ((t.id is not null and t.owner_id is distinct from p.id) or (t.id is null and coalesce(a.members[1],p.id)<>p.id)) then continue;end if;
   if t.id is null then
    insert into cobranca_private.attendance_threads(tenant_id,account_id,address,name,owner_id) values(p.tenant_id,a.id,item->>'address',coalesce(nullif(item->>'name',''),item->>'address'),coalesce(a.members[1],p.id)) on conflict(account_id,address) do nothing;
    select * into t from cobranca_private.attendance_threads where account_id=a.id and address=item->>'address';
   end if;
   if p.role not in ('admin','master','supervisor','commercial_manager') and t.owner_id is distinct from p.id then continue;end if;
   insert into cobranca_private.attendance_messages(tenant_id,thread_id,provider_id,direction,content,subject,status,html,attachments,provider_ref,created_at) values(p.tenant_id,t.id,item->>'provider_id',case when item->>'from_me'='true' then 'outbound' else 'inbound' end,coalesce(item->>'content',''),coalesce(item->>'subject',''),'received',coalesce(item->>'html',''),coalesce(item->'attachments','[]'),left(item->>'provider_ref',500),coalesce(nullif(item->>'created_at','')::timestamptz,now())) on conflict(thread_id,provider_id) do nothing;
   if found then update cobranca_private.attendance_threads set updated_at=now() where id=t.id;end if;
  end loop;return jsonb_build_object('synced',jsonb_array_length(payload->'messages'));
 end if;
 raise exception 'Operação desconhecida';
end$$;
revoke all on function cobranca_private.attendance(text,jsonb) from public,anon;
grant execute on function cobranca_private.attendance(text,jsonb) to authenticated;
create function public.cobranca_attendance(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.attendance(action,payload)$$;
revoke all on function public.cobranca_attendance(text,jsonb) from public,anon;
grant execute on function public.cobranca_attendance(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

