do $migration$
declare
 calendar text := pg_get_functiondef('cobranca_private.payment_dates(jsonb)'::regprocedure);
 negotiation text := pg_get_functiondef('cobranca_private.joint_negotiation(text,jsonb)'::regprocedure);
 date_floor text := 'coalesce(nullif(payload->>''historical_agreement_date'','''')::date,current_date)';
begin
 if position('first_due<current_date' in calendar)=0 or position('(payload->>''down_payment_due_date'')::date<current_date' in calendar)=0 or position('dates[i]<current_date' in calendar)=0 or position('due<current_date' in negotiation)=0 or position('due_dates:=cobranca_private.payment_dates(payload);' in negotiation)=0 then
  raise exception 'As funções de negociação mudaram. Revise a migração.';
 end if;
 calendar := replace(calendar,'first_due<current_date','first_due<'||date_floor);
 calendar := replace(calendar,'(payload->>''down_payment_due_date'')::date<current_date','(payload->>''down_payment_due_date'')::date<'||date_floor);
 calendar := replace(calendar,'dates[i]<current_date','dates[i]<'||date_floor);
 negotiation := replace(negotiation,'due<current_date','due<'||date_floor);
 negotiation := replace(negotiation,'due_dates:=cobranca_private.payment_dates(payload);',$check$
 if nullif(payload->>'historical_agreement_date','') is not null then
  if p.role not in ('admin','master','finance') then raise exception 'Acordo histórico restrito à administração e ao financeiro'; end if;
  if (payload->>'historical_agreement_date')::date not between date '1900-01-01' and (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data original do acordo inválida'; end if;
 end if;
 due_dates:=cobranca_private.payment_dates(payload);
 $check$);
 if position('jsonb_build_object(''down_payment_due_date'',entry_due,' in negotiation)=0 then raise exception 'Snapshot financeiro mudou'; end if;
 negotiation := replace(negotiation,'jsonb_build_object(''down_payment_due_date'',entry_due,','jsonb_build_object(''historical_agreement_date'',nullif(payload->>''historical_agreement_date'','''')::date,''down_payment_due_date'',entry_due,');
 execute calendar;
 execute negotiation;
end
$migration$;
