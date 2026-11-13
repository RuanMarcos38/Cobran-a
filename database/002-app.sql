-- Aplicar somente no projeto separado do Cobran-a, após supabase-schema.sql.
-- Não altera qualquer tabela de ERP/CRM externo.
begin;
create schema if not exists cobranca_private;
revoke all on schema cobranca_private from public, anon;
create table public.cobranca_profiles (
 id uuid primary key references auth.users(id),
 tenant_id uuid not null references public.cobranca_tenants(id),
 name text not null,
 role text not null check(role in ('master','admin','supervisor','collector','finance','creditor')),
 creditor_id uuid references public.cobranca_creditors(id),
 discount_limit numeric(5,2) not null default 0 check(discount_limit between 0 and 100),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 check(role <> 'creditor' or creditor_id is not null)
);
alter table public.cobranca_tenants add column recovery_goal numeric(14,2) not null default 0;
alter table public.cobranca_creditors add column metadata jsonb not null default '{}';
alter table public.cobranca_creditors add column fee_percent numeric(5,2) not null default 0 check(fee_percent between 0 and 100);
alter table public.cobranca_debts add column assigned_to uuid references public.cobranca_profiles(id);
alter table public.cobranca_debts add column app_status text not null default 'Novo';
alter table public.cobranca_debts add column interest_percent numeric(5,2) not null default 0;
alter table public.cobranca_debts add column fine_percent numeric(5,2) not null default 0;
create unique index cobranca_debts_ref_tenant on public.cobranca_debts(tenant_id,external_ref) where external_ref is not null;
create index cobranca_debts_tenant_assigned on public.cobranca_debts(tenant_id,assigned_to);
create index cobranca_creditors_tenant_name on public.cobranca_creditors(tenant_id,name);
create index cobranca_debtors_tenant_name on public.cobranca_debtors(tenant_id,name);
create table public.cobranca_records (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.cobranca_tenants(id),
 kind text not null check(kind in ('auxiliary','expenses','leads','appointments')),
 name text not null check(length(trim(name))>0),
 data jsonb not null default '{}',
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index cobranca_records_tenant_kind on public.cobranca_records(tenant_id,kind);
create table public.cobranca_receipts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.cobranca_tenants(id),
 debt_id uuid not null references public.cobranca_debts(id),
 reference text not null,
 amount numeric(14,2) not null check(amount>0),
 fee_amount numeric(14,2) not null default 0,
 paid_date date not null,
 actor uuid not null references public.cobranca_profiles(id),
 reason text not null,
 reversed boolean not null default false,
 created_at timestamptz not null default now(),
 unique(tenant_id,reference)
);
create table public.cobranca_documents (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.cobranca_tenants(id),
 debt_id uuid not null references public.cobranca_debts(id),
 name text not null,
 mime text not null check(mime in ('application/pdf','image/png','image/jpeg')),
 content text not null check(length(content)<=7000000),
 created_at timestamptz not null default now()
);
alter table public.cobranca_agreement_installments add column paid_amount numeric(14,2) not null default 0 check(paid_amount>=0 and paid_amount<=amount);
create table public.cobranca_payment_allocations (
 id uuid primary key default gen_random_uuid(),
 receipt_id uuid not null references public.cobranca_receipts(id),
 installment_id uuid not null references public.cobranca_agreement_installments(id),
 amount numeric(14,2) not null check(amount>0),
 unique(receipt_id,installment_id)
);
create view cobranca_private.process_list as
 select d.*,c.name creditor_name,c.document creditor_document,b.name debtor_name,b.phone,
 coalesce(b.metadata->>'city','') city, p.name collector_name,
 (current_date-d.created_at::date) days,
 d.metadata->>'team' team,d.metadata->>'supervisor' supervisor,d.metadata->>'carrier' carrier,
 d.metadata->>'commercial' commercial,d.metadata->>'forwarded_at' forwarded_at,
 d.metadata->>'stay_days' stay_days,d.metadata->>'return_reason' return_reason,
 c.metadata->>'group' company_group,
 (select max(created_at) from public.cobranca_interaction_logs l where l.debt_id=d.id) last_history,
 (select max(paid_date) from public.cobranca_receipts r where r.debt_id=d.id and not r.reversed) payment_at
 from public.cobranca_debts d join public.cobranca_creditors c on c.id=d.creditor_id
 join public.cobranca_debtors b on b.id=d.debtor_id left join public.cobranca_profiles p on p.id=d.assigned_to;

-- Tables have RLS enabled and no direct browser mutation privileges.
-- The private API validates membership and related IDs for every call.
do $$declare t text;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'cobranca_%' loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;

create function cobranca_private.audit(t uuid,operation text,entity text,entity_id uuid,before_row jsonb,after_row jsonb)
returns void language sql set search_path='' as $$
 insert into public.cobranca_audit_logs(tenant_id,actor,action,entity_type,entity_id,before_data,after_data)
 values(t,auth.uid()::text,operation,entity,entity_id,before_row,after_row)
$$;

create function cobranca_private.can_read_debt(p public.cobranca_profiles,d public.cobranca_debts)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(d.tenant_id=p.tenant_id and
 (p.role not in ('collector','creditor') or (p.role='collector' and d.assigned_to=p.id) or (p.role='creditor' and d.creditor_id=p.creditor_id)),false)
$$;

create function cobranca_private.matches(d cobranca_private.process_list,f jsonb)
returns boolean language sql stable set search_path='' as $$
 select
 (coalesce(f->>'search','')='' or concat(d.external_ref,' ',d.creditor_name,' ',d.debtor_name) ilike '%'||(f->>'search')||'%')
 and (coalesce(f->>'process','')='' or d.external_ref ilike '%'||(f->>'process')||'%')
 and (coalesce(f->>'creditor_id','')='' or d.creditor_id::text=f->>'creditor_id')
 and (coalesce(f->>'debtor','')='' or d.debtor_name ilike '%'||(f->>'debtor')||'%')
 and (coalesce(f->>'client_code','')='' or d.creditor_id::text ilike '%'||(f->>'client_code')||'%')
 and (coalesce(f->>'group','')='' or d.company_group ilike '%'||(f->>'group')||'%')
 and (coalesce(f->>'commercial','')='' or d.commercial ilike '%'||(f->>'commercial')||'%')
 and (coalesce(f->>'carrier','')='' or d.carrier ilike '%'||(f->>'carrier')||'%')
 and (coalesce(f->>'assigned_to','')='' or d.assigned_to::text=f->>'assigned_to')
 and (nullif(f->>'start','') is null or d.created_at::date>=nullif(f->>'start','')::date)
 and (nullif(f->>'end','') is null or d.created_at::date<=nullif(f->>'end','')::date)
 and (nullif(f->>'min','') is null or d.current_amount>=nullif(f->>'min','')::numeric)
 and (nullif(f->>'max','') is null or d.current_amount<=nullif(f->>'max','')::numeric)
 and (coalesce(f->>'status','')='' or d.app_status=f->>'status')
 and (coalesce(f->>'scope','Todos')='Todos' or
  (f->>'scope'='Abertos' and d.app_status not in ('Quitado','Encerrado','Devolvido ao cliente','Suspenso')) or
  (f->>'scope'='Encerrados' and d.app_status in ('Quitado','Encerrado','Devolvido ao cliente')) or
  (f->>'scope'='Suspensos' and d.app_status='Suspenso'))
 and (nullif(f->>'payment_start','') is null or d.payment_at>=nullif(f->>'payment_start','')::date)
 and (nullif(f->>'payment_end','') is null or d.payment_at<=nullif(f->>'payment_end','')::date)
 and (nullif(f->>'overdue_min','') is null or current_date-d.due_date>=nullif(f->>'overdue_min','')::int)
 and (nullif(f->>'overdue_max','') is null or current_date-d.due_date<=nullif(f->>'overdue_max','')::int)
 and (coalesce(f->>'phone','')='' or regexp_replace(d.phone,'\D','','g') like '%'||regexp_replace(f->>'phone','\D','','g')||'%')
 and (coalesce(f->>'return_reason','')='' or d.return_reason ilike '%'||(f->>'return_reason')||'%')
 and (nullif(f->>'inactive_days','') is null or current_date-coalesce(d.last_history,d.created_at)::date>=nullif(f->>'inactive_days','')::int)
$$;

create function cobranca_private.api(action text,payload jsonb)
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
 if action='profile' then
  return to_jsonb(p)||(select jsonb_build_object('tenant_name',name,'recovery_goal',recovery_goal) from public.cobranca_tenants where id=t);
 elsif action='lookups' then
  return jsonb_build_object('creditors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_creditors where tenant_id=t and active and (p.role<>'creditor' or id=p.creditor_id)),'[]'),
   'debtors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_debtors b where b.tenant_id=t and (p.role not in ('collector','creditor') or exists(select 1 from public.cobranca_debts d where d.debtor_id=b.id and cobranca_private.can_read_debt(p,d)))),'[]'),
   'users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_profiles where tenant_id=t and active and (role_admin or id=p.id)),'[]'));
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
   select coalesce(jsonb_agg(to_jsonb(c)||c.metadata),'[]') into result from public.cobranca_creditors c where tenant_id=t and (p.role<>'creditor' or c.id=p.creditor_id);
  elsif ent='debtors' then
   select coalesce(jsonb_agg(to_jsonb(b)||b.metadata),'[]') into result from public.cobranca_debtors b where tenant_id=t and (p.role<>'collector' or exists(select 1 from public.cobranca_debts d where d.debtor_id=b.id and d.assigned_to=p.id));
  else
   select coalesce(jsonb_agg(to_jsonb(r)||r.data),'[]') into result from public.cobranca_records r where tenant_id=t and kind=ent and (p.role<>'collector' or data->>'assigned_to'=p.id::text);
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
  if length(trim(coalesce(payload->>'name','')))=0 then raise exception 'Nome obrigatório';end if;
  ident:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  if ent='creditors' then
   select to_jsonb(x) into before_row from public.cobranca_creditors x where id=ident and tenant_id=t;
   if exists(select 1 from public.cobranca_creditors where id=ident and tenant_id<>t) then raise exception 'Registro não encontrado';end if;
   insert into public.cobranca_creditors(id,tenant_id,name,document,email,phone,fee_percent,metadata,active)
    values(ident,t,payload->>'name',payload->>'document',payload->>'email',payload->>'phone',coalesce(nullif(payload->>'fee_percent','')::numeric,0),payload-'id'-'entity',coalesce((payload->>'active')::boolean,true))
    on conflict(id) do update set name=excluded.name,document=excluded.document,email=excluded.email,phone=excluded.phone,fee_percent=excluded.fee_percent,metadata=excluded.metadata,active=excluded.active;
  elsif ent='debtors' then
   select * into c from public.cobranca_creditors where id=(payload->>'creditor_id')::uuid and tenant_id=t;
   if not found then raise exception 'Credor inválido';end if;
   if exists(select 1 from public.cobranca_debtors where id=ident and tenant_id<>t) then raise exception 'Registro não encontrado';end if;
   select to_jsonb(x) into before_row from public.cobranca_debtors x where id=ident and tenant_id=t;
   insert into public.cobranca_debtors(id,tenant_id,creditor_id,name,document,email,phone,opt_out,metadata)
    values(ident,t,c.id,payload->>'name',payload->>'document',payload->>'email',payload->>'phone',coalesce((payload->>'opt_out')::boolean,false),payload-'id'-'entity')
    on conflict(id) do update set name=excluded.name,document=excluded.document,email=excluded.email,phone=excluded.phone,opt_out=excluded.opt_out,metadata=excluded.metadata;
  else
   if ent='expenses' and (coalesce(nullif(payload->>'amount','')::numeric,0)<=0 or nullif(payload->>'due_date','')::date is null) then raise exception 'Valor e vencimento obrigatórios';end if;
   if ent='appointments' then
    assigned:=(payload->>'assigned_to')::uuid;
    if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active) then raise exception 'Responsável inválido';end if;
    if not role_admin and assigned<>p.id then raise exception 'Acesso não autorizado';end if;
    if nullif(payload->>'due_at','')::timestamp is null then raise exception 'Data obrigatória';end if;
   end if;
   select * into rec from public.cobranca_records where id=ident;
   if found and (rec.tenant_id<>t or rec.kind<>ent or (p.role='collector' and rec.data->>'assigned_to'<>p.id::text)) then raise exception 'Registro não encontrado';end if;
   before_row:=to_jsonb(rec);
   insert into public.cobranca_records(id,tenant_id,kind,name,data,active) values(ident,t,ent,payload->>'name',payload-'id'-'entity',coalesce((payload->>'active')::boolean,true))
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
  if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active) then raise exception 'Cobrador inválido';end if;
  amount:=(payload->>'original_amount')::numeric;
  if amount<=0 or length(trim(coalesce(payload->>'external_ref','')))=0 or nullif(payload->>'due_date','')::date is null then raise exception 'Número, valor e vencimento obrigatórios';end if;
  if (payload->>'interest_percent')::numeric not between 0 and 100 or (payload->>'fine_percent')::numeric not between 0 and 100 then raise exception 'Taxa inválida';end if;
  insert into public.cobranca_debts(tenant_id,creditor_id,debtor_id,external_ref,contract_ref,original_amount,current_amount,due_date,assigned_to,interest_percent,fine_percent,metadata)
   values(t,c.id,b.id,payload->>'external_ref',payload->>'contract_ref',amount,amount,(payload->>'due_date')::date,assigned,(payload->>'interest_percent')::numeric,(payload->>'fine_percent')::numeric,payload-'original_amount'-'creditor_id'-'debtor_id') returning * into d;
  perform cobranca_private.audit(t,'new_process','debts',d.id,null,to_jsonb(d));return to_jsonb(d);
 elsif action in ('detail','status','history','agreement','payment','reverse','document','distribute','download') then
  if action='download' then
   select debt_id into ident from public.cobranca_documents where id=(payload->>'id')::uuid and tenant_id=t;
  elsif action='distribute' then ident:=null;
  else ident:=(payload->>'id')::uuid;end if;
  if action<>'distribute' then
   select * into d from public.cobranca_debts where id=ident for update;
   if not found or not cobranca_private.can_read_debt(p,d) then raise exception 'Processo não encontrado';end if;
  end if;
  if action='detail' then
   return jsonb_build_object('process',to_jsonb(d),
    'creditor',(select to_jsonb(c)||c.metadata from public.cobranca_creditors c where id=d.creditor_id),
    'history',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('operator_name',p.name) order by l.created_at desc) from public.cobranca_interaction_logs l left join public.cobranca_profiles p on p.id::text=l.payload->>'actor' where l.debt_id=d.id),'[]'),
    'agreements',coalesce((select jsonb_agg(to_jsonb(a)) from public.cobranca_agreements a where debt_id=d.id),'[]'),
    'installments',coalesce((select jsonb_agg(to_jsonb(i) order by due_date,installment_number) from public.cobranca_agreement_installments i join public.cobranca_agreements a on a.id=i.agreement_id where a.debt_id=d.id),'[]'),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at)) from public.cobranca_documents where debt_id=d.id),'[]'));
  elsif action='download' then return (select to_jsonb(x) from public.cobranca_documents x where id=(payload->>'id')::uuid and tenant_id=t);
  end if;
  if p.role='creditor' then raise exception 'Portal credor permite somente consulta';end if;
  before_row:=to_jsonb(d);
  if action='status' then
   if payload->>'status' not in ('Novo','Em análise','Aguardando contato','Em cobrança','Em negociação','Acordo formalizado','Aguardando pagamento','Parcialmente pago','Quitado','Acordo descumprido','Suspenso','Devolvido ao cliente','Encerrado') then raise exception 'Situação inválida';end if;
   if length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Motivo obrigatório';end if;
   if payload->>'status' in ('Quitado','Parcialmente pago','Acordo formalizado') then raise exception 'Situação calculada pelo fluxo financeiro';end if;
   if payload->>'status' in ('Devolvido ao cliente','Encerrado','Suspenso') and not role_admin then raise exception 'Perfil de gestão necessário';end if;
   update public.cobranca_debts set app_status=payload->>'status' where id=d.id;
  elsif action='history' then
   if payload->>'channel' not in ('human','voice','email','promise') or length(trim(coalesce(payload->>'content','')))=0 then raise exception 'Atendimento inválido';end if;
   if payload->>'channel'='promise' then update public.cobranca_debts set promised_payment_date=(payload->>'promised_date')::date where id=d.id;end if;
   insert into public.cobranca_interaction_logs(tenant_id,creditor_id,debtor_id,debt_id,channel,direction,subject,content,payload)
    values(t,d.creditor_id,d.debtor_id,d.id,payload->>'channel','internal',payload->>'subject',payload->>'content',jsonb_build_object('actor',p.id));
  elsif action='agreement' then
   if d.current_amount<=0 or exists(select 1 from public.cobranca_agreements where debt_id=d.id and status='active') then raise exception 'Saldo inexistente ou acordo ativo';end if;
   discount:=(payload->>'discount_percent')::numeric;
   if discount<0 or discount>p.discount_limit then raise exception 'Desconto acima da alçada. Solicite aprovação de supervisor';end if;
   installments:=(payload->>'installments')::int;entry:=(payload->>'down_payment')::numeric;
   total:=round(d.current_amount*(1-discount/100),2);
   if installments not between 1 and 120 or entry<0 or entry>=total or (total-entry)*100<installments then raise exception 'Entrada ou quantidade de parcelas inválida';end if;
   if nullif(payload->>'first_due_date','')::date is null or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Vencimento e aceite obrigatórios';end if;
   insert into public.cobranca_agreements(tenant_id,debt_id,debtor_id,status,total_amount,down_payment,installments,first_due_date,notes,created_by)
    values(t,d.id,d.debtor_id,'active',total,entry,installments,(payload->>'first_due_date')::date,payload->>'reason',p.id::text) returning * into a;
   if entry>0 then insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date) values(a.id,0,entry,a.first_due_date);end if;
   part:=trunc((total-entry)/installments,2);remainder:=round(((total-entry)-part*installments)*100)::int;
   for i in 1..installments loop
    insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date)
     values(a.id,i,part+case when i<=remainder then 0.01 else 0 end,(a.first_due_date+(i-1)*interval '1 month')::date);
   end loop;
   update public.cobranca_debts set current_amount=total,app_status='Acordo formalizado',status='agreement' where id=d.id;
  elsif action='payment' then
   if not can_finance then raise exception 'Perfil financeiro necessário';end if;
   amount:=(payload->>'amount')::numeric;
   if amount<=0 or amount>d.current_amount or length(trim(coalesce(payload->>'reference','')))=0 or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Recebimento inválido';end if;
   if (payload->>'paid_date')::date>current_date then raise exception 'Pagamento não pode estar no futuro';end if;
   select * into c from public.cobranca_creditors where id=d.creditor_id;
   insert into public.cobranca_receipts(tenant_id,debt_id,reference,amount,fee_amount,paid_date,actor,reason)
    values(t,d.id,payload->>'reference',amount,round(amount*c.fee_percent/100,2),(payload->>'paid_date')::date,p.id,payload->>'reason') returning * into r;
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
   update public.cobranca_debts set current_amount=current_amount-amount,
    app_status=case when current_amount=amount then 'Quitado' else 'Parcialmente pago' end,
    status=case when current_amount=amount then 'paid' else status end where id=d.id;
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
   if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active) or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Responsável e motivo obrigatórios';end if;
   if jsonb_array_length(payload->'ids')>500 then raise exception 'Máximo de 500 processos por distribuição';end if;
   for ident in select value::uuid from jsonb_array_elements_text(payload->'ids') loop
    select * into d from public.cobranca_debts where id=ident and tenant_id=t for update;
    if not found then raise exception 'Processo não encontrado';end if;
    perform cobranca_private.audit(t,'distribute','debts',d.id,to_jsonb(d),payload-'ids');
    update public.cobranca_debts set assigned_to=assigned where id=ident;
   end loop;return '{}';
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
  elsif payload->>'report' in ('E-mail de Clientes','Clientes Inativos') then
   select coalesce(jsonb_agg(jsonb_build_object('name',c.name,'email',c.email,'active',c.active)),'[]') into before_row from public.cobranca_creditors c where c.tenant_id=t and (p.role<>'creditor' or c.id=p.creditor_id) and (payload->>'report'<>'Clientes Inativos' or not c.active);
  else select coalesce(jsonb_agg(jsonb_build_object('processo',d.external_ref,'cliente',d.creditor_name,'devedor',d.debtor_name,'saldo',d.current_amount,'situacao',d.app_status)),'[]') into before_row from cobranca_private.process_list d
    where cobranca_private.can_read_debt(p,(select x from public.cobranca_debts x where x.id=d.id)) and cobranca_private.matches(d,f);end if;
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

revoke all on all functions in schema cobranca_private from public,anon,authenticated;
grant usage on schema cobranca_private to authenticated;
grant execute on function cobranca_private.api(text,jsonb) to authenticated;
create function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select cobranca_private.api(action,payload) $$;
revoke all on function public.cobranca_app(text,jsonb) from public,anon;
grant execute on function public.cobranca_app(text,jsonb) to authenticated;
commit;
