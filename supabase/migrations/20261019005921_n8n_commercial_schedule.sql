-- Additive scheduling integration. Existing appointments and financial rules are preserved.
begin;
create table cobranca_private.schedule_connections (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null unique references public.cobranca_tenants(id),
 name text not null,owner_id uuid not null references public.cobranca_profiles(id),token_hash text not null,
 active boolean not null default true,last_received_at timestamptz,created_at timestamptz not null default now()
);
create table cobranca_private.schedule_events (
 id uuid primary key default gen_random_uuid(),connection_id uuid not null references cobranca_private.schedule_connections(id),
 tenant_id uuid not null references public.cobranca_tenants(id),event_id text not null,payload_hash text not null,
 result jsonb not null,created_at timestamptz not null default now(),unique(connection_id,event_id)
);
alter table cobranca_private.schedule_connections enable row level security;
alter table cobranca_private.schedule_events enable row level security;
create policy schedule_connections_deny on cobranca_private.schedule_connections as restrictive for all to anon,authenticated using(false) with check(false);
create policy schedule_events_deny on cobranca_private.schedule_events as restrictive for all to anon,authenticated using(false) with check(false);
revoke all on cobranca_private.schedule_connections,cobranca_private.schedule_events from public,anon,authenticated;
alter table cobranca_private.crm_tasks
 add column end_at timestamptz,
 add column company text not null default '',add column contact_name text not null default '',
 add column contact_email text not null default '',add column contact_phone text not null default '',
 add column meeting_url text not null default '',add column notes text not null default '',
 add column source text not null default 'manual',add column version integer not null default 1,
 add column updated_at timestamptz not null default now(),
 add column connection_id uuid references cobranca_private.schedule_connections(id),add column external_id text,
 add column sync_revision integer not null default 0;
create unique index crm_task_external on cobranca_private.crm_tasks(connection_id,external_id) where external_id is not null;
create index crm_task_sync on cobranca_private.crm_tasks(tenant_id,owner_id,updated_at,id);

-- All paths, including the legacy manual RPC, share validation, versioning and overlap checks.
create function cobranca_private.schedule_task_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.end_at is null then new.end_at:=new.due_at+interval '30 minutes';end if;
 if new.end_at<=new.due_at or new.end_at>new.due_at+interval '8 hours' then raise exception 'Duração da call deve ser de até 8 horas e maior que zero';end if;
 if length(new.meeting_url)>2000 or (new.meeting_url<>'' and new.meeting_url !~ '^https://[^[:space:]]+$') then raise exception 'Link da reunião deve usar HTTPS';end if;
 if length(new.name)>250 or length(new.company)>250 or length(new.contact_name)>250 or length(new.contact_email)>320 or length(new.contact_phone)>50 or length(new.notes)>5000 then raise exception 'Dados do agendamento excedem o limite';end if;
 if not exists(select 1 from public.cobranca_profiles where id=new.owner_id and tenant_id=new.tenant_id and active and role in ('admin','master','commercial','commercial_manager')) then raise exception 'Responsável comercial inválido';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
 if new.status='Aberto' and exists(select 1 from cobranca_private.crm_tasks t where t.tenant_id=new.tenant_id and t.owner_id=new.owner_id and t.id<>new.id and t.status='Aberto' and t.due_at<new.end_at and coalesce(t.end_at,t.due_at+interval '30 minutes')>new.due_at) then raise exception 'Conflito de horário: o responsável já possui agendamento neste intervalo' using errcode='40001';end if;
 if tg_op='UPDATE' then new.version:=old.version+1;else new.version:=1;end if;
 new.updated_at:=clock_timestamp();return new;
end$$;
revoke all on function cobranca_private.schedule_task_guard() from public,anon,authenticated;
create trigger crm_schedule_guard before insert or update on cobranca_private.crm_tasks for each row execute function cobranca_private.schedule_task_guard();

create function cobranca_private.schedule_config(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;c cobranca_private.schedule_connections;secret text;owner uuid;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Configuração exclusiva do administrador' using errcode='42501';end if;
 if payload->>'operation'='save' then
  owner:=(payload->>'owner_id')::uuid;
  if not exists(select 1 from public.cobranca_profiles where id=owner and tenant_id=p.tenant_id and active and role in ('admin','master','commercial','commercial_manager')) or length(trim(coalesce(payload->>'name',''))) not between 1 and 250 then raise exception 'Nome e responsável comercial obrigatórios';end if;
  -- Rotation cannot silently transfer meetings to a different salesperson.
  if exists(select 1 from cobranca_private.schedule_connections x where x.tenant_id=p.tenant_id and x.owner_id<>owner and exists(select 1 from cobranca_private.crm_tasks t where t.connection_id=x.id)) then raise exception 'Preserve o responsável da conexão que já possui agendamentos';end if;
  secret:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into cobranca_private.schedule_connections(tenant_id,name,owner_id,token_hash) values(p.tenant_id,trim(payload->>'name'),owner,encode(sha256(convert_to(secret,'UTF8')),'hex')) on conflict(tenant_id) do update set name=excluded.name,owner_id=excluded.owner_id,token_hash=excluded.token_hash,active=true returning * into c;
  perform cobranca_private.audit(p.tenant_id,'schedule_connection_rotate','schedule_connections',c.id,null,jsonb_build_object('owner_id',owner));
  return jsonb_build_object('id',c.id,'token',secret);
 elsif payload->>'operation'='disable' then
  update cobranca_private.schedule_connections set active=false where tenant_id=p.tenant_id returning * into c;
  perform cobranca_private.audit(p.tenant_id,'schedule_connection_disable','schedule_connections',c.id,null,'{}');
 elsif coalesce(payload->>'operation','list')<>'list' then raise exception 'Operação inválida';end if;
 return jsonb_build_object('connection',(select to_jsonb(x)-'token_hash' from cobranca_private.schedule_connections x where tenant_id=p.tenant_id),
 'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_profiles where tenant_id=p.tenant_id and active and role in ('admin','master','commercial','commercial_manager')),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(x)) from (select e.event_id,e.result,e.created_at from cobranca_private.schedule_events e where e.tenant_id=p.tenant_id order by e.created_at desc limit 20) x),'[]'));
end$$;
revoke all on function cobranca_private.schedule_config(jsonb) from public,anon;
grant execute on function cobranca_private.schedule_config(jsonb) to authenticated;

create function cobranca_private.schedule_tasks(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;t cobranca_private.crm_tasks;ident uuid;owner uuid;manager boolean;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','commercial','commercial_manager') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Área comercial não autorizada' using errcode='42501';end if;
 manager:=p.role in ('admin','master','commercial_manager');
 if payload->>'operation'='save' then
  owner:=coalesce(nullif(payload->>'owner_id','')::uuid,p.id);ident:=nullif(payload->>'id','')::uuid;
  if not manager and owner<>p.id then raise exception 'Responsável inválido';end if;
  if length(trim(coalesce(payload->>'name',''))) not between 1 and 250 or coalesce(payload->>'status','') not in ('Aberto','Concluído','Cancelado') or coalesce(payload->>'due_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Informe atividade, situação e data com fuso horário';end if;
  if ident is not null then
   select * into t from cobranca_private.crm_tasks where id=ident and tenant_id=p.tenant_id and (manager or owner_id=p.id) for update;
   if not found then raise exception 'Agendamento não encontrado';end if;
   if (payload->>'version')::int is distinct from t.version then raise exception 'Agendamento alterado. Atualize antes de salvar' using errcode='40001';end if;
   if t.connection_id is not null and owner<>t.owner_id then raise exception 'Preserve o responsável da reunião sincronizada';end if;
  end if;
  if nullif(payload->>'opportunity_id','') is not null and not exists(select 1 from cobranca_private.crm_opportunities where id=(payload->>'opportunity_id')::uuid and tenant_id=p.tenant_id and (manager or owner_id=p.id)) then raise exception 'Oportunidade inválida';end if;
  insert into cobranca_private.crm_tasks(id,tenant_id,opportunity_id,name,owner_id,due_at,end_at,status,company,contact_name,contact_email,contact_phone,meeting_url,notes)
  values(coalesce(ident,gen_random_uuid()),p.tenant_id,nullif(payload->>'opportunity_id','')::uuid,trim(payload->>'name'),owner,(payload->>'due_at')::timestamptz,coalesce(nullif(payload->>'end_at','')::timestamptz,(payload->>'due_at')::timestamptz+interval '30 minutes'),payload->>'status',coalesce(payload->>'company',''),coalesce(payload->>'contact_name',''),coalesce(payload->>'contact_email',''),coalesce(payload->>'contact_phone',''),coalesce(payload->>'meeting_url',''),coalesce(payload->>'notes',''))
  on conflict(id) do update set name=excluded.name,owner_id=excluded.owner_id,opportunity_id=excluded.opportunity_id,due_at=excluded.due_at,end_at=excluded.end_at,status=excluded.status,company=excluded.company,contact_name=excluded.contact_name,contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,meeting_url=excluded.meeting_url,notes=excluded.notes returning id into ident;
  perform cobranca_private.audit(p.tenant_id,'crm_task','crm_tasks',ident,to_jsonb(t),payload);
 end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by due_at) from cobranca_private.crm_tasks x where tenant_id=p.tenant_id and (manager or owner_id=p.id)),'[]'));
end$$;
revoke all on function cobranca_private.schedule_tasks(jsonb) from public,anon;
grant execute on function cobranca_private.schedule_tasks(jsonb) to authenticated;

-- The token grants only this connection's commercial calendar, never finance or collections.
create function cobranca_private.schedule_receive(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare c cobranca_private.schedule_connections;t cobranca_private.crm_tasks;e cobranca_private.schedule_events;digest text;result jsonb;start_time timestamptz;end_time timestamptz;revision integer;cursor_at timestamptz;cursor_id uuid;
begin
 if length(coalesce(token,''))<>64 then raise exception 'Credencial inválida' using errcode='28000';end if;
 if jsonb_typeof(payload)<>'object' or octet_length(payload::text)>65536 then raise exception 'Envio inválido ou maior que 64 KB';end if;
 select * into c from cobranca_private.schedule_connections where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and active for update;
 if not found or not exists(select 1 from public.cobranca_tenants where id=c.tenant_id and active) or not exists(select 1 from public.cobranca_profiles where id=c.owner_id and tenant_id=c.tenant_id and active and role in ('admin','master','commercial','commercial_manager')) then raise exception 'Credencial inválida ou conexão desativada' using errcode='28000';end if;
 if payload->>'operation'='health' then return jsonb_build_object('connected',true,'scope','commercial_schedule');end if;
 if payload->>'operation'='lookup' then
  return jsonb_build_object('appointment',(select to_jsonb(x)-'tenant_id' from cobranca_private.crm_tasks x where connection_id=c.id and external_id=payload->>'external_id'));
 elsif payload->>'operation'='list' then
  cursor_at:=coalesce(nullif(payload->>'cursor_at','')::timestamptz,'-infinity');cursor_id:=coalesce(nullif(payload->>'cursor_id','')::uuid,'00000000-0000-0000-0000-000000000000');
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x)-'tenant_id' order by updated_at,id) from (select t.* from cobranca_private.crm_tasks t where tenant_id=c.tenant_id and owner_id=c.owner_id and (updated_at,id)>(cursor_at,cursor_id) order by updated_at,id limit 100) x),'[]'));
 elsif payload->>'operation' is distinct from 'upsert' then raise exception 'Operação inválida';end if;
 if length(trim(coalesce(payload->>'event_id',''))) not between 1 and 150 or length(trim(coalesce(payload->>'external_id',''))) not between 1 and 150 then raise exception 'event_id e external_id obrigatórios';end if;
 digest:=encode(sha256(convert_to((payload-'expected_version')::text,'UTF8')),'hex');
 select * into e from cobranca_private.schedule_events where connection_id=c.id and event_id=payload->>'event_id';
 if found then if e.payload_hash<>digest then raise exception 'Evento repetido com conteúdo diferente' using errcode='40001';end if;return e.result||jsonb_build_object('duplicate',true);end if;
 select * into t from cobranca_private.crm_tasks where connection_id=c.id and external_id=payload->>'external_id' for update;
 revision:=(payload->>'revision')::integer;
 if revision is null or revision<=coalesce(t.sync_revision,0) then raise exception 'Revisão desatualizada' using errcode='40001';end if;
 if t.id is not null and (payload->>'expected_version')::integer is distinct from t.version then raise exception 'Agendamento alterado. Consulte a versão atual antes de sincronizar' using errcode='40001';end if;
 if coalesce(payload->>'status','') not in ('Aberto','Concluído','Cancelado') or length(trim(coalesce(payload->>'name',''))) not between 1 and 250 or coalesce(payload->>'due_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(payload->>'end_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Informe atividade, situação, início e fim com fuso horário';end if;
 start_time:=(payload->>'due_at')::timestamptz;end_time:=(payload->>'end_at')::timestamptz;
 insert into cobranca_private.crm_tasks(id,tenant_id,name,owner_id,due_at,end_at,status,company,contact_name,contact_email,contact_phone,meeting_url,notes,source,connection_id,external_id,sync_revision)
 values(coalesce(t.id,gen_random_uuid()),c.tenant_id,trim(payload->>'name'),c.owner_id,start_time,end_time,payload->>'status',coalesce(payload->>'company',''),coalesce(payload->>'contact_name',''),coalesce(payload->>'contact_email',''),coalesce(payload->>'contact_phone',''),coalesce(payload->>'meeting_url',''),coalesce(payload->>'notes',''),'n8n',c.id,payload->>'external_id',revision)
 on conflict(id) do update set name=excluded.name,due_at=excluded.due_at,end_at=excluded.end_at,status=excluded.status,company=excluded.company,contact_name=excluded.contact_name,contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,meeting_url=excluded.meeting_url,notes=excluded.notes,sync_revision=excluded.sync_revision returning * into t;
 result:=jsonb_build_object('id',t.id,'external_id',t.external_id,'version',t.version,'revision',t.sync_revision,'status',t.status,'due_at',t.due_at,'end_at',t.end_at,'duplicate',false);
 insert into cobranca_private.schedule_events(connection_id,tenant_id,event_id,payload_hash,result) values(c.id,c.tenant_id,payload->>'event_id',digest,result);
 update cobranca_private.schedule_connections set last_received_at=now() where id=c.id;
 perform cobranca_private.audit(c.tenant_id,'schedule_sync','crm_tasks',t.id,null,result);return result;
end$$;
revoke all on function cobranca_private.schedule_receive(text,jsonb) from public;
grant execute on function cobranca_private.schedule_receive(text,jsonb) to anon,authenticated;
create function public.cobranca_schedule(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.schedule_receive(token,payload)$$;
revoke all on function public.cobranca_schedule(text,jsonb) from public;
grant execute on function public.cobranca_schedule(text,jsonb) to anon,authenticated;
create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$
 select case when action='schedule_config' then cobranca_private.schedule_config(payload) when action='crm_tasks' then cobranca_private.schedule_tasks(payload) when action like 'pricing_%' then cobranca_private.pricing(action,payload) when action='detail' then cobranca_private.fee_detail(payload) when action like 'chat_%' then cobranca_private.chat(action,payload) when action='report' then cobranca_private.reports(payload) when action='erp_config' then cobranca_private.erp_config(payload) when action like 'fin_%' then cobranca_private.finance(action,payload) else cobranca_private.api(action,payload) end
$$;
commit;
