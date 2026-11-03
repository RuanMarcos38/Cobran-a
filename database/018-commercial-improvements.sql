begin;
create table if not exists cobranca_private.crm_pipelines(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),name text not null check(length(trim(name)) between 1 and 150),active boolean not null default true,created_at timestamptz not null default now(),unique(tenant_id,name));
alter table cobranca_private.crm_pipelines enable row level security;
revoke all on cobranca_private.crm_pipelines from public,anon,authenticated;
insert into cobranca_private.crm_pipelines(tenant_id,name) select id,'Funil principal' from public.cobranca_tenants on conflict do nothing;
alter table cobranca_private.crm_opportunities add column if not exists company_data jsonb not null default '{}';
alter table cobranca_private.crm_opportunities add column if not exists pipeline_id uuid references cobranca_private.crm_pipelines(id);
update cobranca_private.crm_opportunities o set pipeline_id=f.id from cobranca_private.crm_pipelines f where o.pipeline_id is null and f.tenant_id=o.tenant_id and f.name='Funil principal';
alter table cobranca_private.crm_activities add column if not exists stage text;
create or replace function cobranca_private.activity_stage() returns trigger language plpgsql set search_path='' as $$begin new.stage:=coalesce(new.stage,(select stage from cobranca_private.crm_opportunities where id=new.opportunity_id and tenant_id=new.tenant_id));return new;end$$;
revoke all on function cobranca_private.activity_stage() from public,anon,authenticated;
create trigger crm_activity_stage before insert on cobranca_private.crm_activities for each row execute function cobranca_private.activity_stage();
create table if not exists cobranca_private.channel_settings(tenant_id uuid not null references public.cobranca_tenants(id),channel text not null check(channel in ('whatsapp')),cipher text not null,updated_at timestamptz not null default now(),primary key(tenant_id,channel));
alter table cobranca_private.channel_settings enable row level security;
revoke all on cobranca_private.channel_settings from public,anon,authenticated;

create or replace function cobranca_private.company_fields(data jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(coalesce(data,'{}')) where key in ('name','document','email','phone','city','address','zip_code','state_registration','trade_name','contact_name','contact_role','website','business_area','group','bank','financial_mode','default_interest','default_fine','grace_days','fee_percent','notes') and jsonb_typeof(value) in ('string','number','boolean','null')
$$;
revoke all on function cobranca_private.company_fields(jsonb) from public,anon,authenticated;

create or replace function cobranca_private.improvements(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;o cobranca_private.crm_opportunities;f cobranca_private.crm_pipelines;c public.cobranca_creditors;result jsonb;company jsonb;ident uuid;doc text;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;
 if action in ('channel_get','channel_save') then
  if p.role not in ('admin','master','commercial','commercial_manager') then raise exception 'Área comercial não autorizada';end if;
  if action='channel_save' then
   if p.role not in ('admin','master') or length(coalesce(payload->>'cipher','')) not between 20 and 10000 then raise exception 'Configuração exclusiva do administrador';end if;
   insert into cobranca_private.channel_settings(tenant_id,channel,cipher) values(p.tenant_id,'whatsapp',payload->>'cipher') on conflict(tenant_id,channel) do update set cipher=excluded.cipher,updated_at=now();
   perform cobranca_private.audit(p.tenant_id,'whatsapp_configure','tenants',p.tenant_id,null,'{}');
  end if;
  return jsonb_build_object('cipher',(select cipher from cobranca_private.channel_settings where tenant_id=p.tenant_id and channel='whatsapp'));
 end if;
 if action='company_prefill' then
  if p.role not in ('admin','master','supervisor') then raise exception 'Perfil de cadastro necessário';end if;
  doc:=regexp_replace(coalesce(payload->>'document',''),'[^0-9]','','g');
  if length(doc)<5 then return '{}';end if;
  select * into c from public.cobranca_creditors where tenant_id=p.tenant_id and regexp_replace(coalesce(document,''),'[^0-9]','','g')=doc order by created_at limit 1;
  if found then return jsonb_build_object('existing',true,'record',cobranca_private.company_fields(c.metadata||to_jsonb(c)));end if;
  select * into o from cobranca_private.crm_opportunities where tenant_id=p.tenant_id and regexp_replace(coalesce(document,''),'[^0-9]','','g')=doc order by updated_at desc limit 1;
  return case when found then jsonb_build_object('existing',false,'record',cobranca_private.company_fields(o.company_data||to_jsonb(o))) else '{}'::jsonb end;
 end if;
 if p.role not in ('admin','master','commercial','commercial_manager') then raise exception 'Área comercial não autorizada';end if;
 if action='crm_board' then
  insert into cobranca_private.crm_pipelines(tenant_id,name) values(p.tenant_id,'Funil principal') on conflict do nothing;
  result:=cobranca_private.sectors('crm_list',payload);
  return result||jsonb_build_object('pipelines',coalesce((select jsonb_agg(to_jsonb(x) order by created_at) from cobranca_private.crm_pipelines x where tenant_id=p.tenant_id and active),'[]'),'can_convert',p.role in ('admin','master'));
 elsif action='crm_pipeline' then
  if length(trim(coalesce(payload->>'name',''))) not between 1 and 150 then raise exception 'Informe o nome do funil';end if;
  insert into cobranca_private.crm_pipelines(tenant_id,name) values(p.tenant_id,trim(payload->>'name')) returning * into f;
  perform cobranca_private.audit(p.tenant_id,'create_pipeline','crm_pipelines',f.id,null,jsonb_build_object('name',f.name));return to_jsonb(f);
 elsif action='crm_card_save' then
  if octet_length(payload::text)>30000 then raise exception 'Cadastro excede o limite';end if;
  if nullif(payload->>'id','') is not null then
   select * into o from cobranca_private.crm_opportunities where id=(payload->>'id')::uuid and tenant_id=p.tenant_id and (p.role in ('admin','master','commercial_manager') or owner_id=p.id) for update;
   if not found then raise exception 'Oportunidade não encontrada';end if;
  end if;
  select * into f from cobranca_private.crm_pipelines where id=coalesce(nullif(payload->>'pipeline_id','')::uuid,o.pipeline_id) and tenant_id=p.tenant_id and active;
  if not found then select * into f from cobranca_private.crm_pipelines where tenant_id=p.tenant_id and name='Funil principal' and active;end if;
  if nullif(payload->>'pipeline_id','') is not null and f.id is distinct from (payload->>'pipeline_id')::uuid then raise exception 'Funil de outra empresa ou inexistente';end if;
  company:=coalesce(o.company_data,'{}')||cobranca_private.company_fields(payload);
  if length(trim(coalesce(payload->>'stage_note','')))>10000 then raise exception 'Observação excede o limite';end if;
  result:=cobranca_private.sectors('crm_save',payload);
  ident:=(result->>'id')::uuid;
  update cobranca_private.crm_opportunities set company_data=company,pipeline_id=f.id where id=ident;
  if o.id is null or o.stage is distinct from payload->>'stage' or nullif(trim(payload->>'stage_note'),'') is not null then
   insert into cobranca_private.crm_activities(tenant_id,opportunity_id,actor,subject,content,channel,stage) values(p.tenant_id,ident,p.id,case when o.id is null then 'Oportunidade criada' else 'Movimentação: '||o.stage||' → '||(payload->>'stage') end,coalesce(nullif(trim(payload->>'stage_note'),''),'Etapa atualizada pelo operador.'),'Nota',payload->>'stage');
  end if;
  return result||jsonb_build_object('company_data',company,'pipeline_id',f.id);
 elsif action in ('crm_company_lookup','crm_creditor_draft') then
  if action='crm_creditor_draft' then
   if p.role not in ('admin','master') then raise exception 'Cadastro de credor exclusivo do administrador';end if;
   select * into o from cobranca_private.crm_opportunities where id=(payload->>'id')::uuid and tenant_id=p.tenant_id;
   if not found then raise exception 'Prospecto não encontrado';end if;
   company:=cobranca_private.company_fields(o.company_data||to_jsonb(o));doc:=regexp_replace(coalesce(o.document,''),'[^0-9]','','g');
  else
   doc:=regexp_replace(coalesce(payload->>'document',''),'[^0-9]','','g');company:='{}';
  end if;
  if length(doc)<5 then return jsonb_build_object('record',company);end if;
  select * into c from public.cobranca_creditors where tenant_id=p.tenant_id and regexp_replace(coalesce(document,''),'[^0-9]','','g')=doc order by created_at limit 1;
  if found then
   if p.role in ('admin','master') then company:=cobranca_private.company_fields(c.metadata||to_jsonb(c));
   else company:=cobranca_private.company_fields(c.metadata||to_jsonb(c))-'bank'-'fee_percent'-'default_interest'-'default_fine'-'grace_days'-'financial_mode';end if;
  end if;
  return jsonb_build_object('record',company,'creditor_id',c.id,'existing',c.id is not null);
 end if;
 raise exception 'Operação não disponível';
end $$;
revoke all on function cobranca_private.improvements(text,jsonb) from public,anon;
grant execute on function cobranca_private.improvements(text,jsonb) to authenticated;
create or replace function public.cobranca_improvements(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.improvements(action,payload)$$;
revoke all on function public.cobranca_improvements(text,jsonb) from public,anon;
grant execute on function public.cobranca_improvements(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
