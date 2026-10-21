begin;
create or replace function cobranca_private.negotiated_quote(q jsonb, rates jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare t jsonb:=q->'terms'; k text; v numeric; old numeric; principal numeric:=(q->>'principal')::numeric; interest numeric:=(q->>'interest')::numeric; fine numeric:=(q->>'fine')::numeric; fees numeric:=coalesce((q->>'fees')::numeric,0); oldbase numeric; newbase numeric; factor numeric:=1;
begin
 if jsonb_typeof(rates) is distinct from 'object' or t is null or not coalesce((q->>'configured')::boolean,false) then raise exception 'Condições contratuais indisponíveis';end if;
 if exists(select 1 from jsonb_object_keys(rates) x where x not in ('interest_percent','fine_percent','fee_percent')) then raise exception 'Percentual não permitido';end if;
 oldbase:=principal+interest+fine;
 foreach k in array array['interest_percent','fine_percent','fee_percent'] loop
  if rates ? k then
   if jsonb_typeof(rates->k) not in ('string','number') or (rates->>k) !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'Percentual inválido';end if;
   v:=(rates->>k)::numeric;old:=coalesce((t->>k)::numeric,0);
   if v<0 or v>old or v>100 then raise exception 'Use percentual entre zero e o contratado';end if;
   if k='interest_percent' then interest:=case when old=0 then 0 else round(interest*v/old,2) end;
   elsif k='fine_percent' then fine:=case when old=0 then 0 else round(fine*v/old,2) end;
   else factor:=case when old=0 then 0 else v/old end;end if;
   t:=t||jsonb_build_object(k,v);
  end if;
 end loop;
 newbase:=principal+interest+fine;
 fees:=round(fees*factor*case when t->>'fee_basis'='updated' and oldbase>0 then newbase/oldbase else 1 end,2);
 t:=t||jsonb_build_object('source','negotiation','contract_terms',q->'terms','fee_schedule_mode','negotiated','fee_band','Percentual negociado');
 return q||jsonb_build_object('terms',t,'interest',interest,'fine',fine,'fees',fees,'total',principal+interest+fine+fees,'rate_overrides',rates,'snapshot',md5((q->>'snapshot')||rates::text));
end$$;
revoke all on function cobranca_private.negotiated_quote(jsonb,jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION cobranca_private.joint_negotiation(action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.cobranca_profiles;d public.cobranca_debts;first_d public.cobranca_debts;ids uuid[];q jsonb;items jsonb:='[]';item jsonb;summary jsonb;fingerprint text;contract_base numeric:=0;
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
  contract_base:=contract_base+(q->>'total')::numeric;
  if coalesce(payload->'rate_overrides','{}'::jsonb) ? d.id::text then
   q:=cobranca_private.negotiated_quote(q,payload->'rate_overrides'->d.id::text);
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
end$function$
;
notify pgrst,'reload schema';
commit;
