-- MIGRATION 022: cadastro da empresa usuária e configuração bancária isolada por tenant.
-- Sem alteração de cobranças, recebimentos, credenciais existentes ou contratos.
begin;
create table cobranca_private.tenant_company_profiles (
 tenant_id uuid primary key references public.cobranca_tenants(id),
 legal_name text not null,trade_name text not null default '',cnpj text,
 state_registration text not null default '',email text not null default '',
 phone text not null default '',contact_name text not null default '',
 zip_code text not null default '',street text not null default '',
 street_number text not null default '',district text not null default '',
 city text not null default '',state text not null default '',
 updated_by uuid not null references public.cobranca_profiles(id),
 updated_at timestamptz not null default now(),
 check(length(legal_name) between 2 and 250),
 check(cnpj is null or cnpj ~ '^[0-9]{14}$')
);
create table cobranca_private.bank_integrations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.cobranca_tenants(id),
 finance_account_id uuid not null references cobranca_private.finance_accounts(id),
 bank_code text not null check(bank_code ~ '^[0-9]{3}$'),
 bank_name text not null check(length(bank_name) between 2 and 150),
 provider text not null check(provider in ('manual','inter','bradesco','itau','bb','sicoob','sicredi','santander','caixa','outro')),
 environment text not null default 'homologation' check(environment in ('homologation','production')),
 agency text not null default '',account_number text not null default '',
 beneficiary_document text not null default '',agreement text not null default '',
 wallet text not null default '',pix_key text not null default '',
 credential_cipher text,credential_updated_at timestamptz,
 enabled boolean not null default false,
 connection_status text not null default 'pending_homologation'
  check(connection_status in ('pending_homologation','configured','approved','disabled')),
 provider_instructions text not null default '',
 updated_by uuid not null references public.cobranca_profiles(id),
 updated_at timestamptz not null default now(),
 unique(tenant_id,finance_account_id)
);
create index bank_integrations_scope on cobranca_private.bank_integrations(tenant_id,enabled,provider);
do $$
declare tab text;
begin
 foreach tab in array array['tenant_company_profiles','bank_integrations'] loop
  execute format('alter table cobranca_private.%I enable row level security',tab);
  execute format('revoke all on cobranca_private.%I from public,anon,authenticated',tab);
  execute format('create policy explicit_deny on cobranca_private.%I to anon,authenticated using(false) with check(false)',tab);
 end loop;
end$$;

create or replace function cobranca_private.company_bank(action text,payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare p public.cobranca_profiles;info cobranca_private.tenant_company_profiles;
 bankrow cobranca_private.bank_integrations; account_row cobranca_private.finance_accounts;
 target uuid; doc text;company_name text;bank_code text;bank_name text;provider_name text;
 wallet_value text; environment_value text; beneficiary text; result jsonb;
begin
 select * into p from public.cobranca_profiles
 where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','finance') or
 not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active)
 then raise exception 'Configuração bancária não autorizada';end if;

 if action='company_get' then
  select * into info from cobranca_private.tenant_company_profiles where tenant_id=p.tenant_id;
  return jsonb_build_object('name',(select name from public.cobranca_tenants where id=p.tenant_id),
   'legal_name',coalesce(info.legal_name,(select name from public.cobranca_tenants where id=p.tenant_id)),
   'trade_name',coalesce(info.trade_name,''),
   'cnpj',coalesce(info.cnpj,(select document from public.cobranca_tenants where id=p.tenant_id),''),
   'state_registration',coalesce(info.state_registration,''),'email',coalesce(info.email,''),
   'phone',coalesce(info.phone,''),'contact_name',coalesce(info.contact_name,''),
   'zip_code',coalesce(info.zip_code,''),'street',coalesce(info.street,''),
   'street_number',coalesce(info.street_number,''),'district',coalesce(info.district,''),
   'city',coalesce(info.city,''),'state',coalesce(info.state,''));
 elsif action='company_save' then
  if p.role not in ('admin','master') then raise exception 'Somente o administrador pode alterar a empresa';end if;
  company_name:=trim(coalesce(payload->>'legal_name',''));
  doc:=regexp_replace(coalesce(payload->>'cnpj',''),'[^0-9]','','g');
  if length(company_name) not between 2 and 250 or length(doc)<>14
    or cobranca_private.fee_document(doc) is distinct from doc
  then raise exception 'Razão social e CNPJ válido são obrigatórios';end if;
  if length(coalesce(payload->>'email',''))>254 or (length(trim(coalesce(payload->>'email','')))>0 and trim(payload->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or length(coalesce(payload->>'phone',''))>30
    or length(coalesce(payload->>'trade_name',''))>250
    or length(coalesce(payload->>'state_registration',''))>50
    or length(coalesce(payload->>'contact_name',''))>150
    or length(coalesce(payload->>'zip_code',''))>20
    or length(coalesce(payload->>'street',''))>250
    or length(coalesce(payload->>'street_number',''))>25
    or length(coalesce(payload->>'district',''))>150
    or length(coalesce(payload->>'city',''))>150
    or length(coalesce(payload->>'state',''))>2
  then raise exception 'Campos do cadastro empresarial inválidos';end if;
  perform 1 from public.cobranca_tenants where id=p.tenant_id for update;
  insert into cobranca_private.tenant_company_profiles(tenant_id,legal_name,trade_name,cnpj,state_registration,email,phone,contact_name,zip_code,street,street_number,district,city,state,updated_by)
  values(p.tenant_id,company_name,trim(coalesce(payload->>'trade_name','')),doc,trim(coalesce(payload->>'state_registration','')),
   lower(trim(coalesce(payload->>'email',''))),trim(coalesce(payload->>'phone','')),trim(coalesce(payload->>'contact_name','')),
   trim(coalesce(payload->>'zip_code','')),trim(coalesce(payload->>'street','')),trim(coalesce(payload->>'street_number','')),
   trim(coalesce(payload->>'district','')),trim(coalesce(payload->>'city','')),upper(trim(coalesce(payload->>'state',''))),p.id)
  on conflict(tenant_id) do update set legal_name=excluded.legal_name,trade_name=excluded.trade_name,cnpj=excluded.cnpj,
   state_registration=excluded.state_registration,email=excluded.email,phone=excluded.phone,contact_name=excluded.contact_name,
   zip_code=excluded.zip_code,street=excluded.street,street_number=excluded.street_number,district=excluded.district,
   city=excluded.city,state=excluded.state,updated_by=excluded.updated_by,updated_at=now();
  update public.cobranca_tenants set name=company_name,document=doc,updated_at=now() where id=p.tenant_id;
  perform cobranca_private.audit(p.tenant_id,'company_updated','tenants',p.tenant_id,null,jsonb_build_object('cnpj_ending',right(doc,4)));
  return jsonb_build_object('saved',true);
 elsif action='bank_list' then
  return jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object(
   'id',a.id,'name',a.name,'bank',a.bank,'account_ref',a.account_ref)
   order by a.created_at) from cobranca_private.finance_accounts a where a.tenant_id=p.tenant_id),'[]'::jsonb),
   'integrations',coalesce((select jsonb_agg(jsonb_build_object(
    'id',b.id,'account_id',b.finance_account_id,'bank_code',b.bank_code,
    'bank_name',b.bank_name,'provider',b.provider,'environment',b.environment,
    'agency',b.agency,'account_number',b.account_number,'beneficiary_document',b.beneficiary_document,
    'agreement',b.agreement,'wallet',b.wallet,'pix_key',b.pix_key,
    'enabled',b.enabled,'connection_status',b.connection_status,
    'credential_configured',b.credential_cipher is not null,'updated_at',b.updated_at)
    order by b.updated_at desc) from cobranca_private.bank_integrations b where b.tenant_id=p.tenant_id),'[]'::jsonb));
 elsif action='bank_save' then
  if p.role not in ('admin','master') then raise exception 'Administrador necessário para banco';end if;
  target:=nullif(payload->>'account_id','')::uuid;
  select * into account_row from cobranca_private.finance_accounts where id=target and tenant_id=p.tenant_id for update;
  if not found then raise exception 'Cadastre primeiro a conta na Conciliação bancária';end if;
  bank_code:=trim(coalesce(payload->>'bank_code',''));
  bank_name:=trim(coalesce(payload->>'bank_name',''));
  provider_name:=trim(coalesce(payload->>'provider',''));
  environment_value:=trim(coalesce(payload->>'environment','homologation'));
  beneficiary:=regexp_replace(coalesce(payload->>'beneficiary_document',''),'[^0-9]','','g');
  wallet_value:=trim(coalesce(payload->>'wallet',''));
  if bank_code !~ '^[0-9]{3}$' or length(bank_name) not between 2 and 150
   or provider_name not in ('manual','inter','bradesco','itau','bb','sicoob','sicredi','santander','caixa','outro')
   or environment_value not in ('homologation','production')
   or length(beneficiary)<>14 or cobranca_private.fee_document(beneficiary) is distinct from beneficiary
   or length(trim(coalesce(payload->>'agency','')))>40
   or length(trim(coalesce(payload->>'account_number','')))>50
   or length(trim(coalesce(payload->>'agreement','')))>100
   or length(wallet_value)>50
   or length(trim(coalesce(payload->>'pix_key','')))>150
  then raise exception 'Dados bancários inválidos';end if;
  if exists(select 1 from cobranca_private.tenant_company_profiles where tenant_id=p.tenant_id and cnpj<>beneficiary) then
   raise exception 'O beneficiário deve ter o CNPJ cadastrado na empresa titular do sistema';end if;
  insert into cobranca_private.bank_integrations(tenant_id,finance_account_id,bank_code,bank_name,provider,
   environment,agency,account_number,beneficiary_document,agreement,wallet,pix_key,updated_by)
  values(p.tenant_id,target,bank_code,bank_name,provider_name,environment_value,
   trim(coalesce(payload->>'agency','')),trim(coalesce(payload->>'account_number','')),
   beneficiary,trim(coalesce(payload->>'agreement','')),wallet_value,trim(coalesce(payload->>'pix_key','')),p.id)
  on conflict(tenant_id,finance_account_id) do update set
   bank_code=excluded.bank_code,bank_name=excluded.bank_name,provider=excluded.provider,
   environment=excluded.environment,agency=excluded.agency,account_number=excluded.account_number,
   beneficiary_document=excluded.beneficiary_document,agreement=excluded.agreement,wallet=excluded.wallet,pix_key=excluded.pix_key,
   credential_cipher=case when
      (cobranca_private.bank_integrations.bank_code,cobranca_private.bank_integrations.provider,cobranca_private.bank_integrations.environment)
      is distinct from (excluded.bank_code,excluded.provider,excluded.environment)
      then null else cobranca_private.bank_integrations.credential_cipher end,
   enabled=false,connection_status='pending_homologation',updated_by=p.id,updated_at=now()
  returning * into bankrow;
  perform cobranca_private.audit(p.tenant_id,'bank_settings_updated','finance_accounts',target,null,
   jsonb_build_object('bank_code',bank_code,'provider',provider_name,'environment',environment_value,'bank_id',bankrow.id));
  return jsonb_build_object('id',bankrow.id,'status',bankrow.connection_status,'credential_configured',bankrow.credential_cipher is not null);
 elsif action='bank_secret_save' then
  if p.role not in ('admin','master') then raise exception 'Administrador necessário para credenciais';end if;
  target:=(payload->>'bank_id')::uuid;
  if length(coalesce(payload->>'cipher','')) not between 48 and 12000 then raise exception 'Credencial criptografada inválida';end if;
  update cobranca_private.bank_integrations set credential_cipher=payload->>'cipher',
   credential_updated_at=now(),connection_status='configured',enabled=false,updated_by=p.id,updated_at=now()
  where id=target and tenant_id=p.tenant_id returning * into bankrow;
  if not found then raise exception 'Configuração bancária não encontrada';end if;
  perform cobranca_private.audit(p.tenant_id,'bank_credentials_configured','finance_accounts',bankrow.finance_account_id,null,
   jsonb_build_object('bank_id',bankrow.id,'provider',bankrow.provider));
  return jsonb_build_object('configured',true,'status','configured');
 elsif action='bank_secret_get' then
  if p.role not in ('admin','master') then raise exception 'Administrador necessário';end if;
  target:=(payload->>'bank_id')::uuid;
  select * into bankrow from cobranca_private.bank_integrations where id=target and tenant_id=p.tenant_id;
  if not found then raise exception 'Banco não pertence a esta empresa';end if;
  return jsonb_build_object('cipher',bankrow.credential_cipher,'provider',bankrow.provider,
   'environment',bankrow.environment,'id',bankrow.id);
 elsif action='bank_issue' then
  raise exception 'Emissão bloqueada: escolha o banco, homologue a API e configure o convênio. Nenhum boleto fictício será gerado';
 end if;
 raise exception 'Operação bancária desconhecida';
end$$;
revoke all on function cobranca_private.company_bank(text,jsonb) from public,anon;
grant execute on function cobranca_private.company_bank(text,jsonb) to authenticated;
-- Preserva roteamento integral legado (financeiro, chat, ERP, precificação e importação).
create or replace function public.cobranca_app(action text,payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select case
  when action like 'company_%' or action like 'bank_%' then cobranca_private.company_bank(action,payload)
  when action in ('bordero_context','bordero_import') then cobranca_private.file_bordero(action,payload)
  when action like 'pricing_%' then cobranca_private.pricing(action,payload)
  when action='detail' then cobranca_private.fee_detail(payload)
  when action like 'chat_%' then cobranca_private.chat(action,payload)
  when action='report' then cobranca_private.reports(payload)
  when action='erp_config' then cobranca_private.erp_config(payload)
  when action like 'fin_%' then cobranca_private.finance(action,payload)
  else cobranca_private.api(action,payload)
 end
$$;
revoke all on function public.cobranca_app(text,jsonb) from public,anon;
grant execute on function public.cobranca_app(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;