-- Verified-email membership; each company keeps a separate tenant.
create table if not exists cobranca_private.invitations (
 id uuid primary key default gen_random_uuid(),email text not null unique,tenant_id uuid not null references public.cobranca_tenants(id),name text not null,role text not null check(role in ('admin','supervisor','collector','finance','creditor')),creditor_id uuid references public.cobranca_creditors(id),discount_limit numeric(5,2) not null check(discount_limit between 0 and 100),active boolean not null default true,expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default now(),claimed_by uuid references auth.users(id),check(role<>'creditor' or creditor_id is not null)
);
revoke all on cobranca_private.invitations from public,anon,authenticated;
create or replace function cobranca_private.membership(operation text,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();address text;verified timestamptz;inv cobranca_private.invitations;tenant uuid;company_name text;
begin
 if uid is null then raise exception 'Autenticação necessária';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select lower(email),email_confirmed_at into address,verified from auth.users where id=uid;
 if verified is null then raise exception 'Confirme seu e-mail antes de acessar';end if;
 if exists(select 1 from public.cobranca_profiles where id=uid) then
  if not exists(select 1 from public.cobranca_profiles where id=uid and active) then raise exception 'Acesso desativado. Procure o administrador';end if;
  return jsonb_build_object('ready',true);
 end if;
 if operation='claim' then
  select * into inv from cobranca_private.invitations where email=address and active and claimed_by is null and expires_at>now() for update;
  if not found then return jsonb_build_object('ready',false);end if;
  insert into public.cobranca_profiles(id,tenant_id,name,role,creditor_id,discount_limit) values(uid,inv.tenant_id,inv.name,inv.role,inv.creditor_id,inv.discount_limit);
  update cobranca_private.invitations set claimed_by=uid,active=false where id=inv.id;
  perform cobranca_private.audit(inv.tenant_id,'accept_invitation','profiles',uid,null,jsonb_build_object('role',inv.role));
 elsif operation='create_company' then
  if exists(select 1 from cobranca_private.invitations where email=address and active and claimed_by is null and expires_at>now()) or exists(select 1 from cobranca_private.bootstrap where email=address and claimed_by is null) then raise exception 'Use o acesso autorizado para este e-mail';end if;
  company_name:=trim(coalesce(payload->>'name',''));
  if length(company_name) not between 2 and 250 then raise exception 'Informe o nome da empresa, entre 2 e 250 caracteres';end if;
  insert into public.cobranca_tenants(name) values(company_name) returning id into tenant;
  insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit) values(uid,tenant,'Administrador','admin',100);
  perform cobranca_private.audit(tenant,'create_company','tenants',tenant,null,jsonb_build_object('name',company_name));
 else raise exception 'Operação inválida';end if;
 return jsonb_build_object('ready',true);
end $$;
revoke all on function cobranca_private.membership(text,jsonb) from public,anon;
grant execute on function cobranca_private.membership(text,jsonb) to authenticated;
create or replace function public.cobranca_membership(operation text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.membership(operation,payload)$$;
revoke all on function public.cobranca_membership(text,jsonb) from public,anon;
grant execute on function public.cobranca_membership(text,jsonb) to authenticated;
create or replace function cobranca_private.team(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;target public.cobranca_profiles;inv cobranca_private.invitations;ident uuid;address text;chosen_role text;limit_percent numeric;creditor uuid;enabled boolean;result jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master') then raise exception 'Administrador necessário';end if;
 if payload->>'operation'='list' then
  select coalesce(jsonb_agg(row_data order by row_data->>'name'),'[]') into result from (
   select jsonb_build_object('id',x.id,'name',x.name,'email',u.email,'role',x.role,'creditor_id',x.creditor_id,'discount_limit',x.discount_limit,'active',x.active,'invitation',false) row_data from public.cobranca_profiles x join auth.users u on u.id=x.id where x.tenant_id=p.tenant_id
   union all select jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'role',i.role,'creditor_id',i.creditor_id,'discount_limit',i.discount_limit,'active',i.active,'expires_at',i.expires_at,'invitation',true) from cobranca_private.invitations i where i.tenant_id=p.tenant_id and i.claimed_by is null
  ) rows;
  return jsonb_build_object('rows',result,'count',jsonb_array_length(result),'total',null);
 elsif payload->>'operation'<>'save' then raise exception 'Operação inválida';end if;
 ident:=nullif(payload->>'id','')::uuid;address:=lower(trim(coalesce(payload->>'email','')));chosen_role:=payload->>'role';limit_percent:=coalesce(nullif(payload->>'discount_limit','')::numeric,-1);enabled:=coalesce((payload->>'active')::boolean,true);creditor:=nullif(payload->>'creditor_id','')::uuid;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 250 or coalesce(chosen_role,'') not in ('admin','supervisor','collector','finance','creditor') or limit_percent not between 0 and 100 then raise exception 'Nome, perfil ou alçada inválidos';end if;
 if chosen_role='creditor' and not exists(select 1 from public.cobranca_creditors where id=creditor and tenant_id=p.tenant_id and active) then raise exception 'Cliente credor inválido';end if;
 if chosen_role<>'creditor' then creditor:=null;end if;
 if ident is not null and not coalesce((payload->>'invitation')::boolean,false) then
  select * into target from public.cobranca_profiles where id=ident and tenant_id=p.tenant_id for update;
  if not found then raise exception 'Usuário não encontrado';end if;
  if target.role='master' then raise exception 'Perfil reservado';end if;
  if ident=p.id and (chosen_role<>'admin' or not enabled) then raise exception 'Você não pode desativar ou remover seu próprio acesso administrativo';end if;
  update public.cobranca_profiles set name=payload->>'name',role=chosen_role,creditor_id=creditor,discount_limit=limit_percent,active=enabled where id=ident;
  perform cobranca_private.audit(p.tenant_id,'update_member','profiles',ident,to_jsonb(target),payload-'email');
 else
  if address !~ '^[^ @]+@[^ @]+\.[^ @]+$' or length(address)>254 then raise exception 'E-mail inválido';end if;
  if exists(select 1 from auth.users u join public.cobranca_profiles x on x.id=u.id where lower(u.email)=address) then raise exception 'E-mail já possui acesso. Edite o usuário na sua empresa';end if;
  select * into inv from cobranca_private.invitations where email=address for update;
  if found and (inv.tenant_id<>p.tenant_id or (ident is not null and inv.id<>ident)) then raise exception 'E-mail indisponível para convite';end if;
  if ident is not null and not exists(select 1 from cobranca_private.invitations where id=ident and tenant_id=p.tenant_id and email=address) then raise exception 'Convite não encontrado';end if;
  insert into cobranca_private.invitations(email,tenant_id,name,role,creditor_id,discount_limit,active) values(address,p.tenant_id,payload->>'name',chosen_role,creditor,limit_percent,enabled)
  on conflict(email) do update set name=excluded.name,role=excluded.role,creditor_id=excluded.creditor_id,discount_limit=excluded.discount_limit,active=excluded.active,expires_at=now()+interval '7 days' returning id into ident;
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

 if action='team' then return cobranca_private.team(payload);
 elsif action='profile' then

  return to_jsonb(p)||(select jsonb_build_object('tenant_name',name,'recovery_goal',recovery_goal) from public.cobranca_tenants where id=t);

 elsif action='lookups' then

  return jsonb_build_object('creditors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'financial_mode',metadata->>'financial_mode','default_interest',metadata->>'default_interest','default_fine',metadata->>'default_fine','grace_days',metadata->>'grace_days')) from public.cobranca_creditors where tenant_id=t and active and (p.role<>'creditor' or id=p.creditor_id)),'[]'),

   'debtors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'creditor_id',creditor_id)) from public.cobranca_debtors b where b.tenant_id=t and (p.role not in ('collector','creditor') or exists(select 1 from public.cobranca_debts d where d.debtor_id=b.id and cobranca_private.can_read_debt(p,d)))),'[]'),

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

    if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active) then raise exception 'Responsável inválido';end if;

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

  if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active) then raise exception 'Cobrador inválido';end if;

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

    'history',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('operator_name',p.name) order by l.created_at desc) from public.cobranca_interaction_logs l left join public.cobranca_profiles p on p.id::text=l.payload->>'actor' where l.debt_id=d.id),'[]'),

    'agreements',coalesce((select jsonb_agg(to_jsonb(a)) from public.cobranca_agreements a where debt_id=d.id),'[]'),

    'installments',coalesce((select jsonb_agg(to_jsonb(i) order by due_date,installment_number) from public.cobranca_agreement_installments i join public.cobranca_agreements a on a.id=i.agreement_id where a.debt_id=d.id),'[]'),

    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'created_at',created_at)) from public.cobranca_documents where debt_id=d.id),'[]'));

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

   if not exists(select 1 from public.cobranca_profiles where id=assigned and tenant_id=t and active) or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Responsável e motivo obrigatórios';end if;

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