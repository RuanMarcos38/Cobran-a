begin;
create or replace function cobranca_private.creditor_fee_band(config jsonb,fixed numeric,age_days int)
returns jsonb language plpgsql immutable set search_path='' as $$
declare rate numeric;label text;idx int;
begin
 if coalesce(config->>'fee_schedule_mode','fixed')<>'age' then return jsonb_build_object('rate',fixed,'label','Honorários fixos','configured',true);end if;
 for idx in 1..4 loop
  if nullif(config->>('fee_age_rate_'||idx),'') is null or (config->>('fee_age_rate_'||idx))::numeric not between 0 and 100 then raise exception 'Configure os percentuais das quatro faixas de honorários no credor';end if;
 end loop;
 if age_days<=0 then rate:=0;label:='Não vencido';
 elsif age_days<=60 then rate:=(config->>'fee_age_rate_1')::numeric;label:='1 a 60 dias';
 elsif age_days<=180 then rate:=(config->>'fee_age_rate_2')::numeric;label:='61 a 180 dias';
 elsif age_days<=365 then rate:=(config->>'fee_age_rate_3')::numeric;label:='181 a 365 dias';
 elsif age_days<=730 then rate:=(config->>'fee_age_rate_4')::numeric;label:='366 a 730 dias';
 else rate:=nullif(config->>'fee_age_rate_over','')::numeric;label:='Acima de 730 dias';end if;
 if rate is not null and rate not between 0 and 100 then raise exception 'Honorários devem estar entre 0 e 100 por cento';end if;
 return jsonb_build_object('rate',rate,'label',label,'configured',rate is not null);
end$$;
revoke all on function cobranca_private.creditor_fee_band(jsonb,numeric,int) from public,anon,authenticated;

create or replace function cobranca_private.financial_quote(d public.cobranca_debts, as_of date default current_date)
returns jsonb language plpgsql stable set search_path='' as $$
declare terms jsonb:=d.metadata->'financial_terms'; principal numeric:=d.original_amount; interest numeric:=0; fine numeric:=0; remainder numeric; used numeric; rate numeric; day_basis numeric; cursor_date date; event_date date; charge_start date; fine_applied boolean:=false; r record; result jsonb; c public.cobranca_creditors; fees numeric:=0; fee_applied boolean:=false; fee_rate numeric:=0; fee_base text:='principal'; band jsonb; fee_configured boolean:=true; age_days int:=greatest(as_of-d.due_date,0);
begin
 if coalesce((d.metadata->>'financial_frozen')::boolean,false) then return jsonb_build_object('as_of',as_of,'due_date',d.due_date,'principal',d.current_amount,'interest',0,'fine',0,'fees',0,'total',d.current_amount,'configured',true,'frozen',true);end if;
 select * into c from public.cobranca_creditors where id=d.creditor_id and tenant_id=d.tenant_id;
 if c.metadata->>'financial_mode' in ('none','monthly','daily') then
  terms:=jsonb_build_object('mode',c.metadata->>'financial_mode','interest_percent',coalesce(nullif(c.metadata->>'default_interest','')::numeric,0),'fine_percent',coalesce(nullif(c.metadata->>'default_fine','')::numeric,0),'grace_days',coalesce(nullif(c.metadata->>'grace_days','')::int,0),'fee_percent',c.fee_percent,'fee_basis',coalesce(c.metadata->>'fee_basis','principal'),'source','creditor');
 end if;
 if c.metadata->>'fee_schedule_mode'='age' then
  band:=cobranca_private.creditor_fee_band(c.metadata,c.fee_percent,age_days);
  fee_configured:=(band->>'configured')::boolean;
  terms:=terms||jsonb_build_object('fee_percent',band->'rate','fee_schedule_mode','age','fee_age_days',age_days,'fee_band',band->>'label');
 end if;
 fee_rate:=coalesce((terms->>'fee_percent')::numeric,0)/100;fee_base:=coalesce(terms->>'fee_basis','principal');
 if coalesce((terms->>'interest_percent')::numeric,0) not between 0 and 100 or coalesce((terms->>'fine_percent')::numeric,0) not between 0 and 100 or fee_rate not between 0 and 1 or fee_base not in ('principal','updated') then raise exception 'Condições do contrato inválidas: confira o cadastro do credor';end if;
 if terms is null or coalesce((d.metadata->>'financial_frozen')::boolean,false) then
  return jsonb_build_object('as_of',as_of,'principal',d.current_amount,'interest',0,'fine',0,'fees',0,'due_date',d.due_date,'total',d.current_amount,'configured',terms is not null or (d.interest_percent=0 and d.fine_percent=0),'frozen',coalesce((d.metadata->>'financial_frozen')::boolean,false));
 end if;
 charge_start:=d.due_date+coalesce((terms->>'grace_days')::int,0);cursor_date:=charge_start;
 rate:=coalesce((terms->>'interest_percent')::numeric,0)/100;day_basis:=case terms->>'mode' when 'monthly' then 30 else 1 end;
 for r in select amount,paid_date,calculation from public.cobranca_receipts where debt_id=d.id and tenant_id=d.tenant_id and not reversed and paid_date<=as_of order by paid_date,created_at,id loop
  event_date:=greatest(r.paid_date,charge_start);
  if terms->>'mode'<>'none' then interest:=interest+principal*rate*greatest(event_date-cursor_date,0)/day_basis;end if;
  if r.paid_date>charge_start and not fine_applied then fine:=round(principal*coalesce((terms->>'fine_percent')::numeric,0)/100,2);fine_applied:=true;end if;
  if r.paid_date>charge_start and not fee_applied and c.metadata->>'fee_schedule_mode'='age' then
   if r.calculation->'terms'->>'fee_percent' is not null then
    fee_rate:=(r.calculation->'terms'->>'fee_percent')::numeric/100;fee_configured:=true;
    terms:=terms||jsonb_build_object('fee_percent',fee_rate*100,'fee_band','Percentual preservado do recebimento');
   else
    band:=cobranca_private.creditor_fee_band(c.metadata,c.fee_percent,greatest(r.paid_date-d.due_date,0));fee_rate:=coalesce((band->>'rate')::numeric,0)/100;fee_configured:=(band->>'configured')::boolean;
   end if;
  end if;
  if r.paid_date>charge_start and not fee_applied then fees:=round((principal+case when fee_base='updated' then round(interest,2)+fine else 0 end)*fee_rate,2);fee_applied:=true;end if;
  cursor_date:=greatest(cursor_date,event_date);remainder:=r.amount;
  interest:=round(interest,2);used:=least(remainder,interest);interest:=interest-used;remainder:=remainder-used;
  used:=least(remainder,fine);fine:=fine-used;remainder:=remainder-used;used:=least(remainder,fees);fees:=fees-used;remainder:=remainder-used;principal:=greatest(0,principal-remainder);
 end loop;
 if terms->>'mode'<>'none' then interest:=interest+principal*rate*greatest(as_of-cursor_date,0)/day_basis;end if;
 if as_of>charge_start and not fine_applied then fine:=round(principal*coalesce((terms->>'fine_percent')::numeric,0)/100,2);end if;
 if as_of>charge_start and not fee_applied then fees:=round((principal+case when fee_base='updated' then round(interest,2)+fine else 0 end)*fee_rate,2);end if;
 return jsonb_build_object('as_of',as_of,'due_date',d.due_date,'fees',fees,'principal',round(principal,2),'interest',round(interest,2),'fine',round(fine,2),'total',round(principal+interest+fine+fees,2),'configured',fee_configured,'frozen',false,'snapshot',md5(jsonb_build_object('as_of',as_of,'principal',principal,'interest',round(interest,2),'fine',fine,'fees',fees,'terms',terms)::text),'terms',terms,'days',greatest(as_of-charge_start,0));
end $$;

notify pgrst,'reload schema';
commit;
