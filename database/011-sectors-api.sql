-- Additive sector separation; existing collections records and role IDs preserved.
alter table public.cobranca_profiles drop constraint cobranca_profiles_role_check;
alter table public.cobranca_profiles add constraint cobranca_profiles_role_check check(role in ('master','admin','supervisor','collector','finance','creditor','commercial','commercial_manager'));
alter table cobranca_private.invitations drop constraint invitations_role_check;
alter table cobranca_private.invitations add constraint invitations_role_check check(role in ('admin','supervisor','collector','finance','creditor','commercial','commercial_manager'));
create or replace function cobranca_private.can_read_debt(p public.cobranca_profiles,d public.cobranca_debts) returns boolean language sql immutable set search_path='' as $$select coalesce(d.tenant_id=p.tenant_id and p.role not in ('commercial','commercial_manager') and (p.role not in ('collector','creditor') or (p.role='collector' and d.assigned_to=p.id) or (p.role='creditor' and d.creditor_id=p.creditor_id)),false)$$;
create table cobranca_private.crm_opportunities (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),name text not null,document text,email text,phone text,source text,stage text not null default 'Prospecção' check(stage in ('Prospecção','Contato','Proposta','Negociação','Ganho','Perdido')),amount numeric(14,2) not null default 0 check(amount>=0),contract_ref text,owner_id uuid not null references public.cobranca_profiles(id),notes text,version int not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table cobranca_private.crm_activities (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),opportunity_id uuid not null references cobranca_private.crm_opportunities(id),actor uuid not null references public.cobranca_profiles(id),subject text not null,content text not null,channel text not null check(channel in ('Telefone','E-mail','WhatsApp','Reunião','Nota')),created_at timestamptz not null default now()
);
create table cobranca_private.crm_tasks (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),opportunity_id uuid references cobranca_private.crm_opportunities(id),name text not null,owner_id uuid not null references public.cobranca_profiles(id),due_at timestamptz not null,status text not null default 'Aberto' check(status in ('Aberto','Concluído','Cancelado')),created_at timestamptz not null default now()
);
create table cobranca_private.commission_rules (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),name text not null,sector text not null check(sector in ('commercial','collections')),user_id uuid not null references public.cobranca_profiles(id),contract_ref text not null default '',basis text not null check(basis in ('sale','receipt')),rate numeric(5,2) not null check(rate between 0 and 100),active boolean not null default true,created_at timestamptz not null default now(),unique(tenant_id,sector,user_id,contract_ref,basis)
);
create table cobranca_private.commission_entries (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),rule_id uuid not null references cobranca_private.commission_rules(id),user_id uuid not null references public.cobranca_profiles(id),sector text not null,source_kind text not null,source_id uuid not null,amount numeric(14,2) not null,base_amount numeric(14,2) not null,rate numeric(5,2) not null,reversed boolean not null default false,created_at timestamptz not null default now(),unique(rule_id,source_kind,source_id)
);
create table cobranca_private.distribution_rules (
 tenant_id uuid primary key references public.cobranca_tenants(id),enabled boolean not null default false,members uuid[] not null default '{}',last_assigned uuid,updated_at timestamptz not null default now()
);
create table cobranca_private.creditor_connections (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),creditor_id uuid not null references public.cobranca_creditors(id),name text not null,token_hash text not null,active boolean not null default true,last_received_at timestamptz,created_at timestamptz not null default now(),unique(tenant_id,creditor_id)
);
create table cobranca_private.bordero_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),connection_id uuid not null references cobranca_private.creditor_connections(id),external_id text not null,result jsonb not null,created_at timestamptz not null default now(),unique(connection_id,external_id)
);
create index crm_owner_stage on cobranca_private.crm_opportunities(tenant_id,owner_id,stage);
create index crm_activity_opportunity on cobranca_private.crm_activities(opportunity_id,created_at);
create index crm_task_owner on cobranca_private.crm_tasks(tenant_id,owner_id,due_at);
create index commission_owner on cobranca_private.commission_entries(tenant_id,user_id,sector);
create index commission_source on cobranca_private.commission_entries(source_id,source_kind);
do $$declare tab text;begin foreach tab in array array['crm_opportunities','crm_activities','crm_tasks','commission_rules','commission_entries','distribution_rules','creditor_connections','bordero_events'] loop execute format('alter table cobranca_private.%I enable row level security',tab);execute format('revoke all on cobranca_private.%I from public,anon,authenticated',tab);end loop;end$$;
-- Preserve prior commercial prospects in the new CRM without exposing collections data.
insert into cobranca_private.crm_opportunities(id,tenant_id,name,document,email,phone,source,stage,owner_id,notes,created_at)
select r.id,r.tenant_id,r.name,r.data->>'document',r.data->>'email',r.data->>'phone',r.data->>'source',case when r.data->>'stage' in ('Prospecção','Contato','Proposta','Negociação','Ganho','Perdido') then r.data->>'stage' else 'Prospecção' end,(select id from public.cobranca_profiles p where p.tenant_id=r.tenant_id and p.active and p.role in ('admin','master') order by created_at limit 1),r.data->>'notes',r.created_at from public.cobranca_records r where r.kind='leads' and exists(select 1 from public.cobranca_profiles p where p.tenant_id=r.tenant_id and p.active and p.role in ('admin','master'));

create function cobranca_private.assign_automatically() returns trigger language plpgsql security definer set search_path='' as $$
declare r cobranca_private.distribution_rules; chosen uuid;
begin
 select * into r from cobranca_private.distribution_rules where tenant_id=new.tenant_id and enabled for update;
 if not found then return new;end if;
 select id into chosen from public.cobranca_profiles where tenant_id=new.tenant_id and active and role='collector' and id=any(r.members) and (r.last_assigned is null or id>r.last_assigned) order by id limit 1;
 if chosen is null then select id into chosen from public.cobranca_profiles where tenant_id=new.tenant_id and active and role='collector' and id=any(r.members) order by id limit 1;end if;
 if chosen is null then raise exception 'Distribuição automática ativa sem negociadores habilitados';end if;
 new.assigned_to:=chosen;update cobranca_private.distribution_rules set last_assigned=chosen where tenant_id=new.tenant_id;return new;
end$$;
revoke all on function cobranca_private.assign_automatically() from public,anon,authenticated;
create trigger cobranca_auto_distribution before insert on public.cobranca_debts for each row execute function cobranca_private.assign_automatically();

create function cobranca_private.receipt_commission() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.cobranca_debts;r cobranca_private.commission_rules;
begin
 if tg_op='UPDATE' then if new.reversed then update cobranca_private.commission_entries set reversed=true where source_kind='receipt' and source_id=new.id;end if;return new;end if;
 select * into d from public.cobranca_debts where id=new.debt_id;
 for r in select distinct on(user_id) * from cobranca_private.commission_rules where tenant_id=new.tenant_id and active and basis='receipt' and (contract_ref='' or contract_ref=coalesce(d.contract_ref,'')) and (sector='commercial' or (sector='collections' and user_id=d.assigned_to)) order by user_id,(contract_ref<>'') desc,created_at desc loop
 insert into cobranca_private.commission_entries(tenant_id,rule_id,user_id,sector,source_kind,source_id,amount,base_amount,rate) values(new.tenant_id,r.id,r.user_id,r.sector,'receipt',new.id,round(new.amount*r.rate/100,2),new.amount,r.rate) on conflict do nothing;
 end loop;return new;
end$$;
revoke all on function cobranca_private.receipt_commission() from public,anon,authenticated;
create trigger cobranca_receipt_commission after insert or update of reversed on public.cobranca_receipts for each row execute function cobranca_private.receipt_commission();

create function cobranca_private.sectors(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare p public.cobranca_profiles;o cobranca_private.crm_opportunities;r cobranca_private.commission_rules;ident uuid;owner uuid;rows jsonb;result jsonb;token text;amount numeric;members uuid[];is_manager boolean;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;
 is_manager:=p.role in ('admin','master','commercial_manager');
 if action like 'crm_%' then
  if p.role not in ('admin','master','commercial','commercial_manager') then raise exception 'Área comercial não autorizada';end if;
 elsif action like 'ops_%' and p.role not in ('admin','master') then raise exception 'Configuração exclusiva do administrador';end if;
 if action='crm_notifications' then
  return coalesce((select jsonb_agg(jsonb_build_object('Atividade',x.name,'Agendamento',x.due_at,'Situação',x.status)) from cobranca_private.crm_tasks x where tenant_id=p.tenant_id and (is_manager or owner_id=p.id) and status='Aberto' and due_at<=now()+interval '7 days'),'[]');
 elsif action='crm_list' then
  select coalesce(jsonb_agg(to_jsonb(x) order by updated_at desc),'[]') into rows from cobranca_private.crm_opportunities x where tenant_id=p.tenant_id and (is_manager or owner_id=p.id) and (coalesce(payload->>'search','')='' or name ilike '%'||(payload->>'search')||'%');
  return jsonb_build_object('rows',rows,'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_profiles where tenant_id=p.tenant_id and active and (is_manager or id=p.id) and role in ('admin','master','commercial','commercial_manager')),'[]'));
 elsif action='crm_save' then
  ident:=nullif(payload->>'id','')::uuid;owner:=coalesce(nullif(payload->>'owner_id','')::uuid,p.id);amount:=coalesce(nullif(payload->>'amount','')::numeric,0);
  if length(trim(coalesce(payload->>'name',''))) not between 1 and 250 or amount<0 or amount<>round(amount,2) or amount>999999999999.99 or coalesce(payload->>'stage','') not in ('Prospecção','Contato','Proposta','Negociação','Ganho','Perdido') then raise exception 'Nome, etapa ou valor inválidos';end if;
  if not exists(select 1 from public.cobranca_profiles where id=owner and tenant_id=p.tenant_id and active and role in ('admin','master','commercial','commercial_manager')) or (not is_manager and owner<>p.id) then raise exception 'Responsável comercial inválido';end if;
  if ident is not null then select * into o from cobranca_private.crm_opportunities where id=ident and tenant_id=p.tenant_id and (is_manager or owner_id=p.id) for update;if not found then raise exception 'Oportunidade não encontrada';end if;if o.version<>coalesce((payload->>'version')::int,0) then raise exception 'Registro alterado por outro usuário. Atualize antes de salvar';end if;end if;
  ident:=coalesce(ident,gen_random_uuid());
  insert into cobranca_private.crm_opportunities(id,tenant_id,name,document,email,phone,source,stage,amount,contract_ref,owner_id,notes) values(ident,p.tenant_id,trim(payload->>'name'),payload->>'document',payload->>'email',payload->>'phone',payload->>'source',payload->>'stage',amount,payload->>'contract_ref',owner,payload->>'notes') on conflict(id) do update set name=excluded.name,document=excluded.document,email=excluded.email,phone=excluded.phone,source=excluded.source,stage=excluded.stage,amount=excluded.amount,contract_ref=excluded.contract_ref,owner_id=excluded.owner_id,notes=excluded.notes,version=crm_opportunities.version+1,updated_at=now() returning to_jsonb(crm_opportunities.*) into result;
  update cobranca_private.commission_entries set reversed=true where source_kind='sale' and source_id=ident;
  if payload->>'stage'='Ganho' then
   for r in select * from cobranca_private.commission_rules where tenant_id=p.tenant_id and active and sector='commercial' and basis='sale' and user_id=owner and contract_ref in ('',coalesce(payload->>'contract_ref','')) order by (contract_ref<>'') desc limit 1 loop
    insert into cobranca_private.commission_entries(tenant_id,rule_id,user_id,sector,source_kind,source_id,amount,base_amount,rate) values(p.tenant_id,r.id,owner,'commercial','sale',ident,round(amount*r.rate/100,2),amount,r.rate) on conflict(rule_id,source_kind,source_id) do update set amount=round(excluded.base_amount*commission_entries.rate/100,2),base_amount=excluded.base_amount,reversed=false;
    update cobranca_private.commission_entries set reversed=true where source_kind='sale' and source_id=ident and rule_id<>r.id;
   end loop;
  else update cobranca_private.commission_entries set reversed=true where source_kind='sale' and source_id=ident;end if;
  perform cobranca_private.audit(p.tenant_id,'crm_save','crm_opportunities',ident,to_jsonb(o),result);return result;
 elsif action in ('crm_detail','crm_activity') then
  select * into o from cobranca_private.crm_opportunities where id=(payload->>'id')::uuid and tenant_id=p.tenant_id and (is_manager or owner_id=p.id);
  if not found then raise exception 'Oportunidade não encontrada';end if;
  if action='crm_activity' then
   if length(trim(coalesce(payload->>'subject',''))) not between 1 and 250 or length(trim(coalesce(payload->>'content',''))) not between 1 and 10000 or coalesce(payload->>'channel','') not in ('Telefone','E-mail','WhatsApp','Reunião','Nota') then raise exception 'Atendimento inválido';end if;
   insert into cobranca_private.crm_activities(tenant_id,opportunity_id,actor,subject,content,channel) values(p.tenant_id,o.id,p.id,payload->>'subject',payload->>'content',payload->>'channel') returning id into ident;
   perform cobranca_private.audit(p.tenant_id,'crm_activity','crm_activities',ident,null,payload);
  end if;
  return jsonb_build_object('opportunity',to_jsonb(o),'activities',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from cobranca_private.crm_activities x where opportunity_id=o.id),'[]'));
 elsif action='crm_tasks' then
  if payload->>'operation'='save' then
   owner:=coalesce(nullif(payload->>'owner_id','')::uuid,p.id);ident:=nullif(payload->>'id','')::uuid;
   if not exists(select 1 from public.cobranca_profiles where id=owner and tenant_id=p.tenant_id and active and role in ('admin','master','commercial','commercial_manager')) or (not is_manager and owner<>p.id) then raise exception 'Responsável inválido';end if;
   if length(trim(coalesce(payload->>'name',''))) not between 1 and 250 or nullif(payload->>'due_at','')::timestamptz is null or coalesce(payload->>'status','') not in ('Aberto','Concluído','Cancelado') then raise exception 'Agendamento inválido';end if;
   if nullif(payload->>'opportunity_id','') is not null and not exists(select 1 from cobranca_private.crm_opportunities where id=(payload->>'opportunity_id')::uuid and tenant_id=p.tenant_id and (is_manager or owner_id=p.id)) then raise exception 'Oportunidade inválida';end if;
   if ident is not null then perform 1 from cobranca_private.crm_tasks where id=ident and tenant_id=p.tenant_id and (is_manager or owner_id=p.id) for update;if not found then raise exception 'Agendamento não encontrado';end if;end if;
   insert into cobranca_private.crm_tasks(id,tenant_id,opportunity_id,name,owner_id,due_at,status) values(coalesce(ident,gen_random_uuid()),p.tenant_id,nullif(payload->>'opportunity_id','')::uuid,payload->>'name',owner,(payload->>'due_at')::timestamptz,payload->>'status') on conflict(id) do update set name=excluded.name,owner_id=excluded.owner_id,due_at=excluded.due_at,status=excluded.status,opportunity_id=excluded.opportunity_id returning id into ident;
   perform cobranca_private.audit(p.tenant_id,'crm_task','crm_tasks',ident,null,payload);
  end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by due_at) from cobranca_private.crm_tasks x where tenant_id=p.tenant_id and (is_manager or owner_id=p.id)),'[]'));
 elsif action in ('crm_commissions','ops_commissions') then
  if action='ops_commissions' and payload->>'operation'='save' then
   owner:=(payload->>'user_id')::uuid;
   if not exists(select 1 from public.cobranca_profiles where id=owner and tenant_id=p.tenant_id and active and ((payload->>'sector'='commercial' and role in ('commercial','commercial_manager','admin','master')) or (payload->>'sector'='collections' and role='collector'))) then raise exception 'Usuário ou setor inválido';end if;
   if (payload->>'rate')::numeric not between 0 and 100 or (payload->>'rate')::numeric<>round((payload->>'rate')::numeric,2) or length(trim(coalesce(payload->>'name','')))=0 or (payload->>'sector'='collections' and payload->>'basis'<>'receipt') then raise exception 'Regra de comissão inválida';end if;
   insert into cobranca_private.commission_rules(tenant_id,name,sector,user_id,contract_ref,basis,rate,active) values(p.tenant_id,payload->>'name',payload->>'sector',owner,trim(coalesce(payload->>'contract_ref','')),payload->>'basis',(payload->>'rate')::numeric,coalesce((payload->>'active')::boolean,true)) on conflict(tenant_id,sector,user_id,contract_ref,basis) do update set name=excluded.name,rate=excluded.rate,active=excluded.active returning id into ident;
   perform cobranca_private.audit(p.tenant_id,'commission_rule','commission_rules',ident,null,payload);
  end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from cobranca_private.commission_entries x where tenant_id=p.tenant_id and (action='ops_commissions' or (sector='commercial' and (is_manager or user_id=p.id)))),'[]'),'rules',case when action='ops_commissions' then coalesce((select jsonb_agg(to_jsonb(x)) from cobranca_private.commission_rules x where tenant_id=p.tenant_id),'[]') else '[]'::jsonb end,'users',case when action='ops_commissions' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role)) from public.cobranca_profiles where tenant_id=p.tenant_id and active),'[]') else '[]'::jsonb end);
 elsif action='ops_distribution' then
  if payload->>'operation'='save' then
   select coalesce(array_agg(value::uuid),'{}') into members from jsonb_array_elements_text(coalesce(payload->'members','[]'));
   if exists(select 1 from unnest(members) x where not exists(select 1 from public.cobranca_profiles where id=x and tenant_id=p.tenant_id and active and role='collector')) or (coalesce((payload->>'enabled')::boolean,false) and cardinality(members)=0) then raise exception 'Selecione negociadores ativos da sua empresa';end if;
   insert into cobranca_private.distribution_rules(tenant_id,enabled,members) values(p.tenant_id,coalesce((payload->>'enabled')::boolean,false),members) on conflict(tenant_id) do update set enabled=excluded.enabled,members=excluded.members,updated_at=now();
   perform cobranca_private.audit(p.tenant_id,'distribution_rule','distribution_rules',p.tenant_id,null,payload);
  end if;
  return jsonb_build_object('rule',coalesce((select to_jsonb(x) from cobranca_private.distribution_rules x where tenant_id=p.tenant_id),'{}'),'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_profiles where tenant_id=p.tenant_id and active and role='collector'),'[]'));
 elsif action='ops_connections' then
  if payload->>'operation'='save' then
   owner:=(payload->>'creditor_id')::uuid;
   if not exists(select 1 from public.cobranca_creditors where id=owner and tenant_id=p.tenant_id and active) or length(trim(coalesce(payload->>'name','')))=0 then raise exception 'Credor ou nome inválido';end if;
   token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
   insert into cobranca_private.creditor_connections(tenant_id,creditor_id,name,token_hash) values(p.tenant_id,owner,payload->>'name',encode(sha256(convert_to(token,'UTF8')),'hex')) on conflict(tenant_id,creditor_id) do update set name=excluded.name,token_hash=excluded.token_hash,active=true returning id into ident;
   perform cobranca_private.audit(p.tenant_id,'connection_rotate','creditor_connections',ident,null,jsonb_build_object('creditor_id',owner));
   return jsonb_build_object('id',ident,'token',token);
  elsif payload->>'operation'='disable' then update cobranca_private.creditor_connections set active=false where id=(payload->>'id')::uuid and tenant_id=p.tenant_id;end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'creditor_id',x.creditor_id,'creditor_name',c.name,'active',x.active,'last_received_at',x.last_received_at)) from cobranca_private.creditor_connections x join public.cobranca_creditors c on c.id=x.creditor_id where x.tenant_id=p.tenant_id),'[]'),'events',coalesce((select jsonb_agg(to_jsonb(x)) from (select external_id,result,created_at from cobranca_private.bordero_events where tenant_id=p.tenant_id order by created_at desc limit 50) x),'[]'));
 else raise exception 'Operação não disponível';end if;
end$$;
revoke all on function cobranca_private.sectors(text,jsonb) from public,anon;
grant execute on function cobranca_private.sectors(text,jsonb) to authenticated;

create function cobranca_private.bordero(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c cobranca_private.creditor_connections;creditor public.cobranca_creditors;item jsonb;debtor uuid;debt uuid;result jsonb:='[]';amount numeric;terms jsonb;prior jsonb;assigned uuid;external text;
begin
 if length(coalesce(token,''))<>64 then raise exception 'Credencial inválida';end if;
 if octet_length(payload::text)>1048576 then raise exception 'Borderô excede 1 MB';end if;
 select * into c from cobranca_private.creditor_connections where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and active for update;
 if not found or not exists(select 1 from public.cobranca_tenants where id=c.tenant_id and active) then raise exception 'Credencial inválida';end if;
 if length(trim(coalesce(payload->>'external_id',''))) not between 1 and 200 or jsonb_typeof(payload->'items')<>'array' or coalesce(jsonb_array_length(payload->'items'),0) not between 1 and 100 then raise exception 'Borderô requer identificação e de 1 a 100 títulos';end if;
 select e.result into prior from cobranca_private.bordero_events e where connection_id=c.id and external_id=payload->>'external_id';if prior is not null then return prior||jsonb_build_object('duplicate',true);end if;
 select * into creditor from public.cobranca_creditors where id=c.creditor_id and tenant_id=c.tenant_id and active;
 if not found then raise exception 'Credor inativo';end if;
 select id into assigned from public.cobranca_profiles where tenant_id=c.tenant_id and active and role='collector' order by id limit 1;
 if assigned is null then raise exception 'Cadastre um negociador antes de receber borderôs';end if;
 terms:=jsonb_build_object('mode',coalesce(creditor.metadata->>'financial_mode','none'),'interest_percent',coalesce((creditor.metadata->>'default_interest')::numeric,0),'fine_percent',coalesce((creditor.metadata->>'default_fine')::numeric,0),'grace_days',coalesce((creditor.metadata->>'grace_days')::int,0),'contract_ref',payload->>'contract_ref','interest_basis','principal_remaining','fine_basis','principal_at_first_overdue','allocation','interest_fine_principal');
 if ((terms->>'interest_percent')::numeric>0 or (terms->>'fine_percent')::numeric>0) and length(trim(coalesce(payload->>'contract_ref','')))=0 then raise exception 'Contrato obrigatório para encargos';end if;
 for item in select value from jsonb_array_elements(payload->'items') loop
  amount:=nullif(item->>'original_amount','')::numeric;external:=trim(coalesce(item->>'external_ref',''));
  if amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) or length(external) not between 1 and 200 or length(trim(coalesce(item->>'debtor_name',''))) not between 1 and 250 or length(trim(coalesce(item->>'debtor_document',''))) not between 1 and 30 or nullif(item->>'due_date','')::date is null then raise exception 'Título inválido';end if;
  select id into debt from public.cobranca_debts where tenant_id=c.tenant_id and creditor_id=c.creditor_id and external_ref=external;
  if debt is not null then result:=result||jsonb_build_array(jsonb_build_object('id',debt,'external_ref',external,'duplicate',true));continue;end if;
  select id into debtor from public.cobranca_debtors where tenant_id=c.tenant_id and creditor_id=c.creditor_id and document=item->>'debtor_document' limit 1;
  if debtor is null then insert into public.cobranca_debtors(tenant_id,creditor_id,name,document,email,phone) values(c.tenant_id,c.creditor_id,item->>'debtor_name',item->>'debtor_document',item->>'debtor_email',item->>'debtor_phone') returning id into debtor;end if;
  insert into public.cobranca_debts(tenant_id,creditor_id,debtor_id,external_ref,contract_ref,original_amount,current_amount,due_date,assigned_to,interest_percent,fine_percent,metadata) values(c.tenant_id,c.creditor_id,debtor,external,payload->>'contract_ref',amount,amount,(item->>'due_date')::date,assigned,(terms->>'interest_percent')::numeric,(terms->>'fine_percent')::numeric,jsonb_build_object('financial_terms',terms,'connection_id',c.id,'bordero_id',payload->>'external_id')) returning id into debt;
  result:=result||jsonb_build_array(jsonb_build_object('id',debt,'external_ref',external,'duplicate',false));
 end loop;
 prior:=jsonb_build_object('items',result,'count',jsonb_array_length(result),'duplicate',false);
 insert into cobranca_private.bordero_events(tenant_id,connection_id,external_id,result) values(c.tenant_id,c.id,payload->>'external_id',prior);
 update cobranca_private.creditor_connections set last_received_at=now() where id=c.id;return prior;
end$$;
revoke all on function cobranca_private.bordero(text,jsonb) from public;
grant execute on function cobranca_private.bordero(text,jsonb) to anon,authenticated;
create function public.cobranca_bordero(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.bordero(token,payload)$$;
revoke all on function public.cobranca_bordero(text,jsonb) from public;
grant execute on function public.cobranca_bordero(text,jsonb) to anon,authenticated;
grant usage on schema cobranca_private to anon;
create or replace function cobranca_private.team(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;target public.cobranca_profiles;inv cobranca_private.invitations;ident uuid;address text;chosen_role text;limit_percent numeric;creditor uuid;enabled boolean;result jsonb;access_rules jsonb;manage_users boolean;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not (p.role in ('admin','master') or (p.role='supervisor' and p.can_manage_users)) then raise exception 'Gestão de usuários não autorizada';end if;
 if payload->>'operation'='list' then
  select coalesce(jsonb_agg(row_data order by row_data->>'name'),'[]') into result from (
   select jsonb_build_object('id',x.id,'name',x.name,'email',u.email,'role',x.role,'creditor_id',x.creditor_id,'discount_limit',x.discount_limit,'active',x.active,'invitation',false,'client_access',x.client_access,'can_manage_users',x.can_manage_users) row_data from public.cobranca_profiles x join auth.users u on u.id=x.id where x.tenant_id=p.tenant_id and (p.role<>'supervisor' or x.role not in ('commercial','commercial_manager'))
   union all select jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'role',i.role,'creditor_id',i.creditor_id,'discount_limit',i.discount_limit,'active',i.active,'expires_at',i.expires_at,'invitation',true,'client_access',i.client_access,'can_manage_users',i.can_manage_users) from cobranca_private.invitations i where i.tenant_id=p.tenant_id and (p.role<>'supervisor' or i.role not in ('commercial','commercial_manager')) and i.claimed_by is null
  ) rows;
  return jsonb_build_object('rows',result,'count',jsonb_array_length(result),'total',null);
 elsif payload->>'operation'<>'save' then raise exception 'Operação inválida';end if;
 ident:=nullif(payload->>'id','')::uuid;address:=lower(trim(coalesce(payload->>'email','')));chosen_role:=payload->>'role';limit_percent:=coalesce(nullif(payload->>'discount_limit','')::numeric,-1);enabled:=coalesce((payload->>'active')::boolean,true);creditor:=nullif(payload->>'creditor_id','')::uuid;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 250 or coalesce(chosen_role,'') not in ('admin','supervisor','collector','finance','creditor','commercial','commercial_manager') or limit_percent not between 0 and 100 then raise exception 'Nome, perfil ou alçada inválidos';end if;
 if chosen_role='creditor' and not exists(select 1 from public.cobranca_creditors where id=creditor and tenant_id=p.tenant_id and active) then raise exception 'Cliente credor inválido';end if;
 access_rules:=cobranca_private.validate_client_access(payload->'client_access');
 manage_users:=coalesce((payload->>'can_manage_users')::boolean,false);
 if p.role='supervisor' and (chosen_role not in ('collector','creditor') or manage_users or limit_percent>p.discount_limit) then raise exception 'Gestor só pode criar negociador ou cliente, dentro da própria alçada';end if;
 if manage_users and chosen_role<>'supervisor' then raise exception 'Delegação de usuários disponível somente para gestor';end if;
 if chosen_role<>'creditor' then creditor:=null;end if;
 if ident is not null and not coalesce((payload->>'invitation')::boolean,false) then
  select * into target from public.cobranca_profiles where id=ident and tenant_id=p.tenant_id for update;
  if not found then raise exception 'Usuário não encontrado';end if;
  if p.role='supervisor' and target.role not in ('collector','creditor') then raise exception 'Gestor não pode alterar outro gestor ou administrador';end if;
  if target.role='master' then raise exception 'Perfil reservado';end if;
  if ident=p.id and (chosen_role<>'admin' or not enabled) then raise exception 'Você não pode desativar ou remover seu próprio acesso administrativo';end if;
  update public.cobranca_profiles set name=payload->>'name',role=chosen_role,creditor_id=creditor,discount_limit=limit_percent,active=enabled,client_access=access_rules,can_manage_users=manage_users where id=ident;
  perform cobranca_private.audit(p.tenant_id,'update_member','profiles',ident,to_jsonb(target),payload-'email');
 else
  if address !~ '^[^ @]+@[^ @]+\.[^ @]+$' or length(address)>254 then raise exception 'E-mail inválido';end if;
  if exists(select 1 from auth.users u join public.cobranca_profiles x on x.id=u.id where lower(u.email)=address) then raise exception 'E-mail já possui acesso. Edite o usuário na sua empresa';end if;
  select * into inv from cobranca_private.invitations where email=address for update;
  if found and p.role='supervisor' and inv.role not in ('collector','creditor') then raise exception 'Gestor não pode alterar convite de gestor ou administrador';end if;
  if found and (inv.tenant_id<>p.tenant_id or (ident is not null and inv.id<>ident)) then raise exception 'E-mail indisponível para convite';end if;
  if ident is not null and not exists(select 1 from cobranca_private.invitations where id=ident and tenant_id=p.tenant_id and email=address) then raise exception 'Convite não encontrado';end if;
  insert into cobranca_private.invitations(email,tenant_id,name,role,creditor_id,discount_limit,active,client_access,can_manage_users) values(address,p.tenant_id,payload->>'name',chosen_role,creditor,limit_percent,enabled,access_rules,manage_users)
  on conflict(email) do update set name=excluded.name,role=excluded.role,creditor_id=excluded.creditor_id,discount_limit=excluded.discount_limit,active=excluded.active,client_access=excluded.client_access,can_manage_users=excluded.can_manage_users,expires_at=now()+interval '7 days' returning id into ident;
  perform cobranca_private.audit(p.tenant_id,'invite_member','invitations',ident,to_jsonb(inv),payload);
 end if;
 return jsonb_build_object('id',ident);
end $$;
revoke all on function cobranca_private.team(jsonb) from public,anon,authenticated;

create or replace function cobranca_private.api(action text,payload jsonb)

returns jsonb language plpgsql security definer set search_path='' as $$

#variable_conflict use_column

declare

 p public.cobranca_profiles; d public.cobranca_debts; c public.cobranca_creditors; b public.cobranca_debtors;

 r public.cobranca_receipts; rec public.cobranca_records; a public.cobranca_agreements;

 t uuid; ident uuid; assigned uuid; amount numeric(14,2); discount numeric(5,2); total numeric(14,2); entry numeric(14,2);

 installments int; part numeric(14,2); remainder int; i int; cnt bigint; result jsonb; before_row jsonb;

 inst public.cobranca_agreement_installments; allocation record; unallocated numeric(14,2); allocated numeric(14,2);

 f jsonb:=coalesce(payload->'filters','{}'); ent text:=payload->>'entity';

 page_no int:=greatest(1,coalesce((payload->>'page')::int,1)); sort_key text:=coalesce(payload->>'sort','created_at');

 direction text:=case when payload->>'direction'='asc' then 'asc' else 'desc' end;

 role_admin boolean; can_finance boolean; cols text; q text;

begin

 if auth.uid() is null then raise exception 'Autenticação necessária';end if;

 select * into p from public.cobranca_profiles where id=auth.uid() and active;

 if not found then raise exception 'Usuário sem vínculo ativo com uma assessoria';end if;

 t:=p.tenant_id;

 if not exists(select 1 from public.cobranca_tenants where id=t and active) then raise exception 'Assessoria inativa';end if;

 role_admin:=p.role in ('master','admin','supervisor');can_finance:=p.role in ('master','admin','finance');
 if action like 'crm_%' or action like 'ops_%' then return cobranca_private.sectors(action,payload);end if;
 if p.role in ('commercial','commercial_manager') then
  if action='profile' then return to_jsonb(p)||(select jsonb_build_object('tenant_name',name) from public.cobranca_tenants where id=t);
  elsif action='notifications' then return cobranca_private.sectors('crm_notifications',payload);
  elsif action='lookups' then return jsonb_build_object('creditors','[]'::jsonb,'debtors','[]'::jsonb,'users','[]'::jsonb);
  else raise exception 'Perfil comercial não acessa cobrança ou financeiro';end if;
 end if;
 if ent='leads' then raise exception 'Use o CRM comercial';end if;



 if p.role='collector' and action='report' and coalesce(payload->>'report','') not in ('Painel gerencial','Títulos Cadastrados','Títulos Captados','Processos do Cliente — Totais','Histórico do Processo','Análise Gerencial') then raise exception 'Relatório não autorizado para negociador';end if;

 if p.role='creditor' and action not in ('profile','lookups') then
  if action in ('processes','detail','quote','notifications') then
   if not coalesce((p.client_access->>'processes')::boolean,false) then raise exception 'Consulta de processos não liberada pelo administrador';end if;
  elsif action='export' then
   if not coalesce((p.client_access->>'export')::boolean,false) or not coalesce((p.client_access->>'processes')::boolean,false) then raise exception 'Exportação não liberada';end if;
  elsif action='download' then
   if not coalesce((p.client_access->>'documents')::boolean,false) or not coalesce((p.client_access->>'processes')::boolean,false) then raise exception 'Documentos não liberados';end if;
  elsif action='report' then
   if payload->>'report' in ('Recebimentos','Consulta de Recebimentos') then
    if not coalesce((p.client_access->>'receipts')::boolean,false) then raise exception 'Recebimentos não liberados';end if;
   elsif payload->>'report'='Histórico do Processo' then
    if not coalesce((p.client_access->>'reports')::boolean,false) or not coalesce((p.client_access->>'history')::boolean,false) then raise exception 'Histórico não liberado';end if;
   elsif payload->>'report' in ('Painel gerencial','Títulos Cadastrados','Títulos Captados','Processos do Cliente — Totais','Análise Gerencial') then
    if not coalesce((p.client_access->>'reports')::boolean,false) then raise exception 'Relatórios não liberados';end if;
   else raise exception 'Relatório não autorizado para cliente';end if;
  else raise exception 'Portal cliente permite somente consultas autorizadas';end if;
 end if;

 if action='team' then return cobranca_private.team(payload);
 elsif action='profile' then

  return to_jsonb(p)||(select jsonb_build_object('tenant_name',name,'recovery_goal',recovery_goal) from public.cobranca_tenants where id=t);

 elsif action='lookups' then
 if p.role='creditor' and not (p.client_access->>'processes')::boolean then return jsonb_build_object('creditors','[]'::jsonb,'debtors','[]'::jsonb,'users','[]'::jsonb);end if;

  return jsonb_build_object('creditors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'financial_mode',metadata->>'financial_mode','default_interest',metadata->>'default_interest','default_fine',metadata->>'default_fine','grace_days',metadata->>'grace_days')) from public.cobranca_creditors where tenant_id=t and active and (p.role<>'creditor' or id=p.creditor_id) and (p.role<>'collector' or exists(select 1 from public.cobranca_debts owned where owned.creditor_id=cobranca_creditors.id and owned.assigned_to=p.id))),'[]'),

   'debtors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'creditor_id',creditor_id)) from public.cobranca_debtors b where b.tenant_id=t and (p.role not in ('collector','creditor') or exists(select 1 from public.cobranca_debts d where d.debtor_id=b.id and cobranca_private.can_read_debt(p,d)))),'[]'),

   'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_profiles where tenant_id=t and active and role not in ('commercial','commercial_manager') and (role_admin or id=p.id)),'[]'));

 elsif action in ('processes','export') and (ent is null or ent='processes') then

  if not sort_key=any(array['external_ref','current_amount','creditor_name','debtor_name','city','collector_name','days','team','supervisor','carrier','created_at','forwarded_at','last_history','payment_at','stay_days','app_status']) then sort_key:='created_at';end if;

  select count(*),coalesce(sum(d.current_amount),0) into cnt,total from cobranca_private.process_list d

   where cobranca_private.can_read_debt(p,(select x from public.cobranca_debts x where x.id=d.id)) and cobranca_private.matches(d,f);

  if action='export' and cnt>10000 then raise exception 'Restrinja a pesquisa a até 10.000 registros para exportar';end if;

  q:=format('select coalesce(jsonb_agg(to_jsonb(z)),''[]'') from (select d.* from cobranca_private.process_list d where cobranca_private.can_read_debt($1,(select x from public.cobranca_debts x where x.id=d.id)) and cobranca_private.matches(d,$2) order by %I %s,id limit $3 offset $4) z',sort_key,direction);

  execute q into result using p,f,case when action='export' then 10000 else 25 end,case when action='export' then 0 else (page_no-1)*25 end;

  if action='export' then return result;end if;return jsonb_build_object('rows',result,'count',cnt,'total',total);

 elsif action in ('list','get','export') then

  if ent not in ('creditors','debtors','auxiliary','expenses','leads','appointments') then raise exception 'Cadastro inválido';end if;

  if p.role='creditor' and ent<>'creditors' then raise exception 'Acesso não autorizado';end if;

  if p.role='collector' and ent not in ('debtors','appointments') then raise exception 'Acesso não autorizado';end if;

  if ent='expenses' and not can_finance then raise exception 'Perfil financeiro necessário';end if;

  if ent='creditors' then

   select coalesce(jsonb_agg(c.metadata||to_jsonb(c)),'[]') into result from public.cobranca_creditors c where tenant_id=t and (p.role<>'creditor' or c.id=p.creditor_id);

  elsif ent='debtors' then

   select coalesce(jsonb_agg(b.metadata||to_jsonb(b)),'[]') into result from public.cobranca_debtors b where tenant_id=t and (p.role<>'collector' or exists(select 1 from public.cobranca_debts d where d.debtor_id=b.id and d.assigned_to=p.id));

  else

   select coalesce(jsonb_agg(r.data||to_jsonb(r)),'[]') into result from public.cobranca_records r where tenant_id=t and kind=ent and (p.role<>'collector' or data->>'assigned_to'=p.id::text);

  end if;

  if action='get' then select x into result from jsonb_array_elements(result) x where x->>'id'=payload->>'id';if result is null then raise exception 'Registro não encontrado';end if;return result;end if;

  select coalesce(jsonb_agg(x),'[]') into result from jsonb_array_elements(result) x where coalesce(f->>'search','')='' or concat(x->>'name',' ',x->>'document') ilike '%'||(f->>'search')||'%';

  cnt:=jsonb_array_length(result);if action='export' then return result;end if;

  if not sort_key=any(array['name','document','email','phone','active','amount','due_date','category','status','stage','created_at','due_at','priority']) then sort_key:='name';end if;

  q:=format('select coalesce(jsonb_agg(x),''[]'') from (select x from jsonb_array_elements($1) x order by x->>%L %s limit 25 offset $2) z',sort_key,direction);

  execute q into result using result,(page_no-1)*25;

  return jsonb_build_object('rows',result,'count',cnt,'total',null);

 elsif action='save' then

  if ent in ('creditors','debtors','auxiliary','leads') and not role_admin then raise exception 'Perfil de gestão necessário';end if;

  if ent='expenses' and not can_finance then raise exception 'Perfil financeiro necessário';end if;

  if ent='appointments' and p.role='creditor' then raise exception 'Acesso não autorizado';end if;

  if ent not in ('creditors','debtors','auxiliary','expenses','leads','appointments') then raise exception 'Cadastro inválido';end if;

  if length(trim(coalesce(payload->>'name',''))) not between 1 and 250 then raise exception 'Nome obrigatório, com até 250 caracteres';end if;
  if ent='creditors' and coalesce(nullif(payload->>'fee_percent','')::numeric,0) not between 0 and 100 then raise exception 'Honorários devem estar entre 0 e 100 por cento';end if;
  if ent='expenses' and coalesce(payload->>'status','') not in ('Pendente','Pago','Estornado') then raise exception 'Situação da despesa inválida';end if;
  if ent='appointments' and (coalesce(payload->>'status','') not in ('Aberto','Concluído','Cancelado') or coalesce(payload->>'priority','') not in ('Normal','Alta','Urgente')) then raise exception 'Situação ou prioridade inválida';end if;
  if ent='leads' and coalesce(payload->>'stage','') not in ('Prospecção','Contato','Proposta','Negociação','Ganho','Perdido') then raise exception 'Etapa inválida';end if;


  if ent='creditors' then
   if coalesce(payload->>'financial_mode','none') not in ('none','monthly','daily') or coalesce(nullif(payload->>'default_interest','')::numeric,0) not between 0 and 100 or coalesce(nullif(payload->>'default_fine','')::numeric,0) not between 0 and 100 or coalesce(nullif(payload->>'grace_days','')::int,0) not between 0 and 365 then raise exception 'Regra financeira inválida';end if;
   if coalesce(payload->>'financial_mode','none')='none' and coalesce(nullif(payload->>'default_interest','')::numeric,0)>0 then raise exception 'Selecione a periodicidade dos juros';end if;
  end if;

  ident:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());

  if ent='creditors' then

   select to_jsonb(x) into before_row from public.cobranca_creditors x where id=ident and tenant_id=t;

   if exists(select 1 from public.cobranca_creditors where id=ident and tenant_id<>t) then raise exception 'Registro não encontrado';end if;

   insert into public.cobranca_creditors(id,tenant_id,name,document,email,phone,fee_percent,metadata,active)

    values(ident,t,payload->>'name',payload->>'document',payload->>'email',payload->>'phone',coalesce(nullif(payload->>'fee_percent','')::numeric,0),payload-'id'-'entity'-'tenant_id'-'role'-'created_at'-'updated_at',coalesce((payload->>'active')::boolean,true))

    on conflict(id) do update set name=excluded.name,document=excluded.document,email=excluded.email,phone=excluded.phone,fee_percent=excluded.fee_percent,metadata=excluded.metadata,active=excluded.active;

  elsif ent='debtors' then

   select * into c from public.cobranca_creditors where id=(payload->>'creditor_id')::uuid and tenant_id=t and active;

   if not found then raise exception 'Credor inválido';end if;

   if exists(select 1 from public.cobranca_debtors where id=ident and tenant_id<>t) then raise exception 'Registro não encontrado';end if;

   if exists(select 1 from public.cobranca_debts where debtor_id=ident and creditor_id<>c.id) then raise exception 'Devedor com processos não pode mudar de credor';end if;
   select to_jsonb(x) into before_row from public.cobranca_debtors x where id=ident and tenant_id=t;

   insert into public.cobranca_debtors(id,tenant_id,creditor_id,name,document,email,phone,opt_out,metadata)

    values(ident,t,c.id,payload->>'name',payload->>'document',payload->>'email',payload->>'phone',coalesce((payload->>'opt_out')::boolean,false),payload-'id'-'entity'-'tenant_id'-'role'-'created_at'-'updated_at')

    on conflict(id) do update set creditor_id=excluded.creditor_id,name=excluded.name,document=excluded.document,email=excluded.email,phone=excluded.phone,opt_out=excluded.opt_out,metadata=excluded.metadata;

  else

   if ent='expenses' and (coalesce(nullif(payload->>'amount','')::numeric,0)<=0 or nullif(payload->>'due_date','')::date is null) then raise exception 'Valor e vencimento obrigatórios';end if;

   if ent='appointments' then

    assigned:=(payload->>'assigned_to')::uuid;

    if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active and role not in ('commercial','commercial_manager')) then raise exception 'Responsável inválido';end if;

    if not role_admin and assigned<>p.id then raise exception 'Acesso não autorizado';end if;

    if nullif(payload->>'due_at','')::timestamp is null then raise exception 'Data obrigatória';end if;

   end if;

   select * into rec from public.cobranca_records where id=ident;

   if found and (rec.tenant_id<>t or rec.kind<>ent or (p.role='collector' and rec.data->>'assigned_to' is distinct from p.id::text)) then raise exception 'Registro não encontrado';end if;

   before_row:=to_jsonb(rec);

   insert into public.cobranca_records(id,tenant_id,kind,name,data,active) values(ident,t,ent,payload->>'name',payload-'id'-'entity'-'tenant_id'-'role'-'created_at'-'updated_at',coalesce((payload->>'active')::boolean,true))

    on conflict(id) do update set name=excluded.name,data=excluded.data,active=excluded.active,updated_at=now();

  end if;

  perform cobranca_private.audit(t,'save',ent,ident,before_row,payload-'content');return jsonb_build_object('id',ident);

 elsif action='settings' then

  if p.role not in ('master','admin') then raise exception 'Perfil administrador necessário';end if;

  if length(trim(coalesce(payload->>'name','')))=0 or (payload->>'recovery_goal')::numeric<0 then raise exception 'Configuração inválida';end if;

  select to_jsonb(x) into before_row from public.cobranca_tenants x where id=t;

  update public.cobranca_tenants set name=payload->>'name',recovery_goal=(payload->>'recovery_goal')::numeric where id=t;

  perform cobranca_private.audit(t,'settings','tenants',t,before_row,payload);return '{}';

 elsif action='new_process' then

  if not role_admin then raise exception 'Perfil de gestão necessário';end if;

  select * into c from public.cobranca_creditors where id=(payload->>'creditor_id')::uuid and tenant_id=t and active;

  if not found then raise exception 'Credor inválido';end if;

  select * into b from public.cobranca_debtors where id=(payload->>'debtor_id')::uuid and tenant_id=t and creditor_id=c.id;

  if not found then raise exception 'Devedor não vinculado ao credor';end if;

  assigned:=(payload->>'assigned_to')::uuid;

  if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active and role not in ('commercial','commercial_manager')) then raise exception 'Cobrador inválido';end if;

  amount:=(payload->>'original_amount')::numeric;

  if amount is null or (payload->>'original_amount')::numeric<>round((payload->>'original_amount')::numeric,2) or amount<=0 or length(trim(coalesce(payload->>'external_ref','')))=0 or nullif(payload->>'due_date','')::date is null then raise exception 'Número, valor e vencimento obrigatórios';end if;

  if (payload->>'interest_percent')::numeric not between 0 and 100 or (payload->>'fine_percent')::numeric not between 0 and 100 then raise exception 'Taxa inválida';end if;


  if coalesce(payload->>'financial_mode','none') not in ('none','monthly','daily') or coalesce(nullif(payload->>'grace_days','')::int,0) not between 0 and 365 then raise exception 'Regra financeira inválida';end if;
  if coalesce((payload->>'interest_percent')::numeric,0)>0 and coalesce(payload->>'financial_mode','none')='none' then raise exception 'Selecione a periodicidade dos juros';end if;
  if (coalesce((payload->>'interest_percent')::numeric,0)>0 or coalesce((payload->>'fine_percent')::numeric,0)>0) and length(trim(coalesce(payload->>'contract_ref','')))=0 then raise exception 'Informe o contrato que autoriza os encargos';end if;
  payload:=(payload-'financial_frozen'-'agreement_quote')||jsonb_build_object('financial_terms',jsonb_build_object('mode',coalesce(payload->>'financial_mode','none'),'interest_percent',coalesce((payload->>'interest_percent')::numeric,0),'fine_percent',coalesce((payload->>'fine_percent')::numeric,0),'grace_days',coalesce(nullif(payload->>'grace_days','')::int,0),'contract_ref',payload->>'contract_ref','interest_basis','principal_remaining','fine_basis','principal_at_first_overdue','allocation','interest_fine_principal'));

  insert into public.cobranca_debts(tenant_id,creditor_id,debtor_id,external_ref,contract_ref,original_amount,current_amount,due_date,assigned_to,interest_percent,fine_percent,metadata)

   values(t,c.id,b.id,payload->>'external_ref',payload->>'contract_ref',amount,amount,(payload->>'due_date')::date,assigned,(payload->>'interest_percent')::numeric,(payload->>'fine_percent')::numeric,payload-'original_amount'-'creditor_id'-'debtor_id') returning * into d;

  perform cobranca_private.audit(t,'new_process','debts',d.id,null,to_jsonb(d));return to_jsonb(d);

 elsif action in ('detail','status','history','agreement','payment','reverse','document','distribute','download','contract','quote') then

  if action='download' then

   select debt_id into ident from public.cobranca_documents where id=(payload->>'id')::uuid and tenant_id=t;

  elsif action='distribute' then ident:=null;

  else ident:=(payload->>'id')::uuid;end if;

  if action<>'distribute' then

   select * into d from public.cobranca_debts where id=ident for update;

   if not found or not cobranca_private.can_read_debt(p,d) then raise exception 'Processo não encontrado';end if;

  end if;

  if action='quote' then
   if coalesce(nullif(payload->>'as_of','')::date,current_date)>current_date then raise exception 'Data de cálculo futura não permitida';end if;
   return cobranca_private.financial_quote(d,coalesce(nullif(payload->>'as_of','')::date,current_date));
  elsif action='detail' then

   return jsonb_build_object('process',to_jsonb(d)||jsonb_build_object('current_amount',cobranca_private.financial_quote(d)->'total'),'financial',cobranca_private.financial_quote(d),

    'creditor',(select c.metadata||to_jsonb(c) from public.cobranca_creditors c where id=d.creditor_id),

    'history',case when p.role='creditor' and not (p.client_access->>'history')::boolean then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('operator_name',p.name) order by l.created_at desc) from public.cobranca_interaction_logs l left join public.cobranca_profiles p on p.id::text=l.payload->>'actor' where l.debt_id=d.id),'[]') end,

    'agreements',coalesce((select jsonb_agg(to_jsonb(a)) from public.cobranca_agreements a where debt_id=d.id),'[]'),

    'installments',coalesce((select jsonb_agg(to_jsonb(i) order by due_date,installment_number) from public.cobranca_agreement_installments i join public.cobranca_agreements a on a.id=i.agreement_id where a.debt_id=d.id),'[]'),

    'documents',case when p.role='creditor' and not (p.client_access->>'documents')::boolean then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at)) from public.cobranca_documents where debt_id=d.id),'[]') end);

  elsif action='download' then return (select to_jsonb(x) from public.cobranca_documents x where id=(payload->>'id')::uuid and tenant_id=t);

  end if;

  if p.role='creditor' then raise exception 'Portal credor permite somente consulta';end if;

  before_row:=to_jsonb(d);

  if action='contract' then
   if not role_admin then raise exception 'Perfil de gestão necessário';end if;
   if exists(select 1 from public.cobranca_receipts where debt_id=d.id) or exists(select 1 from public.cobranca_agreements where debt_id=d.id) then raise exception 'Processo com movimentos financeiros: regra não pode ser alterada';end if;
   if coalesce(payload->>'financial_mode','') not in ('none','monthly','daily') or coalesce(nullif(payload->>'interest_percent','')::numeric,-1) not between 0 and 100 or coalesce(nullif(payload->>'fine_percent','')::numeric,-1) not between 0 and 100 or coalesce(nullif(payload->>'grace_days','')::int,-1) not between 0 and 365 or length(trim(coalesce(payload->>'contract_ref','')))=0 then raise exception 'Contrato e regra financeira obrigatórios';end if;
   if payload->>'financial_mode'='none' and (payload->>'interest_percent')::numeric>0 then raise exception 'Selecione a periodicidade dos juros';end if;
   update public.cobranca_debts set interest_percent=(payload->>'interest_percent')::numeric,fine_percent=(payload->>'fine_percent')::numeric,contract_ref=payload->>'contract_ref',metadata=metadata||jsonb_build_object('financial_terms',jsonb_build_object('mode',payload->>'financial_mode','interest_percent',(payload->>'interest_percent')::numeric,'fine_percent',(payload->>'fine_percent')::numeric,'grace_days',(payload->>'grace_days')::int,'contract_ref',payload->>'contract_ref','interest_basis','principal_remaining','fine_basis','principal_at_first_overdue','allocation','interest_fine_principal')) where id=d.id;
  elsif action='status' then

   if payload->>'status' not in ('Novo','Em análise','Aguardando contato','Em cobrança','Em negociação','Acordo formalizado','Aguardando pagamento','Parcialmente pago','Quitado','Acordo descumprido','Suspenso','Devolvido ao cliente','Encerrado') then raise exception 'Situação inválida';end if;

   if length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Motivo obrigatório';end if;

   if payload->>'status' in ('Quitado','Parcialmente pago','Acordo formalizado') then raise exception 'Situação calculada pelo fluxo financeiro';end if;

   if payload->>'status' in ('Devolvido ao cliente','Encerrado','Suspenso') and not role_admin then raise exception 'Perfil de gestão necessário';end if;

   update public.cobranca_debts set app_status=payload->>'status' where id=d.id;

  elsif action='history' then

   if payload->>'channel' not in ('human','voice','email','promise') or length(trim(coalesce(payload->>'content','')))=0 then raise exception 'Atendimento inválido';end if;

   if payload->>'channel'='promise' and nullif(payload->>'promised_date','') is null then raise exception 'Data da promessa obrigatória';end if;
   if payload->>'channel'='promise' then update public.cobranca_debts set promised_payment_date=(payload->>'promised_date')::date where id=d.id;end if;

   insert into public.cobranca_interaction_logs(tenant_id,creditor_id,debtor_id,debt_id,channel,direction,subject,content,payload)

    values(t,d.creditor_id,d.debtor_id,d.id,payload->>'channel','internal',payload->>'subject',payload->>'content',jsonb_build_object('actor',p.id));

  elsif action='agreement' then

   if not (cobranca_private.financial_quote(d)->>'configured')::boolean then raise exception 'Regra contratual pendente: configure os encargos antes de negociar';end if;
   d.current_amount:=(cobranca_private.financial_quote(d)->>'total')::numeric;
   if d.current_amount<=0 or exists(select 1 from public.cobranca_agreements where debt_id=d.id and status='active') then raise exception 'Saldo inexistente ou acordo ativo';end if;

   discount:=(payload->>'discount_percent')::numeric;

   if discount is null or discount<0 or discount>p.discount_limit then raise exception 'Desconto acima da alçada. Solicite aprovação de supervisor';end if;

   installments:=(payload->>'installments')::int;entry:=(payload->>'down_payment')::numeric;

   total:=round(d.current_amount*(1-discount/100),2);

   if installments is null or entry is null or installments not between 1 and 120 or entry<0 or entry>=total or (total-entry)*100<installments then raise exception 'Entrada ou quantidade de parcelas inválida';end if;

   if nullif(payload->>'first_due_date','')::date is null or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Vencimento e aceite obrigatórios';end if;

   insert into public.cobranca_agreements(tenant_id,debt_id,debtor_id,status,total_amount,down_payment,installments,first_due_date,notes,created_by)

    values(t,d.id,d.debtor_id,'active',total,entry,installments,(payload->>'first_due_date')::date,payload->>'reason',p.id::text) returning * into a;

   if entry>0 then insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date) values(a.id,0,entry,a.first_due_date);end if;

   part:=trunc((total-entry)/installments,2);remainder:=round(((total-entry)-part*installments)*100)::int;

   for i in 1..installments loop

    insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date)

     values(a.id,i,part+case when i<=remainder then 0.01 else 0 end,(a.first_due_date+(i-1)*interval '1 month')::date);

   end loop;

   update public.cobranca_debts set current_amount=total,metadata=metadata||jsonb_build_object('financial_frozen',true,'agreement_quote',cobranca_private.financial_quote(d)),app_status='Acordo formalizado',status='agreement' where id=d.id;

  elsif action='payment' then

   if not can_finance then raise exception 'Perfil financeiro necessário';end if;

   if not (cobranca_private.financial_quote(d)->>'configured')::boolean then raise exception 'Regra contratual pendente: configure os encargos antes de receber';end if;
   if nullif(payload->>'paid_date','')::date is null then raise exception 'Data do recebimento obrigatória';end if;
   d.current_amount:=(cobranca_private.financial_quote(d,(payload->>'paid_date')::date)->>'total')::numeric;
   amount:=(payload->>'amount')::numeric;

   if amount is null or (payload->>'amount')::numeric<>round((payload->>'amount')::numeric,2) or amount<=0 or amount>d.current_amount or length(trim(coalesce(payload->>'reference','')))=0 or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Recebimento inválido';end if;

   if exists(select 1 from public.cobranca_receipts where debt_id=d.id and not reversed and paid_date>(payload->>'paid_date')::date) then raise exception 'Data anterior ao último recebimento';end if;
   if (payload->>'paid_date')::date>current_date then raise exception 'Pagamento não pode estar no futuro';end if;

   select * into c from public.cobranca_creditors where id=d.creditor_id;

   insert into public.cobranca_receipts(tenant_id,debt_id,reference,amount,fee_amount,paid_date,actor,reason,calculation)

    values(t,d.id,payload->>'reference',amount,round(amount*c.fee_percent/100,2),(payload->>'paid_date')::date,p.id,payload->>'reason',cobranca_private.financial_quote(d,(payload->>'paid_date')::date)) returning * into r;

   unallocated:=amount;

   for inst in select ins.* from public.cobranca_agreement_installments ins join public.cobranca_agreements ag on ag.id=ins.agreement_id

    where ag.debt_id=d.id and ag.status='active' and ins.paid_amount<ins.amount order by ins.due_date,ins.installment_number for update of ins loop

    exit when unallocated=0;

    allocated:=least(unallocated,inst.amount-inst.paid_amount);

    insert into public.cobranca_payment_allocations(receipt_id,installment_id,amount) values(r.id,inst.id,allocated);

    update public.cobranca_agreement_installments set paid_amount=paid_amount+allocated,

     status=case when paid_amount+allocated=amount then 'paid' else 'open' end,

     paid_at=case when paid_amount+allocated=amount then now() else null end where id=inst.id;

    unallocated:=unallocated-allocated;

   end loop;

   update public.cobranca_debts set current_amount=d.current_amount-amount,

    app_status=case when d.current_amount=amount then 'Quitado' else 'Parcialmente pago' end,

    status=case when d.current_amount=amount then 'paid' else status end where id=d.id;

   if amount=d.current_amount then update public.cobranca_agreements set status='paid' where debt_id=d.id and status='active';end if;

  elsif action='reverse' then

   if not can_finance then raise exception 'Perfil financeiro necessário';end if;

   select * into r from public.cobranca_receipts where id=(payload->>'receipt_id')::uuid and debt_id=d.id and tenant_id=t for update;

   if not found or r.reversed then raise exception 'Recebimento não encontrado ou já estornado';end if;

   if length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Motivo obrigatório';end if;

   update public.cobranca_receipts set reversed=true where id=r.id;

   for allocation in select * from public.cobranca_payment_allocations where receipt_id=r.id loop

    update public.cobranca_agreement_installments set paid_amount=paid_amount-allocation.amount,status='open',paid_at=null where id=allocation.installment_id;

   end loop;

   update public.cobranca_agreements set status='active' where debt_id=d.id and status='paid';

   update public.cobranca_debts set current_amount=current_amount+r.amount,app_status='Em cobrança',status='open' where id=d.id;

  elsif action='document' then

   if payload->>'mime' not in ('application/pdf','image/png','image/jpeg') then raise exception 'Tipo de arquivo não permitido';end if;

   if octet_length(decode(payload->>'content','base64'))>5242880 then raise exception 'Arquivo excede 5 MB';end if;

   if payload->>'mime'='application/pdf' and substring(decode(payload->>'content','base64') from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'PDF inválido';end if;

   if payload->>'mime'='image/png' and encode(substring(decode(payload->>'content','base64') from 1 for 8),'hex')<>'89504e470d0a1a0a' then raise exception 'PNG inválido';end if;

   if payload->>'mime'='image/jpeg' and encode(substring(decode(payload->>'content','base64') from 1 for 3),'hex')<>'ffd8ff' then raise exception 'JPEG inválido';end if;

   insert into public.cobranca_documents(tenant_id,debt_id,name,mime,content) values(t,d.id,regexp_replace(payload->>'name','[\\/]','','g'),payload->>'mime',payload->>'content');

  elsif action='distribute' then

   if not role_admin then raise exception 'Perfil de gestão necessário';end if;

   assigned:=(payload->>'assigned_to')::uuid;

   if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active and role not in ('commercial','commercial_manager')) or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Responsável e motivo obrigatórios';end if;

   if jsonb_array_length(payload->'ids')>500 then raise exception 'Máximo de 500 processos por distribuição';end if;

   for ident in select value::uuid from jsonb_array_elements_text(payload->'ids') loop

    select * into d from public.cobranca_debts where id=ident and tenant_id=t for update;

    if not found then raise exception 'Processo não encontrado';end if;

    perform cobranca_private.audit(t,'distribute','debts',d.id,to_jsonb(d),payload-'ids');

    update public.cobranca_debts set assigned_to=assigned where id=ident;

   end loop;return '{}';

  end if;

  if action in ('payment','reverse') and d.metadata->'financial_terms' is not null and not coalesce((d.metadata->>'financial_frozen')::boolean,false) then
   update public.cobranca_debts x set current_amount=(cobranca_private.financial_quote(x)->>'total')::numeric where x.id=d.id;
  end if;
  select to_jsonb(x) into result from public.cobranca_debts x where id=d.id;

  perform cobranca_private.audit(t,action,'debts',d.id,before_row,result);

  if action<>'history' then insert into public.cobranca_interaction_logs(tenant_id,debt_id,debtor_id,creditor_id,channel,direction,subject,content,payload)

   values(t,d.id,d.debtor_id,d.creditor_id,'system','internal',action,coalesce(payload->>'reason',action),jsonb_build_object('actor',p.id));end if;

  return coalesce(result,'{}');

 elsif action='report' then

  select jsonb_build_object('portfolio',coalesce(sum(original_amount),0),'outstanding',coalesce(sum(current_amount),0),

   'active',count(*) filter(where app_status not in ('Quitado','Encerrado','Devolvido ao cliente')),

   'closed',count(*) filter(where app_status in ('Quitado','Encerrado','Devolvido ao cliente')),

   'overdue',coalesce(sum(current_amount) filter(where due_date<current_date),0),

   'no_history',count(*) filter(where coalesce(last_history,created_at)<now()-interval '7 days'),

   'promises',count(*) filter(where promised_payment_date>=current_date)) into result

   from cobranca_private.process_list d where cobranca_private.can_read_debt(p,(select x from public.cobranca_debts x where x.id=d.id)) and cobranca_private.matches(d,f);

  result:=result||(select jsonb_build_object('recovered',coalesce(sum(r.amount),0),'fees',coalesce(sum(r.fee_amount),0),'remittances',coalesce(sum(r.amount-r.fee_amount),0))

   from public.cobranca_receipts r join public.cobranca_debts d on d.id=r.debt_id where not r.reversed and cobranca_private.can_read_debt(p,d)

   and (nullif(f->>'start','') is null or r.paid_date>=nullif(f->>'start','')::date) and (nullif(f->>'end','') is null or r.paid_date<=nullif(f->>'end','')::date));

  result:=result||(select jsonb_build_object('agreements',count(*) filter(where a.status='active'),'broken',count(*) filter(where a.status='broken')) from public.cobranca_agreements a join public.cobranca_debts d on d.id=a.debt_id where cobranca_private.can_read_debt(p,d));

  if payload->>'report' in ('Recebimentos','Consulta de Recebimentos','Financeiro','Honorários e Repasses') then

   select coalesce(jsonb_agg(to_jsonb(r) order by r.paid_date desc),'[]') into before_row from public.cobranca_receipts r join public.cobranca_debts d on d.id=r.debt_id

    where cobranca_private.can_read_debt(p,d) and (nullif(f->>'start','') is null or r.paid_date>=nullif(f->>'start','')::date) and (nullif(f->>'end','') is null or r.paid_date<=nullif(f->>'end','')::date);

  elsif payload->>'report'='Histórico do Processo' then

   select coalesce(jsonb_agg(jsonb_build_object('processo',d.external_ref,'data',l.created_at,'canal',l.channel,'assunto',l.subject,'descricao',l.content) order by l.created_at desc),'[]') into before_row

   from public.cobranca_interaction_logs l join public.cobranca_debts d on d.id=l.debt_id

   where cobranca_private.can_read_debt(p,d) and (nullif(f->>'start','') is null or l.created_at::date>=(f->>'start')::date) and (nullif(f->>'end','') is null or l.created_at::date<=(f->>'end')::date);

  elsif payload->>'report'='Processos do Cliente — Totais' then

   select coalesce(jsonb_agg(to_jsonb(x)),'[]') into before_row from

   (select d.creditor_name as cliente,count(*) as processos,sum(d.original_amount) as valor_original,sum(d.current_amount) as saldo

    from cobranca_private.process_list d where cobranca_private.can_read_debt(p,(select x from public.cobranca_debts x where x.id=d.id)) and cobranca_private.matches(d,f) group by d.creditor_name) x;

  elsif payload->>'report' in ('E-mail de Clientes','Clientes Inativos') then

   select coalesce(jsonb_agg(jsonb_build_object('name',c.name,'email',c.email,'active',c.active)),'[]') into before_row from public.cobranca_creditors c where c.tenant_id=t and (p.role<>'creditor' or c.id=p.creditor_id) and (payload->>'report'<>'Clientes Inativos' or not c.active);

  else select coalesce(jsonb_agg(jsonb_build_object('processo',d.external_ref,'cliente',d.creditor_name,'devedor',d.debtor_name,'saldo',d.current_amount,'situacao',d.app_status)),'[]') into before_row from cobranca_private.process_list d

    where cobranca_private.can_read_debt(p,(select x from public.cobranca_debts x where x.id=d.id)) and cobranca_private.matches(d,f);end if;

  if p.role='collector' then result:=result-'fees'-'remittances';end if;
  return jsonb_build_object('metrics',result,'rows',before_row);

 elsif action='notifications' then

  select coalesce(jsonb_agg(jsonb_build_object('processo',external_ref,'vencimento',due_date,'saldo',current_amount)),'[]') into result from public.cobranca_debts d where cobranca_private.can_read_debt(p,d) and current_amount>0 and (due_date<current_date or promised_payment_date=current_date);return result;

 elsif action='import' then

  if not role_admin or ent not in ('creditors','debtors') then raise exception 'Importação não autorizada';end if;

  if jsonb_typeof(payload->'rows')<>'array' or jsonb_array_length(payload->'rows') not between 1 and 500 then raise exception 'Importe entre 1 e 500 registros por arquivo';end if;

  for before_row in select value from jsonb_array_elements(payload->'rows') loop

   if before_row ? 'id' then raise exception 'Importação não permite sobrescrever IDs';end if;

   perform cobranca_private.api('save',before_row||jsonb_build_object('entity',ent));

  end loop;

  return jsonb_build_object('count',jsonb_array_length(payload->'rows'));

 end if;

 raise exception 'Ação não disponível';

end $$;