begin;
create or replace function cobranca_private.financial_quote(d public.cobranca_debts, as_of date default current_date)
returns jsonb language plpgsql stable set search_path='' as $$
declare terms jsonb:=d.metadata->'financial_terms'; principal numeric:=d.original_amount; interest numeric:=0; fine numeric:=0; remainder numeric; used numeric; rate numeric; day_basis numeric; cursor_date date; event_date date; charge_start date; fine_applied boolean:=false; r record; result jsonb; c public.cobranca_creditors; fees numeric:=0; fee_applied boolean:=false; fee_rate numeric:=0; fee_base text:='principal';
begin
 if coalesce((d.metadata->>'financial_frozen')::boolean,false) then return jsonb_build_object('as_of',as_of,'due_date',d.due_date,'principal',d.current_amount,'interest',0,'fine',0,'fees',0,'total',d.current_amount,'configured',true,'frozen',true);end if;
 select * into c from public.cobranca_creditors where id=d.creditor_id and tenant_id=d.tenant_id;
 if c.metadata->>'financial_mode' in ('none','monthly','daily') then
  terms:=jsonb_build_object('mode',c.metadata->>'financial_mode','interest_percent',coalesce(nullif(c.metadata->>'default_interest','')::numeric,0),'fine_percent',coalesce(nullif(c.metadata->>'default_fine','')::numeric,0),'grace_days',coalesce(nullif(c.metadata->>'grace_days','')::int,0),'fee_percent',c.fee_percent,'fee_basis',coalesce(c.metadata->>'fee_basis','principal'),'source','creditor');
 end if;
 fee_rate:=coalesce((terms->>'fee_percent')::numeric,0)/100;fee_base:=coalesce(terms->>'fee_basis','principal');
 if coalesce((terms->>'interest_percent')::numeric,0) not between 0 and 100 or coalesce((terms->>'fine_percent')::numeric,0) not between 0 and 100 or fee_rate not between 0 and 1 or fee_base not in ('principal','updated') then raise exception 'Condições do contrato inválidas: confira o cadastro do credor';end if;
 if terms is null or coalesce((d.metadata->>'financial_frozen')::boolean,false) then
  return jsonb_build_object('as_of',as_of,'principal',d.current_amount,'interest',0,'fine',0,'fees',0,'due_date',d.due_date,'total',d.current_amount,'configured',terms is not null or (d.interest_percent=0 and d.fine_percent=0),'frozen',coalesce((d.metadata->>'financial_frozen')::boolean,false));
 end if;
 charge_start:=d.due_date+coalesce((terms->>'grace_days')::int,0);cursor_date:=charge_start;
 rate:=coalesce((terms->>'interest_percent')::numeric,0)/100;day_basis:=case terms->>'mode' when 'monthly' then 30 else 1 end;
 for r in select amount,paid_date from public.cobranca_receipts where debt_id=d.id and tenant_id=d.tenant_id and not reversed and paid_date<=as_of order by paid_date,created_at,id loop
  event_date:=greatest(r.paid_date,charge_start);
  if terms->>'mode'<>'none' then interest:=interest+principal*rate*greatest(event_date-cursor_date,0)/day_basis;end if;
  if r.paid_date>charge_start and not fine_applied then fine:=round(principal*coalesce((terms->>'fine_percent')::numeric,0)/100,2);fine_applied:=true;end if;
  if r.paid_date>charge_start and not fee_applied then fees:=round((principal+case when fee_base='updated' then round(interest,2)+fine else 0 end)*fee_rate,2);fee_applied:=true;end if;
  cursor_date:=greatest(cursor_date,event_date);remainder:=r.amount;
  interest:=round(interest,2);used:=least(remainder,interest);interest:=interest-used;remainder:=remainder-used;
  used:=least(remainder,fine);fine:=fine-used;remainder:=remainder-used;used:=least(remainder,fees);fees:=fees-used;remainder:=remainder-used;principal:=greatest(0,principal-remainder);
 end loop;
 if terms->>'mode'<>'none' then interest:=interest+principal*rate*greatest(as_of-cursor_date,0)/day_basis;end if;
 if as_of>charge_start and not fine_applied then fine:=round(principal*coalesce((terms->>'fine_percent')::numeric,0)/100,2);end if;
 if as_of>charge_start and not fee_applied then fees:=round((principal+case when fee_base='updated' then round(interest,2)+fine else 0 end)*fee_rate,2);end if;
 return jsonb_build_object('as_of',as_of,'due_date',d.due_date,'fees',fees,'principal',round(principal,2),'interest',round(interest,2),'fine',round(fine,2),'total',round(principal+interest+fine+fees,2),'configured',true,'frozen',false,'snapshot',md5(jsonb_build_object('as_of',as_of,'principal',principal,'interest',round(interest,2),'fine',fine,'fees',fees,'terms',terms)::text),'terms',terms,'days',greatest(as_of-charge_start,0));
end $$;
revoke all on function cobranca_private.financial_quote(public.cobranca_debts,date) from public,anon,authenticated;

create or replace function cobranca_private.joint_negotiation(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;d public.cobranca_debts;first_d public.cobranca_debts;ids uuid[];q jsonb;items jsonb:='[]';item jsonb;summary jsonb;fingerprint text;
 base numeric:=0;principal numeric:=0;interest numeric:=0;fine numeric:=0;fees numeric:=0;discount numeric;total_c bigint;entry_c bigint;left_c bigint;count_parts int;due date;reason text;group_id uuid:=gen_random_uuid();a public.cobranca_agreements;
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
  if not coalesce((q->>'configured')::boolean,false) or (q->>'total')::numeric<=0 then raise exception 'Título sem saldo ou regra contratual pendente';end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',d.id,'reference',d.external_ref,'quote',q));
  base:=base+(q->>'total')::numeric;principal:=principal+(q->>'principal')::numeric;interest:=interest+(q->>'interest')::numeric;fine:=fine+(q->>'fine')::numeric;fees:=fees+coalesce((q->>'fees')::numeric,0);
 end loop;
 fingerprint:=md5(items::text);
 summary:=jsonb_build_object('as_of',current_date,'principal',principal,'interest',interest,'fine',fine,'fees',fees,'total',base,'configured',true,'snapshot',fingerprint,'items',items);
 if action='quote' then return summary;end if;
 if payload->>'expected_snapshot' is distinct from fingerprint then raise exception 'Os saldos mudaram. Reabra a simulação e revise a proposta';end if;
 discount:=nullif(payload->>'discount_percent','')::numeric;entry_c:=round(nullif(payload->>'down_payment','')::numeric*100);count_parts:=nullif(payload->>'installments','')::int;due:=nullif(payload->>'first_due_date','')::date;reason:=trim(coalesce(payload->>'reason',''));
 if discount is null or discount<0 or discount>least(p.discount_limit,100) then raise exception 'Desconto acima da alçada';end if;
 total_c:=round(base*(1-discount/100),2)*100;
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
  insert into public.cobranca_agreements(tenant_id,debt_id,debtor_id,status,total_amount,down_payment,installments,first_due_date,notes,created_by)
  values(p.tenant_id,d.id,d.debtor_id,'active',own_total/100.0,own_entry/100.0,count_parts,due,reason||E'\nNegociação conjunta: '||group_id::text,p.id::text) returning * into a;
  agreements:=array_append(agreements,a.id);
  if own_entry>0 then insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date) values(a.id,0,own_entry/100.0,due);end if;
  update public.cobranca_debts set current_amount=own_total/100.0,status='agreement',app_status='Acordo formalizado',metadata=metadata||jsonb_build_object('financial_frozen',true,'agreement_quote',item->'quote','agreement_group_id',group_id,'agreement_group_total',total_c/100.0) where id=d.id;
  insert into public.cobranca_interaction_logs(tenant_id,creditor_id,debtor_id,debt_id,channel,direction,subject,content,payload) values(p.tenant_id,d.creditor_id,d.debtor_id,d.id,'negotiation','internal','Negociação conjunta',reason,jsonb_build_object('actor',p.id,'group_id',group_id));
 end loop;
 if entry_c>0 then schedule:=schedule||jsonb_build_array(jsonb_build_object('number',0,'amount',entry_c/100.0,'due_date',due));end if;
 remaining_sum:=total_c-entry_c;
 for part in 1..count_parts loop
  payment:=(total_c-entry_c)/count_parts+case when part<=(total_c-entry_c)%count_parts then 1 else 0 end;
  capacity:=0;prev_capacity:=0;previous_allocated:=0;
  for idx in 1..cardinality(ids) loop
   capacity:=capacity+remains[idx];allocated:=round(capacity::numeric*payment/remaining_sum);piece:=allocated-previous_allocated;previous_allocated:=allocated;
   if piece>0 then insert into public.cobranca_agreement_installments(agreement_id,installment_number,amount,due_date) values(agreements[idx],part,piece/100.0,(due+(part-1)*interval '1 month')::date);end if;
   remains[idx]:=remains[idx]-piece;
  end loop;
  remaining_sum:=remaining_sum-payment;
  schedule:=schedule||jsonb_build_array(jsonb_build_object('number',part,'amount',payment/100.0,'due_date',(due+(part-1)*interval '1 month')::date));
 end loop;
 return jsonb_build_object('group_id',group_id,'total',total_c/100.0,'agreements',to_jsonb(agreements),'schedule',schedule);
end$$;
revoke all on function cobranca_private.joint_negotiation(text,jsonb) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
