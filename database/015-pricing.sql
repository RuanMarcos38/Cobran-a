-- Precificação integrada aos títulos e recebimentos existentes. Nenhum dado antigo é recalculado.
begin;
create table cobranca_private.fee_contracts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 creditor_id uuid not null references public.cobranca_creditors(id),contract_ref text not null,
 version integer not null,model text not null check(model in ('A','B')),starts_on date not null,ends_on date not null,
 rates numeric[] not null default array[10,15,20,25,30]::numeric[],volume_discount boolean not null,
 corporate_discount numeric not null default 4 check(corporate_discount between 0 and 22),
 minimums numeric[] not null default array[590,990,1990,4990,8990]::numeric[],
 terms jsonb not null default '{}',created_by uuid not null references public.cobranca_profiles(id),created_at timestamptz not null default now(),
 unique(tenant_id,creditor_id,contract_ref,version),check(ends_on>=starts_on),check(array_length(rates,1)=5),check(array_length(minimums,1)=5)
);
create table cobranca_private.fee_classifications (
 debt_id uuid primary key references public.cobranca_debts(id),tenant_id uuid not null references public.cobranca_tenants(id),
 contract_id uuid not null references cobranca_private.fee_contracts(id),reference_date date not null,original_due_date date not null,
 overdue_days integer not null,band integer not null check(band between 0 and 5),base_rate numeric not null,
 created_at timestamptz not null default now()
);
create table cobranca_private.fee_volumes (
 contract_id uuid not null references cobranca_private.fee_contracts(id),period date not null,
 debtors integer not null check(debtors>=0),discount numeric not null,minimum numeric(14,2) not null,
 policy text not null default 'first_financial_operation',created_at timestamptz not null default now(),primary key(contract_id,period)
);
create table cobranca_private.fee_entries (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 contract_id uuid not null references cobranca_private.fee_contracts(id),debt_id uuid not null references public.cobranca_debts(id),
 receipt_id uuid not null references public.cobranca_receipts(id),kind text not null check(kind in ('receipt','reversal')),
 period date not null,original_period date not null,amount numeric(14,2) not null,fee numeric(14,2) not null,rate numeric not null,
 recipient text not null check(recipient in ('creditor','agency')),created_at timestamptz not null default now(),unique(receipt_id,kind)
);
create table cobranca_private.fee_closings (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 contract_id uuid not null references cobranca_private.fee_contracts(id),period date not null,
 status text not null check(status in ('draft','closed')),statement jsonb not null,
 approved_by uuid references public.cobranca_profiles(id),approved_at timestamptz,created_at timestamptz not null default now(),unique(contract_id,period)
);
create table cobranca_private.fee_scenarios (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 creditor_id uuid not null references public.cobranca_creditors(id),name text not null,input jsonb not null,result jsonb not null,
 created_by uuid not null references public.cobranca_profiles(id),created_at timestamptz not null default now()
);
create table cobranca_private.fee_imports (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),contract_id uuid not null references cobranca_private.fee_contracts(id),
 batch_id text not null,digest text not null,result jsonb not null,created_by uuid not null references public.cobranca_profiles(id),created_at timestamptz not null default now(),unique(contract_id,batch_id)
);
create table cobranca_private.fee_billing (
 closing_id uuid primary key references cobranca_private.fee_closings(id),tenant_id uuid not null references public.cobranca_tenants(id),
 title_id uuid unique not null references cobranca_private.finance_titles(id),created_at timestamptz not null default now()
);
create index fee_entries_scope on cobranca_private.fee_entries(tenant_id,period,contract_id);
create index fee_classifications_contract on cobranca_private.fee_classifications(contract_id);
create index fee_contracts_lookup on cobranca_private.fee_contracts(tenant_id,creditor_id,contract_ref,version desc);
do $$declare tab text;begin foreach tab in array array['fee_contracts','fee_classifications','fee_volumes','fee_entries','fee_closings','fee_scenarios','fee_imports','fee_billing'] loop
 execute format('alter table cobranca_private.%I enable row level security',tab);
 execute format('revoke all on cobranca_private.%I from public,anon,authenticated',tab);
 execute format('create policy explicit_deny on cobranca_private.%I to anon,authenticated using(false) with check(false)',tab);
end loop;end$$;

create function cobranca_private.fee_band(days integer) returns integer language sql immutable set search_path='' as $$
 select case when days is null then null when days<=0 then 0 when days<=30 then 1 when days<=90 then 2 when days<=180 then 3 when days<=365 then 4 else 5 end
$$;
create function cobranca_private.fee_volume_band(n integer) returns integer language sql immutable set search_path='' as $$
 select case when n<100 then 1 when n<500 then 2 when n<2000 then 3 when n<5000 then 4 else 5 end
$$;
-- CPF/CNPJ validados; identidade sem documento válido gera pendência em vez de volume presumido.
create function cobranca_private.fee_document(doc text) returns text language plpgsql immutable set search_path='' as $$
declare s text:=upper(regexp_replace(coalesce(doc,''),'[./[:space:]-]','','g'));n int;i int;j int;total int;digit int;weights int[];
begin
 n:=length(s);if n not in (11,14) or s=repeat(substr(s,1,1),n) then return null;end if;
 if (n=11 and s !~ '^[0-9]{11}$') or (n=14 and s !~ '^[A-Z0-9]{12}[0-9]{2}$') then return null;end if;
 for j in 1..2 loop
  total:=0;
  if n=11 then
   for i in 1..(8+j) loop total:=total+substr(s,i,1)::int*(10+j-i);end loop;
   digit:=(total*10)%11;if digit=10 then digit:=0;end if;
  else
   weights:=case when j=1 then array[5,4,3,2,9,8,7,6,5,4,3,2] else array[6,5,4,3,2,9,8,7,6,5,4,3,2] end;
   for i in 1..(11+j) loop total:=total+(ascii(substr(s,i,1))-48)*weights[i];end loop;
   digit:=case when total%11<2 then 0 else 11-total%11 end;
  end if;
  if substr(s,n-2+j,1)::int<>digit then return null;end if;
 end loop;return s;
end$$;

create function cobranca_private.fee_enroll(d public.cobranca_debts,c cobranca_private.fee_contracts,ref_date date) returns void language plpgsql set search_path='' as $$
declare band int;
begin
 if d.tenant_id<>c.tenant_id or d.creditor_id<>c.creditor_id or coalesce(d.contract_ref,'')<>c.contract_ref then raise exception 'Título fora do contrato';end if;
 if ref_date is null or d.due_date is null or not isfinite(ref_date) or not isfinite(d.due_date) then raise exception 'Data pendente ou inválida';end if;
 band:=cobranca_private.fee_band(ref_date-d.due_date);
 insert into cobranca_private.fee_classifications(debt_id,tenant_id,contract_id,reference_date,original_due_date,overdue_days,band,base_rate)
 values(d.id,d.tenant_id,c.id,ref_date,d.due_date,ref_date-d.due_date,band,case when band=0 then 0 else c.rates[band] end) on conflict(debt_id) do nothing;
end$$;
create function cobranca_private.fee_debt_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare c cobranca_private.fee_contracts;entry date;
begin
 entry:=coalesce(nullif(new.metadata->>'entry_date','')::date,(new.created_at at time zone 'America/Sao_Paulo')::date);
 if not isfinite(entry) or entry>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data de entrada inválida';end if;
 select * into c from cobranca_private.fee_contracts where tenant_id=new.tenant_id and creditor_id=new.creditor_id and contract_ref=coalesce(new.contract_ref,'') and starts_on<=entry and ends_on>=entry order by version desc limit 1;
 if found then perform cobranca_private.fee_enroll(new,c,entry);end if;return new;
end$$;
create trigger cobranca_fee_debt after insert on public.cobranca_debts for each row execute function cobranca_private.fee_debt_trigger();

create function cobranca_private.fee_protect_debt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from cobranca_private.fee_classifications where debt_id=old.id) and
 (new.tenant_id,new.creditor_id,new.debtor_id,new.due_date,new.contract_ref) is distinct from (old.tenant_id,old.creditor_id,old.debtor_id,old.due_date,old.contract_ref) then
  raise exception 'Título classificado: preserve credor, devedor, contrato e vencimento originais';
 end if;return new;
end$$;
create trigger cobranca_fee_protect_debt before update of tenant_id,creditor_id,debtor_id,due_date,contract_ref on public.cobranca_debts for each row execute function cobranca_private.fee_protect_debt();

create function cobranca_private.fee_snapshot(c cobranca_private.fee_contracts,month date) returns cobranca_private.fee_volumes language plpgsql set search_path='' as $$
declare v cobranca_private.fee_volumes;n int;invalid int;band int;billing_version uuid;
begin
 if month<>date_trunc('month',month)::date then raise exception 'Competência inválida';end if;
 -- Serialize first snapshot, receipt, contract revision and close for this scope.
 perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||c.creditor_id::text||c.contract_ref,0));
 select * into v from cobranca_private.fee_volumes where contract_id=c.id and period=month;
 if found then return v;end if;
 select count(distinct cobranca_private.fee_document(b.document)),count(*) filter(where cobranca_private.fee_document(b.document) is null)
 into n,invalid from public.cobranca_debts d join public.cobranca_debtors b on b.id=d.debtor_id and b.tenant_id=d.tenant_id
 where d.tenant_id=c.tenant_id and d.creditor_id=c.creditor_id and coalesce(d.contract_ref,'')=c.contract_ref and d.status not in ('paid','uncollectible') and d.current_amount>0;
 if invalid>0 and (c.model='B' or c.volume_discount) then raise exception 'CPF/CNPJ pendente ou inválido em % títulos ativos: concilie antes do snapshot',invalid;end if;
 band:=cobranca_private.fee_volume_band(n);
 select id into billing_version from cobranca_private.fee_contracts where tenant_id=c.tenant_id and creditor_id=c.creditor_id and contract_ref=c.contract_ref and starts_on<(month+interval '1 month')::date and ends_on>=month order by version desc limit 1;
 insert into cobranca_private.fee_volumes(contract_id,period,debtors,discount,minimum,policy) values(c.id,month,n,
 case when not c.volume_discount then 0 when band=5 then c.corporate_discount else band-1 end,
 case when c.model='A' or billing_version is distinct from c.id or month>c.ends_on or (month+interval '1 month')::date<=c.starts_on then 0 else c.minimums[band] end,coalesce(c.terms->>'snapshot_policy','first_financial_operation')) returning * into v;
 return v;
end$$;

create function cobranca_private.fee_receipt_before() returns trigger language plpgsql security definer set search_path='' as $$
declare f cobranca_private.fee_classifications;c cobranca_private.fee_contracts;v cobranca_private.fee_volumes;month date;rate numeric;recipient text;
begin
 select * into f from cobranca_private.fee_classifications where debt_id=new.debt_id;
 if not found then return new;end if;
 select * into c from cobranca_private.fee_contracts where id=f.contract_id;
 if new.tenant_id<>f.tenant_id then raise exception 'Recebimento fora da empresa';end if;
 if new.paid_date<c.starts_on or new.paid_date>c.ends_on+coalesce((c.terms->>'post_end_days')::int,0) then raise exception 'Recebimento fora da vigência: revisão contratual necessária';end if;
 month:=date_trunc('month',new.paid_date)::date;
 if c.terms->>'snapshot_policy'='explicit_month_start' and not exists(select 1 from cobranca_private.fee_volumes where contract_id=c.id and period=month) then raise exception 'Volume pendente: financeiro deve congelar o snapshot da competência';end if;
 v:=cobranca_private.fee_snapshot(c,month);
 if exists(select 1 from cobranca_private.fee_closings fc join cobranca_private.fee_contracts cc on cc.id=fc.contract_id where cc.tenant_id=c.tenant_id and cc.creditor_id=c.creditor_id and cc.contract_ref=c.contract_ref and fc.period=month and fc.status='closed') then raise exception 'Competência fechada: registre ajuste em competência aberta';end if;
 rate:=case when f.band=0 then 0 else greatest(8,f.base_rate-v.discount) end;
 recipient:=coalesce(new.calculation->>'fee_recipient',c.terms->>'recipient','creditor');
 if recipient not in ('creditor','agency') then raise exception 'Destino do recebimento inválido';end if;
 new.fee_amount:=round(new.amount*rate/100,2);
 new.calculation:=coalesce(new.calculation,'{}')||jsonb_build_object('fee_contract_id',c.id,'fee_version',c.version,'fee_band',f.band,'fee_reference_date',f.reference_date,'fee_base_rate',f.base_rate,'fee_volume',v.debtors,'fee_discount',v.discount,'fee_rate',rate,'fee_recipient',recipient,'fee_period',month);
 return new;
end$$;
create trigger cobranca_fee_receipt_before before insert on public.cobranca_receipts for each row execute function cobranca_private.fee_receipt_before();

create function cobranca_private.fee_receipt_after() returns trigger language plpgsql security definer set search_path='' as $$
declare f cobranca_private.fee_classifications;c cobranca_private.fee_contracts;month date;original date;sign int:=1;entry_kind text:='receipt';
begin
 select * into f from cobranca_private.fee_classifications where debt_id=new.debt_id;
 if not found or not (new.calculation ? 'fee_contract_id') then return new;end if;
 select * into c from cobranca_private.fee_contracts where id=(new.calculation->>'fee_contract_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||c.creditor_id::text||c.contract_ref,0));
 month:=date_trunc('month',new.paid_date)::date;original:=month;
 if tg_op='UPDATE' then
  if not new.reversed or old.reversed then return new;end if;
  sign:=-1;entry_kind:='reversal';
  if exists(select 1 from cobranca_private.fee_closings fc join cobranca_private.fee_contracts cc on cc.id=fc.contract_id where cc.tenant_id=c.tenant_id and cc.creditor_id=c.creditor_id and cc.contract_ref=c.contract_ref and fc.period=month and fc.status='closed') then
   month:=greatest(month,date_trunc('month',now() at time zone 'America/Sao_Paulo')::date);
   while exists(select 1 from cobranca_private.fee_closings fc join cobranca_private.fee_contracts cc on cc.id=fc.contract_id where cc.tenant_id=c.tenant_id and cc.creditor_id=c.creditor_id and cc.contract_ref=c.contract_ref and fc.period=month and fc.status='closed') loop month:=(month+interval '1 month')::date;end loop;
  end if;
 end if;
 insert into cobranca_private.fee_entries(tenant_id,contract_id,debt_id,receipt_id,kind,period,original_period,amount,fee,rate,recipient)
 values(new.tenant_id,c.id,new.debt_id,new.id,entry_kind,month,original,sign*new.amount,sign*new.fee_amount,(new.calculation->>'fee_rate')::numeric,new.calculation->>'fee_recipient') on conflict(receipt_id,kind) do nothing;
 perform cobranca_private.audit(new.tenant_id,'fee_'||entry_kind,'receipts',new.id,null,jsonb_build_object('contract_id',c.id,'period',month,'original_period',original,'fee',sign*new.fee_amount));
 return new;
end$$;
create trigger cobranca_fee_receipt_after after insert or update of reversed on public.cobranca_receipts for each row execute function cobranca_private.fee_receipt_after();

create function cobranca_private.fee_statement(c cobranca_private.fee_contracts,month date) returns jsonb language plpgsql set search_path='' as $$
declare v cobranca_private.fee_volumes;fees numeric;logical_fees numeric;received numeric;direct numeric;retained numeric;topup numeric;rows jsonb;
begin
 v:=cobranca_private.fee_snapshot(c,month);
 select coalesce(sum(fee),0),coalesce(sum(amount),0),coalesce(sum(fee) filter(where recipient='creditor'),0),coalesce(sum(fee) filter(where recipient='agency'),0),coalesce(jsonb_agg(to_jsonb(e) order by created_at,id),'[]')
 into fees,received,direct,retained,rows from cobranca_private.fee_entries e where contract_id=c.id and period=month;
 -- A reversal credit must remain negative; do not erase it with an artificial top-up.
 select coalesce(sum(e.fee),0) into logical_fees from cobranca_private.fee_entries e join cobranca_private.fee_contracts fc on fc.id=e.contract_id where fc.tenant_id=c.tenant_id and fc.creditor_id=c.creditor_id and fc.contract_ref=c.contract_ref and e.period=month;
 topup:=greatest(0,v.minimum-greatest(0,logical_fees));
 return jsonb_build_object('contract_id',c.id,'version',c.version,'contract_ref',c.contract_ref,'period',month,'timezone','America/Sao_Paulo','model',c.model,'debtors',v.debtors,'discount',v.discount,'recovered',received,'fees',fees,'minimum',v.minimum,'management_topup',topup,'billing',fees+topup,'fees_to_invoice',direct,'retained_fees',retained,'creditor_economic_net',received-fees-topup,'agency_remittance',coalesce((select sum(amount-fee) from cobranca_private.fee_entries where contract_id=c.id and period=month and recipient='agency'),0),'rows',rows);
end$$;

create function cobranca_private.pricing(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare p public.cobranca_profiles;c cobranca_private.fee_contracts;f cobranca_private.fee_classifications;d public.cobranca_debts;r public.cobranca_receipts;payment_ref text;
 batch cobranca_private.fee_imports;digest text;debtor uuid;assigned uuid;entry_date date;due date;errors int:=0;line int:=0;
 v cobranca_private.fee_volumes;cl cobranca_private.fee_closings;ident uuid;creditor uuid;month date;today date:=(now() at time zone 'America/Sao_Paulo')::date;
 item jsonb;result jsonb;rows jsonb:='[]';rates numeric[];minimums numeric[];i int;n int;invalid int;rate numeric;amount numeric;fees numeric:=0;recovered numeric:=0;topup numeric;cost numeric;total numeric;recovery numeric;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('master','admin','finance','supervisor') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Precificação não autorizada';end if;
 if action in ('pricing_contract','pricing_enroll','pricing_import') and p.role not in ('master','admin') then raise exception 'Administrador necessário';end if;
 if action in ('pricing_snapshot','pricing_close','pricing_payment','pricing_bill') and p.role not in ('master','admin','finance') then raise exception 'Financeiro necessário';end if;
 month:=coalesce(nullif(payload->>'period','')::date,date_trunc('month',today)::date);
 if month<>date_trunc('month',month)::date or not isfinite(month) then raise exception 'Informe o primeiro dia da competência';end if;
 creditor:=nullif(payload->>'creditor_id','')::uuid;
 if creditor is not null and not exists(select 1 from public.cobranca_creditors where id=creditor and tenant_id=p.tenant_id) then raise exception 'Credor não encontrado';end if;

 if action='pricing_list' then
  return jsonb_build_object('contracts',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from (select c.*,cr.name creditor_name,(select count(*) from cobranca_private.fee_classifications where contract_id=c.id) titles from cobranca_private.fee_contracts c join public.cobranca_creditors cr on cr.id=c.creditor_id where c.tenant_id=p.tenant_id and (creditor is null or c.creditor_id=creditor)) x),'[]'),'closings',coalesce((select jsonb_agg(to_jsonb(x) order by period desc) from cobranca_private.fee_closings x where tenant_id=p.tenant_id),'[]'),'scenarios',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from (select * from cobranca_private.fee_scenarios where tenant_id=p.tenant_id order by created_at desc limit 100) x),'[]'),'can_configure',p.role in ('master','admin'),'can_close',p.role in ('master','admin','finance'));
 elsif action='pricing_contract' then
  if creditor is null or length(trim(coalesce(payload->>'contract_ref',''))) not between 1 and 200 or payload->>'model' not in ('A','B') or payload->>'model' is null or nullif(payload->>'starts_on','')::date is null then raise exception 'Credor, contrato, modelo e vigência obrigatórios';end if;
  if not isfinite((payload->>'starts_on')::date) or not isfinite(coalesce(nullif(payload->>'ends_on','')::date,(payload->>'starts_on')::date+89)) then raise exception 'Vigência inválida';end if;
  rates:=array(select (value #>> '{}')::numeric from jsonb_array_elements(coalesce(payload->'rates','[10,15,20,25,30]')));
  minimums:=array(select (value #>> '{}')::numeric from jsonb_array_elements(coalesce(payload->'minimums','[590,990,1990,4990,8990]')));
  if array_length(rates,1)<>5 or array_length(minimums,1)<>5 or array_length(rates,1) is null or array_length(minimums,1) is null then raise exception 'Informe cinco faixas';end if;
  for i in 1..5 loop if rates[i] is null or rates[i] not between 8 and 100 or rates[i]<>round(rates[i],2) or minimums[i] is null or minimums[i] not between 0 and 999999999.99 or minimums[i]<>round(minimums[i],2) then raise exception 'Tabela inválida';end if;end loop;
  if coalesce((payload->'terms'->>'post_end_days')::int,0) not between 0 and 3650 or coalesce(payload->'terms'->>'recipient','creditor') not in ('creditor','agency') then raise exception 'Condições inválidas';end if;
  if coalesce(payload->'terms'->>'snapshot_policy','first_financial_operation') not in ('first_financial_operation','explicit_month_start') then raise exception 'Política de snapshot inválida';end if;
  perform pg_advisory_xact_lock(hashtextextended(p.tenant_id::text||creditor::text||trim(payload->>'contract_ref'),0));
  if exists(select 1 from cobranca_private.fee_volumes v join cobranca_private.fee_contracts fc on fc.id=v.contract_id where fc.tenant_id=p.tenant_id and fc.creditor_id=creditor and fc.contract_ref=trim(payload->>'contract_ref') and (payload->>'starts_on')::date<(v.period+interval '1 month')::date) then raise exception 'Competência com snapshot: nova versão deve vigorar em mês posterior';end if;
  select coalesce(max(version),0)+1 into n from cobranca_private.fee_contracts where tenant_id=p.tenant_id and creditor_id=creditor and contract_ref=trim(payload->>'contract_ref');
  insert into cobranca_private.fee_contracts(tenant_id,creditor_id,contract_ref,version,model,starts_on,ends_on,rates,minimums,volume_discount,corporate_discount,terms,created_by)
  values(p.tenant_id,creditor,trim(payload->>'contract_ref'),n,payload->>'model',(payload->>'starts_on')::date,coalesce(nullif(payload->>'ends_on','')::date,(payload->>'starts_on')::date+89),rates,minimums,coalesce((payload->>'volume_discount')::boolean,payload->>'model'='B'),coalesce((payload->>'corporate_discount')::numeric,4),coalesce(payload->'terms','{}'),p.id) returning * into c;
  perform cobranca_private.audit(p.tenant_id,'fee_contract_version','fee_contracts',c.id,null,to_jsonb(c));return to_jsonb(c);
 elsif action='pricing_simulate' then
  if creditor is null then raise exception 'Credor obrigatório';end if;
  select * into c from cobranca_private.fee_contracts where id=nullif(payload->>'contract_id','')::uuid and tenant_id=p.tenant_id and creditor_id=creditor;
  if nullif(payload->>'contract_id','') is not null and not found then raise exception 'Tabela contratual não pertence ao credor';end if;
  if c.id is not null and c.model<>payload->>'model' then raise exception 'Modelo diferente do contrato selecionado';end if;
  rates:=coalesce(c.rates,array[10,15,20,25,30]::numeric[]);minimums:=coalesce(c.minimums,array[590,990,1990,4990,8990]::numeric[]);
  n:=(payload->>'debtors')::int;recovery:=(payload->>'recovery_percent')::numeric;cost:=coalesce((payload->>'cost')::numeric,0);
  if n is null or n<1 or recovery is null or recovery not between 0 and 100 or cost not between 0 and 999999999999.99 or cost<>round(cost,2) or coalesce(payload->>'model','') not in ('A','B') or jsonb_array_length(payload->'bands')<>5 then raise exception 'Simulação inválida';end if;
  v.discount:=case when coalesce(c.volume_discount,payload->>'model'='B') then case when n>=5000 then coalesce(c.corporate_discount,4) else cobranca_private.fee_volume_band(n)-1 end else 0 end;
  v.minimum:=case when payload->>'model'='A' then 0 else minimums[cobranca_private.fee_volume_band(n)] end;
  total:=0;
  for i in 1..5 loop
   amount:=(payload->'bands'->>(i-1))::numeric;
   if amount is null or amount not between 0 and 999999999999.99 or amount<>round(amount,2) then raise exception 'Valor da faixa inválido';end if;
   total:=total+amount;amount:=round(amount*recovery/100,2);rate:=greatest(8,rates[i]-v.discount);
   recovered:=recovered+amount;fees:=fees+round(amount*rate/100,2);
   rows:=rows||jsonb_build_array(jsonb_build_object('band',i,'recovered',amount,'rate',rate,'fee',round(amount*rate/100,2)));
  end loop;
  if coalesce((payload->>'titles')::int,0)<n then raise exception 'Quantidade de títulos inferior à de devedores';end if;
  topup:=greatest(0,v.minimum-fees);
  result:=jsonb_build_object('projection',true,'portfolio',total,'recovered',recovered,'fees',fees,'weighted_rate',case when recovered=0 then 0 else round(fees/recovered*100,4) end,'discount',v.discount,'minimum',v.minimum,'management_topup',topup,'billing',fees+topup,'creditor_economic_net',recovered-fees-topup,'cost',cost,'contribution',fees+topup-cost,'rows',rows);
  if coalesce((payload->>'save')::boolean,false) then insert into cobranca_private.fee_scenarios(tenant_id,creditor_id,name,input,result,created_by) values(p.tenant_id,creditor,left(coalesce(nullif(payload->>'name',''),'Simulação'),200),payload-'save',result,p.id);end if;
  return result;
 elsif action='pricing_dashboard' then
  -- Financial facts: confirmed receipts and append-only fee postings. No fictitious KPI.
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
   select c.creditor_id,cr.name creditor_name,e.period,sum(e.amount) recovered,sum(e.fee) fees,
   sum(e.fee) filter(where e.recipient='creditor') fees_to_invoice,sum(e.fee) filter(where e.recipient='agency') retained_fees
   from cobranca_private.fee_entries e join cobranca_private.fee_contracts c on c.id=e.contract_id join public.cobranca_creditors cr on cr.id=c.creditor_id
   where e.tenant_id=p.tenant_id and e.period=month and (nullif(payload->>'assigned_to','') is null or exists(select 1 from public.cobranca_debts op where op.id=e.debt_id and op.assigned_to=(payload->>'assigned_to')::uuid)) and (creditor is null or c.creditor_id=creditor) and (nullif(payload->>'contract_id','') is null or c.id=(payload->>'contract_id')::uuid)
   group by c.creditor_id,cr.name,e.period) x;
  result:=jsonb_build_object('period',month,'rows',rows,'portfolio',coalesce((select sum(original_amount) from public.cobranca_debts where tenant_id=p.tenant_id and (nullif(payload->>'assigned_to','') is null or assigned_to=(payload->>'assigned_to')::uuid) and (nullif(payload->>'contract_id','') is null or exists(select 1 from cobranca_private.fee_classifications cf where cf.debt_id=cobranca_debts.id and cf.contract_id=(payload->>'contract_id')::uuid)) and (creditor is null or creditor_id=creditor)),0),'open_balance',coalesce((select sum(current_amount) from public.cobranca_debts where tenant_id=p.tenant_id and (nullif(payload->>'assigned_to','') is null or assigned_to=(payload->>'assigned_to')::uuid) and (nullif(payload->>'contract_id','') is null or exists(select 1 from cobranca_private.fee_classifications cf where cf.debt_id=cobranca_debts.id and cf.contract_id=(payload->>'contract_id')::uuid)) and (creditor is null or creditor_id=creditor)),0),'titles',(select count(*) from public.cobranca_debts where tenant_id=p.tenant_id and (nullif(payload->>'assigned_to','') is null or assigned_to=(payload->>'assigned_to')::uuid) and (nullif(payload->>'contract_id','') is null or exists(select 1 from cobranca_private.fee_classifications cf where cf.debt_id=cobranca_debts.id and cf.contract_id=(payload->>'contract_id')::uuid)) and (creditor is null or creditor_id=creditor)),'debtors',(select count(distinct cobranca_private.fee_document(b.document)) from public.cobranca_debts d join public.cobranca_debtors b on b.id=d.debtor_id where d.tenant_id=p.tenant_id and (nullif(payload->>'assigned_to','') is null or d.assigned_to=(payload->>'assigned_to')::uuid) and (nullif(payload->>'contract_id','') is null or exists(select 1 from cobranca_private.fee_classifications cf where cf.debt_id=d.id and cf.contract_id=(payload->>'contract_id')::uuid)) and (creditor is null or d.creditor_id=creditor)),'pending_classification',(select count(*) from public.cobranca_debts d where tenant_id=p.tenant_id and (nullif(payload->>'assigned_to','') is null or assigned_to=(payload->>'assigned_to')::uuid) and (nullif(payload->>'contract_id','') is null or exists(select 1 from cobranca_private.fee_classifications cf where cf.debt_id=d.id and cf.contract_id=(payload->>'contract_id')::uuid)) and (creditor is null or creditor_id=creditor) and not exists(select 1 from cobranca_private.fee_classifications where debt_id=d.id)), 'closings',coalesce((select jsonb_agg(to_jsonb(cl)) from cobranca_private.fee_closings cl join cobranca_private.fee_contracts c on c.id=cl.contract_id where cl.tenant_id=p.tenant_id and cl.period=month and (creditor is null or c.creditor_id=creditor) and (nullif(payload->>'contract_id','') is null or c.id=(payload->>'contract_id')::uuid)),'[]'));
  return result||jsonb_build_object(
   'bands',coalesce((select jsonb_agg(to_jsonb(x)) from (select f.band,sum(e.amount) recovered,sum(e.fee) fees from cobranca_private.fee_entries e join cobranca_private.fee_classifications f on f.debt_id=e.debt_id join cobranca_private.fee_contracts c on c.id=e.contract_id where e.tenant_id=p.tenant_id and e.period=month and (nullif(payload->>'assigned_to','') is null or exists(select 1 from public.cobranca_debts op where op.id=e.debt_id and op.assigned_to=(payload->>'assigned_to')::uuid)) and (creditor is null or c.creditor_id=creditor) and (nullif(payload->>'contract_id','') is null or c.id=(payload->>'contract_id')::uuid) group by f.band order by f.band) x),'[]'),
   'evolution',coalesce((select jsonb_agg(to_jsonb(x) order by period) from (select e.period,sum(e.amount) recovered,sum(e.fee) fees from cobranca_private.fee_entries e join cobranca_private.fee_contracts c on c.id=e.contract_id where e.tenant_id=p.tenant_id and e.period between (month-interval '11 months')::date and month and (nullif(payload->>'assigned_to','') is null or exists(select 1 from public.cobranca_debts op where op.id=e.debt_id and op.assigned_to=(payload->>'assigned_to')::uuid)) and (creditor is null or c.creditor_id=creditor) and (nullif(payload->>'contract_id','') is null or c.id=(payload->>'contract_id')::uuid) group by e.period) x),'[]'),
   'billing',coalesce((select sum(t.amount) from cobranca_private.fee_billing b join cobranca_private.finance_titles t on t.id=b.title_id join cobranca_private.fee_closings fc on fc.id=b.closing_id join cobranca_private.fee_contracts c on c.id=fc.contract_id where b.tenant_id=p.tenant_id and fc.period=month and not t.canceled and (creditor is null or c.creditor_id=creditor) and (nullif(payload->>'contract_id','') is null or c.id=(payload->>'contract_id')::uuid)),0),
   'agency_received',coalesce((select sum(fs.amount) from cobranca_private.fee_billing b join cobranca_private.finance_titles t on t.id=b.title_id join cobranca_private.finance_settlements fs on fs.title_id=t.id and not fs.reversed join cobranca_private.fee_closings fc on fc.id=b.closing_id join cobranca_private.fee_contracts c on c.id=fc.contract_id where b.tenant_id=p.tenant_id and fc.period=month and not t.canceled and (creditor is null or c.creditor_id=creditor) and (nullif(payload->>'contract_id','') is null or c.id=(payload->>'contract_id')::uuid)),0),
   'agency_fees_received',coalesce((select sum(round(fs.amount*greatest(0,(fc.statement->>'fees_to_invoice')::numeric)/t.amount,2)) from cobranca_private.fee_billing b join cobranca_private.finance_titles t on t.id=b.title_id join cobranca_private.finance_settlements fs on fs.title_id=t.id and not fs.reversed join cobranca_private.fee_closings fc on fc.id=b.closing_id join cobranca_private.fee_contracts c on c.id=fc.contract_id where b.tenant_id=p.tenant_id and fc.period=month and not t.canceled and (creditor is null or c.creditor_id=creditor) and (nullif(payload->>'contract_id','') is null or c.id=(payload->>'contract_id')::uuid)),0),
   'negotiated',coalesce((select sum(a.total_amount) from public.cobranca_agreements a join public.cobranca_debts d on d.id=a.debt_id where a.tenant_id=p.tenant_id and a.status in ('active','paid') and (creditor is null or d.creditor_id=creditor)),0)
  );

 end if;

 select * into c from cobranca_private.fee_contracts where id=nullif(payload->>'contract_id','')::uuid and tenant_id=p.tenant_id;
 if not found then raise exception 'Contrato não encontrado';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||c.creditor_id::text||c.contract_ref,0));
 if action='pricing_import' then
  if jsonb_typeof(payload->'items') is distinct from 'array' or coalesce(jsonb_array_length(payload->'items'),0) not between 1 and 500 or length(trim(coalesce(payload->>'batch_id',''))) not between 1 and 200 then raise exception 'Informe o lote e entre 1 e 500 títulos';end if;
  digest:=encode(sha256(convert_to((payload->'items')::text,'UTF8')),'hex');
  select * into batch from cobranca_private.fee_imports where contract_id=c.id and batch_id=payload->>'batch_id';
  if found then
   if batch.digest<>digest then raise exception 'Lote repetido com conteúdo divergente';end if;
   return batch.result||jsonb_build_object('duplicate',true);
  end if;
  for item in select value from jsonb_array_elements(payload->'items') loop
   line:=line+1;
   begin
    if exists(select 1 from jsonb_array_elements(rows) x where x->>'external_ref'=item->>'external_ref') then raise exception 'Referência repetida no mesmo lote';end if;
    amount:=nullif(item->>'original_amount','')::numeric;due:=nullif(item->>'due_date','')::date;entry_date:=coalesce(nullif(item->>'entry_date','')::date,today);
    if amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) or due is null or not isfinite(due) or not isfinite(entry_date) or entry_date>today or entry_date<c.starts_on or entry_date>c.ends_on or cobranca_private.fee_document(item->>'debtor_document') is null or length(trim(coalesce(item->>'debtor_name',''))) not between 1 and 250 or length(trim(coalesce(item->>'external_ref',''))) not between 1 and 200 then raise exception 'Identificação, CPF/CNPJ, valor, vencimento ou entrada inválidos';end if;
    select * into d from public.cobranca_debts where tenant_id=p.tenant_id and creditor_id=c.creditor_id and external_ref=item->>'external_ref';
    if found and (d.original_amount<>amount or d.due_date<>due or coalesce(d.contract_ref,'')<>c.contract_ref or not exists(select 1 from public.cobranca_debtors where id=d.debtor_id and cobranca_private.fee_document(document)=cobranca_private.fee_document(item->>'debtor_document'))) then raise exception 'Título já cadastrado com dados divergentes';end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('line',line,'external_ref',item->>'external_ref','due_date',due,'reference_date',entry_date,'band',cobranca_private.fee_band(entry_date-due),'duplicate',d.id is not null,'status','valid'));
   exception when others then
    errors:=errors+1;rows:=rows||jsonb_build_array(jsonb_build_object('line',line,'external_ref',item->>'external_ref','status','pending','error',sqlerrm));
   end;
  end loop;
  result:=jsonb_build_object('rows',rows,'count',line,'errors',errors,'duplicate',false,'preview',true);
  if payload->>'operation' is distinct from 'confirm' then return result;end if;
  if errors>0 then raise exception 'Importação com % pendências: corrija a prévia',errors;end if;
  select id into assigned from public.cobranca_profiles where tenant_id=p.tenant_id and active and role='collector' order by id limit 1;
  if assigned is null then raise exception 'Cadastre um negociador antes de importar';end if;
  for item in select value from jsonb_array_elements(payload->'items') loop
   if exists(select 1 from public.cobranca_debts where tenant_id=p.tenant_id and creditor_id=c.creditor_id and external_ref=item->>'external_ref') then continue;end if;
   select id into debtor from public.cobranca_debtors where tenant_id=p.tenant_id and creditor_id=c.creditor_id and cobranca_private.fee_document(document)=cobranca_private.fee_document(item->>'debtor_document') limit 1;
   if debtor is null then
    result:=cobranca_private.api('save',jsonb_build_object('entity','debtors','creditor_id',c.creditor_id,'name',item->>'debtor_name','document',cobranca_private.fee_document(item->>'debtor_document')));debtor:=(result->>'id')::uuid;
   end if;
   perform cobranca_private.api('new_process',jsonb_build_object('creditor_id',c.creditor_id,'debtor_id',debtor,'assigned_to',assigned,'external_ref',item->>'external_ref','original_amount',item->>'original_amount','due_date',item->>'due_date','entry_date',coalesce(nullif(item->>'entry_date',''),today::text),'contract_ref',c.contract_ref,'financial_mode','none','interest_percent',0,'fine_percent',0,'grace_days',0));
  end loop;
  result:=jsonb_build_object('rows',rows,'count',line,'errors',0,'duplicate',false,'preview',false);
  insert into cobranca_private.fee_imports(tenant_id,contract_id,batch_id,digest,result,created_by) values(p.tenant_id,c.id,payload->>'batch_id',digest,result,p.id);
  perform cobranca_private.audit(p.tenant_id,'fee_import','fee_contracts',c.id,null,jsonb_build_object('batch_id',payload->>'batch_id','count',line));return result;
 elsif action='pricing_enroll' then
  if payload->>'operation'='confirm' then
   if length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Motivo obrigatório';end if;
   for d in select * from public.cobranca_debts where tenant_id=p.tenant_id and creditor_id=c.creditor_id and coalesce(contract_ref,'')=c.contract_ref and not exists(select 1 from public.cobranca_receipts where debt_id=cobranca_debts.id) and not exists(select 1 from cobranca_private.fee_classifications where debt_id=cobranca_debts.id) loop
    perform cobranca_private.fee_enroll(d,c,(d.created_at at time zone 'America/Sao_Paulo')::date);
   end loop;
   perform cobranca_private.audit(p.tenant_id,'fee_enroll','fee_contracts',c.id,null,jsonb_build_object('reason',payload->>'reason'));
  end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'external_ref',d.external_ref,'due_date',d.due_date,'reference_date',(d.created_at at time zone 'America/Sao_Paulo')::date,'band',cobranca_private.fee_band((d.created_at at time zone 'America/Sao_Paulo')::date-d.due_date),'already_classified',exists(select 1 from cobranca_private.fee_classifications where debt_id=d.id),'historical_payments',exists(select 1 from public.cobranca_receipts where debt_id=d.id))) from public.cobranca_debts d where d.tenant_id=p.tenant_id and d.creditor_id=c.creditor_id and coalesce(d.contract_ref,'')=c.contract_ref),'[]'));
 elsif action='pricing_bill' then
  select * into cl from cobranca_private.fee_closings where contract_id=c.id and period=month and status='closed';
  if not found then raise exception 'Aprove o fechamento antes de faturar';end if;
  select title_id into ident from cobranca_private.fee_billing where closing_id=cl.id;
  if found then return jsonb_build_object('duplicate',true,'title_id',ident);end if;
  if length(trim(coalesce(payload->>'reason','')))=0 or nullif(payload->>'due_date','')::date is null or ((cl.statement->>'fees_to_invoice')::numeric+(cl.statement->>'management_topup')::numeric)<=0 then raise exception 'Motivo, vencimento e faturamento positivo obrigatórios';end if;
  result:=cobranca_private.finance('fin_save',jsonb_build_object('kind','invoice','reference','HON:'||cl.id::text,'creditor_id',c.creditor_id,'party',(select name from public.cobranca_creditors where id=c.creditor_id),'description','Honorários e complemento — '||c.contract_ref||' — '||month::text||' — '||(payload->>'reason'),'amount',((cl.statement->>'fees_to_invoice')::numeric+(cl.statement->>'management_topup')::numeric),'due_date',payload->>'due_date'));
  insert into cobranca_private.fee_billing(closing_id,tenant_id,title_id) values(cl.id,p.tenant_id,(result->>'id')::uuid);
  perform cobranca_private.audit(p.tenant_id,'fee_bill','fee_closings',cl.id,null,jsonb_build_object('title_id',result->>'id','reason',payload->>'reason'));
  return jsonb_build_object('duplicate',false,'title_id',result->>'id');
 elsif action='pricing_snapshot' then
  v:=cobranca_private.fee_snapshot(c,month);return to_jsonb(v);
 elsif action in ('pricing_statement','pricing_close') then
  select * into cl from cobranca_private.fee_closings where contract_id=c.id and period=month;
  if found and cl.status='closed' then return cl.statement||jsonb_build_object('status','closed','id',cl.id);end if;
  if action='pricing_statement' then
   -- Reading a statement must not create a volume snapshot. Snapshot explicitly first.
   if not exists(select 1 from cobranca_private.fee_volumes where contract_id=c.id and period=month) then raise exception 'Congele o volume desta competência antes de apurar';end if;
  end if;
  if action='pricing_close' and month>=date_trunc('month',today)::date and payload->>'operation'='approve' then raise exception 'A competência ainda não terminou';end if;
  result:=cobranca_private.fee_statement(c,month);
  if action='pricing_close' then
   if payload->>'operation'='approve' and length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Motivo da aprovação obrigatório';end if;
   insert into cobranca_private.fee_closings(tenant_id,contract_id,period,status,statement,approved_by,approved_at)
   values(p.tenant_id,c.id,month,case when payload->>'operation'='approve' then 'closed' else 'draft' end,result,case when payload->>'operation'='approve' then p.id end,case when payload->>'operation'='approve' then now() end)
   on conflict(contract_id,period) do update set statement=excluded.statement,status=excluded.status,approved_by=excluded.approved_by,approved_at=excluded.approved_at returning * into cl;
   perform cobranca_private.audit(p.tenant_id,'fee_close_'||cl.status,'fee_closings',cl.id,null,jsonb_build_object('period',month,'reason',payload->>'reason','billing',result->'billing'));
   return result||jsonb_build_object('status',cl.status,'id',cl.id);
  end if;return result;
 elsif action='pricing_payment' then
  select * into d from public.cobranca_debts where id=(payload->>'id')::uuid and tenant_id=p.tenant_id;
  if not found or not exists(select 1 from cobranca_private.fee_classifications where debt_id=d.id and contract_id=c.id) then raise exception 'Título não vinculado ao contrato';end if;
  if coalesce(payload->>'confirmed','')<>'true' or coalesce(payload->>'reconciled','')<>'true' then raise exception 'Confirme o recebimento e sua conciliação';end if;
  if length(trim(coalesce(payload->>'transaction_id',''))) not between 1 and 200 or length(trim(coalesce(payload->>'origin',''))) not between 1 and 100 then raise exception 'Identificador da transação e origem obrigatórios';end if;
  payment_ref:='TX:'||encode(sha256(convert_to((jsonb_build_array(lower(trim(payload->>'origin')),trim(payload->>'transaction_id'),d.id))::text,'UTF8')),'hex');
  select * into r from public.cobranca_receipts where tenant_id=p.tenant_id and reference=payment_ref;
  if found then
   if r.debt_id<>d.id or r.amount<>(payload->>'amount')::numeric or r.paid_date<>(payload->>'paid_date')::date then raise exception 'Transação duplicada com dados divergentes';end if;
   return jsonb_build_object('duplicate',true,'receipt_id',r.id,'reversed',r.reversed);
  end if;
  -- Existing payment service performs balances and installment allocation; trigger supplies fees.
  result:=cobranca_private.api('payment',payload||jsonb_build_object('reference',payment_ref));
  return jsonb_build_object('duplicate',false,'result',result);
 end if;
 raise exception 'Operação de precificação inválida';
end$$;

-- Internal helpers cannot be called directly by browser/API roles.
revoke all on function cobranca_private.fee_band(integer),cobranca_private.fee_volume_band(integer),cobranca_private.fee_document(text),cobranca_private.fee_enroll(public.cobranca_debts,cobranca_private.fee_contracts,date),cobranca_private.fee_snapshot(cobranca_private.fee_contracts,date),cobranca_private.fee_statement(cobranca_private.fee_contracts,date),cobranca_private.fee_debt_trigger(),cobranca_private.fee_receipt_before(),cobranca_private.fee_receipt_after() from public,anon,authenticated;
revoke all on function cobranca_private.fee_protect_debt() from public,anon,authenticated;
revoke all on function cobranca_private.pricing(text,jsonb) from public,anon;
grant execute on function cobranca_private.pricing(text,jsonb) to authenticated;
create function cobranca_private.fee_detail(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;contract_id uuid;
begin
 result:=cobranca_private.api('detail',payload);
 if exists(select 1 from public.cobranca_profiles where id=auth.uid() and active and role in ('admin','master','finance')) then
  select f.contract_id into contract_id from cobranca_private.fee_classifications f where f.debt_id=(payload->>'id')::uuid;
  if found then result:=result||jsonb_build_object('fee_contract_id',contract_id);end if;
 end if;return result;
end$$;
revoke all on function cobranca_private.fee_detail(jsonb) from public,anon;
grant execute on function cobranca_private.fee_detail(jsonb) to authenticated;
create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$
 select case when action like 'pricing_%' then cobranca_private.pricing(action,payload) when action='detail' then cobranca_private.fee_detail(payload) when action like 'chat_%' then cobranca_private.chat(action,payload) when action='report' then cobranca_private.reports(payload) when action='erp_config' then cobranca_private.erp_config(payload) when action like 'fin_%' then cobranca_private.finance(action,payload) else cobranca_private.api(action,payload) end
$$;
commit;
