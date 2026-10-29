begin;
set local lock_timeout='5s';
-- Additive records only. Official calculations and financial transactions remain unchanged.
create table cobranca_private.motor_calculations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 debt_id uuid not null references public.cobranca_debts(id),as_of date not null,engine_version text not null,
 fingerprint text not null,input jsonb not null,result jsonb not null,
 created_by uuid not null references public.cobranca_profiles(id),created_at timestamptz not null default now(),
 unique(tenant_id,debt_id,as_of,fingerprint)
);
create table cobranca_private.motor_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 debt_id uuid,creditor_id uuid,entity text not null,record_id uuid not null,operation text not null,
 actor uuid,occurred_at timestamptz not null default now(),before_value jsonb,after_value jsonb
);
create index motor_events_scope on cobranca_private.motor_events(tenant_id,creditor_id,occurred_at desc);
create index motor_calculations_scope on cobranca_private.motor_calculations(tenant_id,debt_id,created_at desc);
create table cobranca_private.motor_pending_rules(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 creditor_id uuid not null references public.cobranca_creditors(id),contract_ref text not null,
 version integer not null,requirements jsonb not null,status text not null default 'pending_review' check(status='pending_review'),
 reason text not null,created_by uuid not null references public.cobranca_profiles(id),created_at timestamptz not null default now(),
 unique(tenant_id,creditor_id,contract_ref,version)
);
do $$declare t text;begin foreach t in array array['motor_calculations','motor_events','motor_pending_rules'] loop
 execute format('alter table cobranca_private.%I enable row level security',t);
 execute format('revoke all on cobranca_private.%I from public,anon,authenticated',t);
 execute format('create policy deny_direct on cobranca_private.%I to anon,authenticated using(false) with check(false)',t);
end loop;end$$;
create function cobranca_private.motor_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Memória financeira imutável: registre um novo evento ou uma nova versão';end$$;
create trigger motor_calculations_immutable before update or delete on cobranca_private.motor_calculations for each row execute function cobranca_private.motor_immutable();
create trigger motor_events_immutable before update or delete on cobranca_private.motor_events for each row execute function cobranca_private.motor_immutable();
create trigger motor_pending_immutable before update or delete on cobranca_private.motor_pending_rules for each row execute function cobranca_private.motor_immutable();

-- Only financial fields; never capture credentials, contacts, arbitrary metadata or free text.
create function cobranca_private.motor_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare oldj jsonb;newj jsonb;oldv jsonb;newv jsonb;keys text[];entity text:=tg_table_name;tid uuid;rid uuid;did uuid;cid uuid;
begin
 oldj:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 newj:=case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 if entity='cobranca_creditors' then
  keys:=array['fee_percent'];
  oldv:=jsonb_build_object('terms',oldj->'metadata'->'financial_mode','interest',oldj->'metadata'->'default_interest','fine',oldj->'metadata'->'default_fine','grace',oldj->'metadata'->'grace_days','fee_basis',oldj->'metadata'->'fee_basis','fee_schedule_mode',oldj->'metadata'->'fee_schedule_mode','age_1',oldj->'metadata'->'fee_age_rate_1','age_2',oldj->'metadata'->'fee_age_rate_2','age_3',oldj->'metadata'->'fee_age_rate_3','age_4',oldj->'metadata'->'fee_age_rate_4','age_over',oldj->'metadata'->'fee_age_rate_over');
  newv:=jsonb_build_object('terms',newj->'metadata'->'financial_mode','interest',newj->'metadata'->'default_interest','fine',newj->'metadata'->'default_fine','grace',newj->'metadata'->'grace_days','fee_basis',newj->'metadata'->'fee_basis','fee_schedule_mode',newj->'metadata'->'fee_schedule_mode','age_1',newj->'metadata'->'fee_age_rate_1','age_2',newj->'metadata'->'fee_age_rate_2','age_3',newj->'metadata'->'fee_age_rate_3','age_4',newj->'metadata'->'fee_age_rate_4','age_over',newj->'metadata'->'fee_age_rate_over');
 elsif entity='cobranca_receipts' then keys:=array['debt_id','reference','amount','fee_amount','paid_date','reversed'];
 elsif entity='cobranca_agreements' then keys:=array['debt_id','status','total_amount','down_payment','installments','first_due_date'];
 elsif entity='cobranca_debts' then
  keys:=array['contract_ref','original_amount','current_amount','due_date','status'];
  oldv:=jsonb_build_object('financial_terms',oldj->'metadata'->'financial_terms','financial_frozen',oldj->'metadata'->'financial_frozen');
  newv:=jsonb_build_object('financial_terms',newj->'metadata'->'financial_terms','financial_frozen',newj->'metadata'->'financial_frozen');
 elsif entity='fee_contracts' then keys:=array['creditor_id','contract_ref','version','starts_on','ends_on','rates','minimums','model','volume_discount'];
 elsif entity='fee_closings' then keys:=array['contract_id','period','status','statement','approved_by','approved_at'];
 elsif entity='finance_settlements' then keys:=array['title_id','amount','paid_date','reversed'];
 else raise exception 'Origem de auditoria inválida';end if;
 select coalesce(jsonb_object_agg(k,oldj->k),'{}')||coalesce(oldv,'{}'),coalesce(jsonb_object_agg(k,newj->k),'{}')||coalesce(newv,'{}') into oldv,newv from unnest(keys) k;
 if tg_op='UPDATE' and oldv=newv then return new;end if;
 tid:=coalesce(newj->>'tenant_id',oldj->>'tenant_id')::uuid;rid:=coalesce(newj->>'id',oldj->>'id')::uuid;
 did:=case when entity='cobranca_debts' then rid else coalesce(newj->>'debt_id',oldj->>'debt_id')::uuid end;
 cid:=case when entity='cobranca_creditors' then rid else coalesce(newj->>'creditor_id',oldj->>'creditor_id')::uuid end;
 if did is not null then select creditor_id into cid from public.cobranca_debts where id=did and tenant_id=tid;end if;
 insert into cobranca_private.motor_events(tenant_id,debt_id,creditor_id,entity,record_id,operation,actor,before_value,after_value)
 values(tid,did,cid,entity,rid,tg_op,coalesce(auth.uid(),nullif(newj->>'actor','')::uuid),case when tg_op='INSERT' then null else oldv end,case when tg_op='DELETE' then null else newv end);
 return case when tg_op='DELETE' then old else new end;
end$$;
create trigger motor_creditor_audit after insert or update on public.cobranca_creditors for each row execute function cobranca_private.motor_audit();
create trigger motor_debt_audit after insert or update on public.cobranca_debts for each row execute function cobranca_private.motor_audit();
create trigger motor_receipt_audit after insert or update on public.cobranca_receipts for each row execute function cobranca_private.motor_audit();
create trigger motor_agreement_audit after insert or update on public.cobranca_agreements for each row execute function cobranca_private.motor_audit();
create trigger motor_contract_audit after insert or update on cobranca_private.fee_contracts for each row execute function cobranca_private.motor_audit();
create trigger motor_closing_audit after insert or update on cobranca_private.fee_closings for each row execute function cobranca_private.motor_audit();
create trigger motor_settlement_audit after insert or update on cobranca_private.finance_settlements for each row execute function cobranca_private.motor_audit();

create function cobranca_private.motor_quote(p public.cobranca_profiles,d public.cobranca_debts,calc_date date) returns jsonb language plpgsql set search_path='' as $$
#variable_conflict use_column
declare q jsonb;input jsonb;rid uuid;hash_value text;version text;payments jsonb;paid numeric;method jsonb;result jsonb;
begin
 if not cobranca_private.can_read_debt(p,d) then raise exception 'Título não autorizado';end if;
 -- Read the authoritative engine; no new charge, write to debt, or reprocessing of an agreement.
 q:=cobranca_private.financial_quote(d,calc_date);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'amount',r.amount,'paid_date',r.paid_date,'reversed',r.reversed,'calculation',r.calculation) order by r.paid_date,r.created_at,r.id),'[]'),coalesce(sum(r.amount) filter(where not r.reversed),0) into payments,paid from public.cobranca_receipts r where r.tenant_id=p.tenant_id and r.debt_id=d.id and r.paid_date<=calc_date;
 version:=md5(pg_get_functiondef('cobranca_private.financial_quote(public.cobranca_debts,date)'::regprocedure));
 input:=jsonb_build_object('original_amount',d.original_amount,'current_amount',d.current_amount,'due_date',d.due_date,'contract_ref',d.contract_ref,'status',d.status,'terms',q->'terms','receipts',payments,'engine_version',version,'engine_definition',pg_get_functiondef('cobranca_private.financial_quote(public.cobranca_debts,date)'::regprocedure),'as_of',calc_date);
 hash_value:=md5(input::text||q::text);
 method:=jsonb_build_object('interest',case q->'terms'->>'mode' when 'monthly' then 'Simples: saldo principal por período × taxa mensal / 100 × dias corridos / 30' when 'daily' then 'Simples: saldo principal por período × taxa diária / 100 × dias corridos' when 'none' then 'Sem juros' else 'Regra histórica; detalhes não disponíveis neste registro' end,'fine','Multa percentual única após carência; pagamentos obedecem à alocação do motor vigente','fees','Encargo do cadastro vigente, separado da comissão comercial da assessoria; validade jurídica não inferida','allocation','Juros, multa, encargos e principal, na ordem do motor vigente; cada recebimento encerra um período','rounding','PostgreSQL numeric; arredondamento monetário para centavos, preservando os momentos de arredondamento do motor vigente','timezone','America/Sao_Paulo');
 result:=jsonb_build_object('quote',q,'original_amount',d.original_amount,'received',paid,'receipts',payments,'rule_version',version,'fingerprint',hash_value,'method',method,'pending',jsonb_build_object('monetary_correction','Não ativada: requer índice e contrato validados','legal_interest','Não ativada: requer enquadramento e índice oficial','compound_interest','Não ativada: requer fundamento contratual e jurídico','future_interest','Não ativados: separados dos encargos históricos','legal_classification','Não inferida de CPF/CNPJ; cadastro vigente não substitui revisão jurídica'),'frozen',coalesce((q->>'frozen')::boolean,false),'creditor_name',(select name from public.cobranca_creditors where id=d.creditor_id and tenant_id=p.tenant_id),'debtor_name',(select name from public.cobranca_debtors where id=d.debtor_id and tenant_id=p.tenant_id),'reference',d.external_ref,'contract_ref',d.contract_ref);
 insert into cobranca_private.motor_calculations(tenant_id,debt_id,as_of,engine_version,fingerprint,input,result,created_by) values(p.tenant_id,d.id,calc_date,version,hash_value,input,result,p.id) on conflict(tenant_id,debt_id,as_of,fingerprint) do nothing;
 select id into rid from cobranca_private.motor_calculations where tenant_id=p.tenant_id and debt_id=d.id and motor_calculations.as_of=calc_date and motor_calculations.fingerprint=hash_value;
 return result||jsonb_build_object('calculation_id',rid);
end$$;

create function cobranca_private.financial_engine(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' set timezone='America/Sao_Paulo' as $$
#variable_conflict use_column
declare p public.cobranca_profiles;d public.cobranca_debts;c public.cobranca_creditors;item jsonb;q jsonb;rows jsonb:='[]';
 as_of date:=coalesce(nullif(payload->>'as_of','')::date,(now() at time zone 'America/Sao_Paulo')::date);today date:=(now() at time zone 'America/Sao_Paulo')::date;
 cid uuid:=nullif(payload->>'creditor_id','')::uuid;ref text:=nullif(trim(payload->>'contract_ref'),'');ident uuid;version int;requirements jsonb;
 n int:=0;principal numeric:=0;original numeric:=0;interest numeric:=0;fine numeric:=0;fees numeric:=0;total numeric:=0;paid numeric:=0;pending int:=0;frozen int:=0;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('master','admin','finance','supervisor','collector') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso ao motor financeiro não autorizado';end if;
 if not isfinite(as_of) or as_of<date '1900-01-01' or as_of>today then raise exception 'Data-base inválida: não utilizar projeção como saldo atual';end if;
 if cid is not null and not exists(select 1 from public.cobranca_creditors where tenant_id=p.tenant_id and id=cid) then raise exception 'Credor não autorizado';end if;
 if action='quote' then
  select * into d from public.cobranca_debts where id=(payload->>'id')::uuid and tenant_id=p.tenant_id;
  if not found or not cobranca_private.can_read_debt(p,d) then raise exception 'Título não autorizado';end if;
  -- Frozen records are shown as their actual present snapshot, never reconstructed for a prior date.
  if as_of<>today and (coalesce((d.metadata->>'financial_frozen')::boolean,false) or d.status='paid') then raise exception 'Consulte a memória gravada do acordo/recebimento para datas históricas';end if;
  return cobranca_private.motor_quote(p,d,as_of);
 elsif action='memory' then
  select debt_id into ident from cobranca_private.motor_calculations where id=(payload->>'id')::uuid and tenant_id=p.tenant_id;
  select * into d from public.cobranca_debts where id=ident and tenant_id=p.tenant_id;
  if not found or not cobranca_private.can_read_debt(p,d) then raise exception 'Memória não autorizada';end if;
  return (select result||jsonb_build_object('calculation_id',id,'recorded_at',created_at,'immutable',true) from cobranca_private.motor_calculations where id=(payload->>'id')::uuid and tenant_id=p.tenant_id);
 elsif action='pending_rule' then
  if p.role not in ('master','admin') then raise exception 'Administrador necessário';end if;
  if cid is null or ref is null or length(ref)>200 or length(trim(coalesce(payload->>'reason',''))) not between 3 and 2000 then raise exception 'Credor, contrato e justificativa obrigatórios';end if;
  requirements:=payload->'requirements';
  if jsonb_typeof(requirements) is distinct from 'object' or octet_length(requirements::text)>16000 or exists(select 1 from jsonb_object_keys(requirements) k where k not in ('interest_mode','correction_index','jurisdiction','legal_basis','agency_model','commission_bands','max_installments','minimum_entry','discount_limit','fee_legal_basis')) then raise exception 'Requisitos inválidos';end if;
  if requirements ? 'interest_mode' and requirements->>'interest_mode' not in ('existing','simple_daily','simple_monthly','simple_annual','compound','fixed','legal','none') then raise exception 'Modalidade inválida';end if;
  if requirements ? 'correction_index' and requirements->>'correction_index' not in ('pending','IPCA','INPC','IGPM','contractual','none') then raise exception 'Índice inválido';end if;
  if requirements ? 'jurisdiction' and requirements->>'jurisdiction' not in ('pending','cdc52','civil','specific') then raise exception 'Regime jurídico inválido';end if;
  if requirements ? 'commission_bands' then
   if jsonb_typeof(requirements->'commission_bands')<>'array' or jsonb_array_length(requirements->'commission_bands')>100 then raise exception 'Faixas inválidas';end if;
   for item in select value from jsonb_array_elements(requirements->'commission_bands') loop
    if jsonb_typeof(item) is distinct from 'object' or nullif(item->>'from_day','') is null or (item->>'from_day')::int<1 or ((item->>'to_day') is not null and (item->>'to_day')::int<(item->>'from_day')::int) or ((item->>'rate') is not null and ((item->>'rate')::numeric not between 0 and 100 or (item->>'rate')::numeric<>round((item->>'rate')::numeric,4))) then raise exception 'Faixa ou percentual inválido';end if;
   end loop;
  end if;
  perform 1 from public.cobranca_creditors where id=cid and tenant_id=p.tenant_id for update;
  select coalesce(max(m.version),0)+1 into version from cobranca_private.motor_pending_rules m where m.tenant_id=p.tenant_id and m.creditor_id=cid and m.contract_ref=ref;
  insert into cobranca_private.motor_pending_rules(tenant_id,creditor_id,contract_ref,version,requirements,reason,created_by) values(p.tenant_id,cid,ref,version,requirements,trim(payload->>'reason'),p.id) returning id into ident;
  return jsonb_build_object('id',ident,'version',version,'status','pending_review','activated',false);
 elsif action='list' then
  if p.role='collector' then raise exception 'Visão administrativa não autorizada';end if;
  return jsonb_build_object('pending_rules',coalesce((select jsonb_agg(to_jsonb(m) order by created_at desc) from cobranca_private.motor_pending_rules m where m.tenant_id=p.tenant_id and (cid is null or m.creditor_id=cid) and (ref is null or m.contract_ref=ref)),'[]'),'can_configure',p.role in ('admin','master'),'mode','existing_rules_only');
 elsif action='events' then
  if p.role not in ('master','admin','finance','supervisor') then raise exception 'Auditoria administrativa não autorizada';end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(e) order by occurred_at desc) from (select * from cobranca_private.motor_events m where tenant_id=p.tenant_id and (p.role in ('master','admin','finance') or m.entity<>'finance_settlements') and (cid is null or creditor_id=cid) and (nullif(payload->>'id','') is null or debt_id=(payload->>'id')::uuid) order by occurred_at desc,id desc limit 200) e),'[]'));
 elsif action='dashboard' then
  if p.role='collector' then raise exception 'Visão administrativa não autorizada';end if;
  if as_of<>today then raise exception 'Painel usa a data atual; memórias preservam consultas anteriores';end if;
  if (select count(*) from public.cobranca_debts x where x.tenant_id=p.tenant_id and (cid is null or x.creditor_id=cid) and (ref is null or x.contract_ref=ref))>5000 then raise exception 'Refine por credor e contrato: limite de 5000 títulos por consulta';end if;
  for d in select * from public.cobranca_debts x where x.tenant_id=p.tenant_id and (cid is null or x.creditor_id=cid) and (ref is null or x.contract_ref=ref) order by id loop
   original:=original+d.original_amount;n:=n+1;
   if d.status in ('paid','cancelled','canceled','uncollectible') then
    rows:=rows||jsonb_build_array(jsonb_build_object('id',d.id,'reference',d.external_ref,'status',d.status,'original_amount',d.original_amount,'total',d.current_amount,'excluded_from_open',true));continue;
   end if;
   begin
    q:=cobranca_private.motor_quote(p,d,as_of);item:=q->'quote';
    if not coalesce((item->>'configured')::boolean,false) then pending:=pending+1;rows:=rows||jsonb_build_array(jsonb_build_object('id',d.id,'reference',d.external_ref,'status','pending_review','configured',false,'error','Regra incompleta; valor excluído dos totais'));continue;end if;
    principal:=principal+coalesce((item->>'principal')::numeric,0);interest:=interest+coalesce((item->>'interest')::numeric,0);fine:=fine+coalesce((item->>'fine')::numeric,0);fees:=fees+coalesce((item->>'fees')::numeric,0);total:=total+(item->>'total')::numeric;
    if coalesce((item->>'frozen')::boolean,false) then frozen:=frozen+1;end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('id',d.id,'reference',d.external_ref,'contract_ref',d.contract_ref,'status',d.status,'original_amount',d.original_amount,'principal',item->'principal','interest',item->'interest','fine',item->'fine','fees',item->'fees','total',item->'total','configured',item->'configured','frozen',coalesce((item->>'frozen')::boolean,false),'calculation_id',q->'calculation_id'));
   exception when invalid_text_representation or raise_exception or numeric_value_out_of_range then
    pending:=pending+1;rows:=rows||jsonb_build_array(jsonb_build_object('id',d.id,'reference',d.external_ref,'status','pending_review','error','Regra financeira exige revisão; valor não incluído nos totais'));
   end;
  end loop;
  select coalesce(sum(r.amount),0) into paid from public.cobranca_receipts r join public.cobranca_debts x on x.id=r.debt_id and x.tenant_id=r.tenant_id where r.tenant_id=p.tenant_id and not r.reversed and r.paid_date<=as_of and (cid is null or x.creditor_id=cid) and (ref is null or x.contract_ref=ref);
  return jsonb_build_object('as_of',as_of,'mode','existing_rules_only','rows',rows,'totals',jsonb_build_object('original',original,'principal',principal,'interest',interest,'fine',fine,'fees',fees,'updated',total,'received',paid,'titles',n,'pending',pending,'frozen',frozen),
   'agency',jsonb_build_object('calculated',coalesce((select sum(e.fee) from cobranca_private.fee_entries e join cobranca_private.fee_contracts fc on fc.id=e.contract_id and fc.tenant_id=e.tenant_id where e.tenant_id=p.tenant_id and (cid is null or fc.creditor_id=cid) and (ref is null or fc.contract_ref=ref)),0),'approved',coalesce((select sum((fc.statement->>'fees')::numeric) from cobranca_private.fee_closings fc join cobranca_private.fee_contracts c on c.id=fc.contract_id and c.tenant_id=fc.tenant_id where fc.tenant_id=p.tenant_id and fc.status='closed' and (cid is null or c.creditor_id=cid) and (ref is null or c.contract_ref=ref)),0),'invoiced',coalesce((select sum(t.amount) from cobranca_private.fee_billing b join cobranca_private.fee_closings cl on cl.id=b.closing_id join cobranca_private.fee_contracts fc on fc.id=cl.contract_id join cobranca_private.finance_titles t on t.id=b.title_id and t.tenant_id=b.tenant_id where b.tenant_id=p.tenant_id and not t.canceled and (cid is null or fc.creditor_id=cid) and (ref is null or fc.contract_ref=ref)),0),
   'invoice_received',coalesce((select sum(fs.amount) from cobranca_private.fee_billing b join cobranca_private.fee_closings cl on cl.id=b.closing_id join cobranca_private.fee_contracts fc on fc.id=cl.contract_id join cobranca_private.finance_titles t on t.id=b.title_id and t.tenant_id=b.tenant_id join cobranca_private.finance_settlements fs on fs.title_id=t.id and fs.tenant_id=t.tenant_id where b.tenant_id=p.tenant_id and not t.canceled and not fs.reversed and fs.paid_date<=as_of and (cid is null or fc.creditor_id=cid) and (ref is null or fc.contract_ref=ref)),0),
   'expected_remittance',coalesce((select sum(e.amount-e.fee) from cobranca_private.fee_entries e join cobranca_private.fee_contracts fc on fc.id=e.contract_id and fc.tenant_id=e.tenant_id where e.tenant_id=p.tenant_id and e.recipient='agency' and (cid is null or fc.creditor_id=cid) and (ref is null or fc.contract_ref=ref)),0),
   'billing_records',coalesce((select count(*) from cobranca_private.fee_billing b join cobranca_private.fee_closings cl on cl.id=b.closing_id join cobranca_private.fee_contracts fc on fc.id=cl.contract_id where b.tenant_id=p.tenant_id and (cid is null or fc.creditor_id=cid) and (ref is null or fc.contract_ref=ref)),0),'note','Comissões comerciais em registros próprios. Faturamento, recebimento de faturas e repasses devem ser conferidos no fechamento e na conciliação existentes. Não há transferência automática.'));
 else raise exception 'Operação financeira inválida';end if;
end$$;
revoke all on function cobranca_private.motor_immutable(),cobranca_private.motor_audit(),cobranca_private.motor_quote(public.cobranca_profiles,public.cobranca_debts,date),cobranca_private.financial_engine(text,jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.financial_engine(text,jsonb) to authenticated;
create function public.cobranca_financial_engine(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' set timezone='America/Sao_Paulo' as $$select cobranca_private.financial_engine(action,payload)$$;
revoke all on function public.cobranca_financial_engine(text,jsonb) from public,anon;
grant execute on function public.cobranca_financial_engine(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
