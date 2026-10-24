begin;
create table if not exists cobranca_private.booking_links(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),opportunity_id uuid not null references cobranca_private.crm_opportunities(id),owner_id uuid not null references public.cobranca_profiles(id),token_hash text not null unique,expires_at timestamptz not null default now()+interval '14 days',task_id uuid references cobranca_private.crm_tasks(id),created_at timestamptz not null default now());
alter table cobranca_private.booking_links enable row level security;
revoke all on cobranca_private.booking_links from public,anon,authenticated;
create index if not exists booking_opportunity on cobranca_private.booking_links(tenant_id,opportunity_id);

create or replace function cobranca_private.booking_issue(tenant uuid,owner uuid,opportunity uuid,secret text) returns jsonb language plpgsql set search_path='' as $$
declare b cobranca_private.booking_links;
begin
 if secret !~ '^[a-f0-9]{64}$' or not exists(select 1 from cobranca_private.crm_opportunities where id=opportunity and tenant_id=tenant and owner_id=owner) or not exists(select 1 from public.cobranca_profiles where id=owner and tenant_id=tenant and active and role in ('admin','master','commercial','commercial_manager')) then raise exception 'Agendamento não autorizado';end if;
 insert into cobranca_private.booking_links(tenant_id,owner_id,opportunity_id,token_hash) values(tenant,owner,opportunity,encode(sha256(convert_to(secret,'UTF8')),'hex')) on conflict(token_hash) do nothing;
 select * into b from cobranca_private.booking_links where token_hash=encode(sha256(convert_to(secret,'UTF8')),'hex') and tenant_id=tenant and opportunity_id=opportunity;
 if not found then raise exception 'Link indisponível';end if;
 return jsonb_build_object('id',b.id,'expires_at',b.expires_at);
end$$;
revoke all on function cobranca_private.booking_issue(uuid,uuid,uuid,text) from public,anon,authenticated;

create or replace function cobranca_private.booking_manage(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;o cobranca_private.crm_opportunities;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','commercial','commercial_manager') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Área comercial não autorizada';end if;
 select * into o from cobranca_private.crm_opportunities where id=(payload->>'id')::uuid and tenant_id=p.tenant_id and (p.role in ('admin','master','commercial_manager') or owner_id=p.id);
 if not found or o.email is null then raise exception 'Cadastre o email da oportunidade antes de gerar o link';end if;
 return cobranca_private.booking_issue(p.tenant_id,o.owner_id,o.id,payload->>'public_token');
end$$;
revoke all on function cobranca_private.booking_manage(jsonb) from public,anon;
grant execute on function cobranca_private.booking_manage(jsonb) to authenticated;
create or replace function public.cobranca_booking_manage(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.booking_manage(payload)$$;
revoke all on function public.cobranca_booking_manage(jsonb) from public,anon;
grant execute on function public.cobranca_booking_manage(jsonb) to authenticated;

create or replace function cobranca_private.booking_prospect(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c cobranca_private.schedule_connections;o cobranca_private.crm_opportunities;f uuid;address text:=lower(trim(payload->>'email'));
begin
 if length(coalesce(token,''))<>64 then raise exception 'Credencial inválida' using errcode='28000';end if;
 select * into c from cobranca_private.schedule_connections where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and active for update;
 if not found or not exists(select 1 from public.cobranca_tenants where id=c.tenant_id and active) then raise exception 'Credencial inválida' using errcode='28000';end if;
 if address !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' or length(address)>254 or length(trim(coalesce(payload->>'company',''))) not between 1 and 250 then raise exception 'Empresa e email do prospecto obrigatórios';end if;
 select * into o from cobranca_private.crm_opportunities where tenant_id=c.tenant_id and owner_id=c.owner_id and lower(email)=address order by created_at limit 1;
 if not found then
  select id into f from cobranca_private.crm_pipelines where tenant_id=c.tenant_id and name='Funil principal' and active;
  insert into cobranca_private.crm_opportunities(tenant_id,name,email,phone,source,stage,amount,owner_id,pipeline_id) values(c.tenant_id,trim(payload->>'company'),address,left(coalesce(payload->>'phone',''),50),'Prospecção por email · n8n','Prospecção',0,c.owner_id,f) returning * into o;
 end if;
 return cobranca_private.booking_issue(c.tenant_id,c.owner_id,o.id,payload->>'public_token');
end$$;
revoke all on function cobranca_private.booking_prospect(text,jsonb) from public;
grant execute on function cobranca_private.booking_prospect(text,jsonb) to anon,authenticated;
create or replace function public.cobranca_booking_prospect(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.booking_prospect(token,payload)$$;
revoke all on function public.cobranca_booking_prospect(text,jsonb) from public;
grant execute on function public.cobranca_booking_prospect(text,jsonb) to anon,authenticated;

create or replace function cobranca_private.booking_slots(owner uuid,tenant uuid,expiration timestamptz) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('start',slot,'end',slot+interval '30 minutes') order by slot),'[]') from (
 select (d+make_interval(hours=>h,mins=>m)) at time zone 'America/Sao_Paulo' as slot from generate_series(date_trunc('day',now() at time zone 'America/Sao_Paulo'),date_trunc('day',now() at time zone 'America/Sao_Paulo')+interval '14 days',interval '1 day')d cross join generate_series(9,16)h cross join generate_series(0,30,30)m where extract(isodow from d) between 1 and 5
 )s where slot>now()+interval '2 hours' and slot<expiration and not exists(select 1 from cobranca_private.crm_tasks t where t.tenant_id=tenant and t.owner_id=owner and t.status='Aberto' and t.due_at<slot+interval '30 minutes' and coalesce(t.end_at,t.due_at+interval '30 minutes')>slot)
$$;
revoke all on function cobranca_private.booking_slots(uuid,uuid,timestamptz) from public,anon,authenticated;

create or replace function cobranca_private.booking_public(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b cobranca_private.booking_links;o cobranca_private.crm_opportunities;available jsonb;start_at timestamptz;t cobranca_private.crm_tasks;
begin
 if token !~ '^[a-f0-9]{64}$' then raise exception 'Link inválido ou expirado';end if;
 select * into b from cobranca_private.booking_links where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
 if not found or b.expires_at<now() or not exists(select 1 from public.cobranca_tenants where id=b.tenant_id and active) or not exists(select 1 from public.cobranca_profiles where id=b.owner_id and tenant_id=b.tenant_id and active) then raise exception 'Link inválido ou expirado';end if;
 select * into o from cobranca_private.crm_opportunities where id=b.opportunity_id and tenant_id=b.tenant_id;
 if b.task_id is not null then select * into t from cobranca_private.crm_tasks where id=b.task_id;return jsonb_build_object('booked',true,'start',t.due_at,'end',t.end_at,'status',t.status);end if;
 perform pg_advisory_xact_lock(hashtextextended(b.owner_id::text,0));
 available:=cobranca_private.booking_slots(b.owner_id,b.tenant_id,b.expires_at);
 if payload->>'operation'='book' then
  start_at:=(payload->>'start')::timestamptz;
  if not exists(select 1 from jsonb_array_elements(available)x where (x->>'start')::timestamptz=start_at) then raise exception 'Horário indisponível. Atualize a lista' using errcode='40001';end if;
  if length(trim(coalesce(payload->>'contact_name',''))) not between 1 and 250 then raise exception 'Informe seu nome';end if;
  insert into cobranca_private.crm_tasks(tenant_id,opportunity_id,name,owner_id,due_at,end_at,status,company,contact_name,contact_email,contact_phone,notes,source) values(b.tenant_id,o.id,'Call de apresentação — '||left(o.name,200),b.owner_id,start_at,start_at+interval '30 minutes','Aberto',o.name,trim(payload->>'contact_name'),coalesce(o.email,''),coalesce(o.phone,''),'Agendamento confirmado pelo cliente pelo link do email.','booking') returning * into t;
  update cobranca_private.booking_links set task_id=t.id where id=b.id;
  insert into cobranca_private.crm_activities(tenant_id,opportunity_id,actor,subject,content,channel) values(b.tenant_id,o.id,b.owner_id,'Call agendada pelo cliente','Agendamento online para '||to_char(start_at at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' (horário de Brasília).','Reunião');
  return jsonb_build_object('booked',true,'start',t.due_at,'end',t.end_at,'status',t.status);
 elsif coalesce(payload->>'operation','slots')<>'slots' then raise exception 'Operação inválida';end if;
 return jsonb_build_object('booked',false,'slots',available,'timezone','America/Sao_Paulo','duration_minutes',30,'expires_at',b.expires_at);
end$$;
revoke all on function cobranca_private.booking_public(text,jsonb) from public;
grant execute on function cobranca_private.booking_public(text,jsonb) to anon,authenticated;
create or replace function public.cobranca_booking_public(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.booking_public(token,payload)$$;
revoke all on function public.cobranca_booking_public(text,jsonb) from public;
grant execute on function public.cobranca_booking_public(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
