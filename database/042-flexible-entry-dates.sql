begin;
set local lock_timeout='5s';
create or replace function cobranca_private.payment_dates(payload jsonb) returns date[] language plpgsql set search_path='' as $$
declare frequency text:=coalesce(payload->>'payment_frequency','monthly');n int:=(payload->>'installments')::int;first_due date:=(payload->>'first_due_date')::date;step_count int;unit text;days int;months int;dates date[]:='{}';d date;raw text;i int;
begin
 if n is null or n not between 1 and 120 or first_due is null or first_due<current_date or extract(year from first_due) not between 1900 and 9999 then raise exception 'Cronograma inválido';end if;
 if frequency not in ('cash','daily','weekly','fortnightly','every20days','monthly','bimonthly','quarterly','semiannual','annual','custom','free') then raise exception 'Periodicidade inválida';end if;
 if frequency='cash' and (n<>1 or coalesce((payload->>'down_payment')::numeric,0)<>0) then raise exception 'À vista exige uma parcela e entrada zero';end if;
 if coalesce((payload->>'down_payment')::numeric,0)>0 and payload ? 'down_payment_due_date' then
  if nullif(payload->>'down_payment_due_date','') is null or (payload->>'down_payment_due_date')::date<current_date or extract(year from (payload->>'down_payment_due_date')::date) not between 1900 and 9999 or first_due<=(payload->>'down_payment_due_date')::date then raise exception 'A primeira parcela deve vencer depois da entrada';end if;
 end if;
 if frequency='custom' then
  if coalesce(payload->>'interval_count','') !~ '^[0-9]+$' then raise exception 'Intervalo inteiro obrigatório';end if;
  step_count:=(payload->>'interval_count')::int;unit:=payload->>'interval_unit';
  if step_count is null or step_count not between 1 and 3660 or unit is null or unit not in ('days','weeks','months') then raise exception 'Intervalo personalizado inválido';end if;
  days:=case unit when 'days' then step_count when 'weeks' then step_count*7 else null end;months:=case when unit='months' then step_count else null end;
 else days:=case frequency when 'daily' then 1 when 'weekly' then 7 when 'fortnightly' then 15 when 'every20days' then 20 else null end;months:=case frequency when 'bimonthly' then 2 when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12 else 1 end;end if;
 if payload ? 'due_dates' and payload->'due_dates'<>'null'::jsonb then
  if jsonb_typeof(payload->'due_dates')<>'array' or jsonb_array_length(payload->'due_dates')<>n then raise exception 'Confira todos os vencimentos';end if;
  for raw in select jsonb_array_elements_text(payload->'due_dates') loop
   if raw is null or raw !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data inválida';end if;d:=raw::date;dates:=array_append(dates,d);
  end loop;
 else
  if frequency='free' then raise exception 'Informe as datas livres';end if;
  for i in 0..n-1 loop d:=case when days is not null then first_due+i*days else (first_due+make_interval(months=>i*months))::date end;dates:=array_append(dates,d);end loop;
 end if;
 if dates[1]<>first_due then raise exception 'Primeira parcela diferente do primeiro vencimento';end if;
 for i in 1..n loop
  if dates[i] is null or dates[i]<current_date or extract(year from dates[i]) not between 1900 and 9999 or (i>1 and dates[i]<=dates[i-1]) then raise exception 'Vencimentos devem ser válidos, crescentes e sem repetição';end if;
 end loop;return dates;
end$$;
CREATE OR REPLACE FUNCTION cobranca_private.joint_negotiation(action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare p public.cobranca_profiles;d public.cobranca_debts;first_d public.cobranca_debts;ids uuid[];q jsonb;items jsonb:='[]';item jsonb;summary jsonb;fingerprint text;contract_base numeric:=0;

 base numeric:=0;principal numeric:=0;interest numeric:=0;fine numeric:=0;fees numeric:=0;discount numeric;total_c bigint;entry_c bigint;left_c bigint;count_parts int;due date;entry_due date;payment_due date;due_dates date[];frequency text;reason text;group_id uuid:=gen_random_uuid();a public.cobranca_agreements;

 weights numeric:=0;prev_weight numeric:=0;allocated bigint:=0;previous_allocated bigint:=0;own_total bigint;own_entry bigint;own_remaining bigint;entry_alloc bigint:=0;remaining_sum bigint;payment bigint;capacity bigint;prev_capacity bigint;piece bigint;paid_entry bigint:=0;part int;idx int;totals bigint[]:='{}';entries bigint[]:='{}';remains bigint[]:='{}';agreements uuid[]:='{}';schedule jsonb:='[]';

begin

 select * into p from public.cobranca_profiles where id=auth.uid() and active;

 if not found or p.role not in ('admin','master','supervisor','collector','finance') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;

 if action not in ('quote','formalize') or jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids') not between 1 and 1000 then raise exception 'Selecione de 1 a 1000 títulos';end if;

 select array_agg(distinct value::uuid order by value::uuid) into ids from jsonb_array_elements_text(payload->'ids');

 if (select count(*) from public.cobranca_debts x where x.id=any(ids) and cobranca_private.can_read_debt(p,x))<>cardinality(ids) then raise exception 'Seleção contém títulos não autorizados';end if;

 for d in select * from public.cobranca_debts where id=any(ids) order by id for update loop

  if first_d.id is null then first_d:=d;end if;

  if d.creditor_id<>first_d.creditor_id or cobranca_private.debtor_identity(d.debtor_id)<>cobranca_private.debtor_identity(first_d.debtor_id) then raise exception 'Negocie títulos do mesmo devedor e credor';end if;

  if d.status in ('paid','uncollectible','cancelled','canceled') or exists(select 1 from public.cobranca_agreements where debt_id=d.id and status='active') then raise exception 'Seleção contém título encerrado ou com acordo ativo';end if;

  q:=cobranca_private.financial_quote(d);

  contract_base:=contract_base+(q->>'total')::numeric;

  if coalesce(payload->'rate_overrides','{}'::jsonb) ? d.id::text then

   q:=cobranca_private.negotiated_quote(q||jsonb_build_object('has_receipts',exists(select 1 from public.cobranca_receipts r where r.debt_id=d.id and r.tenant_id=d.tenant_id and not r.reversed and r.paid_date<=current_date)),payload->'rate_overrides'->d.id::text);

  end if;

  if not coalesce((q->>'configured')::boolean,false) or (q->>'total')::numeric<=0 then raise exception 'Título sem saldo ou regra contratual pendente';end if;

  items:=items||jsonb_build_array(jsonb_build_object('id',d.id,'reference',d.external_ref,'quote',q));

  base:=base+(q->>'total')::numeric;principal:=principal+(q->>'principal')::numeric;interest:=interest+(q->>'interest')::numeric;fine:=fine+(q->>'fine')::numeric;fees:=fees+coalesce((q->>'fees')::numeric,0);

 end loop;

 fingerprint:=md5(items::text);

 summary:=jsonb_build_object('as_of',current_date,'principal',principal,'interest',interest,'fine',fine,'fees',fees,'total',base,'configured',true,'snapshot',fingerprint,'items',items,'contract_total',contract_base);

 if action='quote' then return summary;end if;

 if payload->>'expected_snapshot' is distinct from fingerprint then raise exception 'Os saldos mudaram. Reabra a simulação e revise a proposta';end if;

 discount:=nullif(payload->>'discount_percent','')::numeric;entry_c:=round(nullif(payload->>'down_payment','')::numeric*100);count_parts:=nullif(payload->>'installments','')::int;due:=nullif(payload->>'first_due_date','')::date;reason:=trim(coalesce(payload->>'reason',''));

 frequency:=coalesce(payload->>'payment_frequency','monthly');

 due_dates:=cobranca_private.payment_dates(payload);
 entry_due:=coalesce(nullif(payload->>'down_payment_due_date','')::date,due);

 if discount is null or discount<0 or discount>least(p.discount_limit,100) then raise exception 'Desconto acima da alçada';end if;

 total_c:=round(base*(1-discount/100),2)*100;

 if total_c/100.0 < round(contract_base*(1-least(p.discount_limit,100)/100),2) then raise exception 'Redução dos encargos e desconto acima da sua alçada';end if;

 if entry_c is null or entry_c<0 or entry_c>=total_c or count_parts is null or count_parts not between 1 and 120 or total_c-entry_c<count_parts or due is null or due<current_date or reason='' or length(reason)>2000 then raise exception 'Entrada, parcelas, vencimento ou aceite inválidos';end if;

 -- Cumulative proportional rounding guarantees that title totals equal the single proposal.

 idx:=0;

 for item in select value from jsonb_array_elements(items) loop

  idx:=idx+1;weights:=weights+(item->'quote'->>'total')::numeric;

  allocated:=round(weights*total_c/base);own_total:=allocated-previous_allocated;previous_allocated:=allocated;

  if own_total<=0 then raise exception 'Desconto deixa título sem valor. Reduza o desconto';end if;

  own_entry:=round(allocated::numeric*entry_c/total_c)-entry_alloc;entry_alloc:=entry_alloc+own_entry;own_remaining:=own_total-own_entry;

  totals:=array_append(totals,own_total);entries:=array_append(entries,own_entry);remains:=array_append(remains,own_remaining);

  select * into d from public.cobranca_debts where id=(item->>'id')::uuid;

  insert into public.cobranca_agreements(tenant_id,debt_id,debtor_id,status,total_amount,down_payment,installments,first_due_date,notes,created_by,financial_snapshot)

  values(p.tenant_id,d.id,d.debtor_id,'active',own_total/100.0,own_entry/100.0,count_parts,due,reason||E'\nPeriodicidade: '||frequency||E'\nNegociação conjunta: '||group_id::text,p.id::text,jsonb_build_object('down_payment_due_date',entry_due,'version',1,'quote',item->'quote','as_of',current_date,'group_id',group_id,'payment_frequency',frequency,'recurrence',jsonb_build_object('interval_count',payload->'interval_count','interval_unit',payload->'interval_unit'),'reference',d.external_ref,'original_amount',d.original_amount,'creditor_name',(select name from public.cobranca_creditors where id=d.creditor_id),'debtor_name',(select name from public.cobranca_debtors where id=d.debtor_id))) returning * into a;

  agreements:=array_append(agreements,a.id);

  if own_entry>0 then insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date) values(a.id,0,own_entry/100.0,entry_due);end if;

  update public.cobranca_debts set current_amount=own_total/100.0,status='agreement',app_status='Acordo formalizado',metadata=metadata||jsonb_build_object('financial_frozen',true,'agreement_quote',item->'quote','agreement_group_id',group_id,'agreement_group_total',total_c/100.0,'agreement_payment_frequency',frequency,'agreement_recurrence',jsonb_build_object('frequency',frequency,'interval_count',payload->'interval_count','interval_unit',payload->'interval_unit'),'agreement_due_dates',to_jsonb(due_dates)) where id=d.id;

  insert into public.cobranca_interaction_logs(tenant_id,creditor_id,debtor_id,debt_id,channel,direction,subject,content,payload) values(p.tenant_id,d.creditor_id,d.debtor_id,d.id,'negotiation','internal','Negociação conjunta',reason,jsonb_build_object('actor',p.id,'group_id',group_id,'payment_frequency',frequency,'due_dates',to_jsonb(due_dates),'interval_count',payload->'interval_count','interval_unit',payload->'interval_unit'));

 end loop;

 if entry_c>0 then schedule:=schedule||jsonb_build_array(jsonb_build_object('number',0,'amount',entry_c/100.0,'due_date',entry_due));end if;

 remaining_sum:=total_c-entry_c;

 for part in 1..count_parts loop

  payment_due:=due_dates[part];

  payment:=(total_c-entry_c)/count_parts+case when part<=(total_c-entry_c)%count_parts then 1 else 0 end;

  capacity:=0;prev_capacity:=0;previous_allocated:=0;

  for idx in 1..cardinality(ids) loop

   capacity:=capacity+remains[idx];allocated:=round(capacity::numeric*payment/remaining_sum);piece:=allocated-previous_allocated;previous_allocated:=allocated;

   if piece>0 then insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date) values(agreements[idx],part,piece/100.0,payment_due);end if;

   remains[idx]:=remains[idx]-piece;

  end loop;

  remaining_sum:=remaining_sum-payment;

  schedule:=schedule||jsonb_build_array(jsonb_build_object('number',part,'amount',payment/100.0,'due_date',payment_due));

 end loop;

 return jsonb_build_object('group_id',group_id,'total',total_c/100.0,'agreements',to_jsonb(agreements),'schedule',schedule,'payment_frequency',frequency);

end$function$
;
notify pgrst,'reload schema';
commit;
