-- Add overdue calendar days without changing contracted grace or financial calculations.
-- The current 'days' value remains chargeable-days for backward compatibility.
begin;
set local lock_timeout='5s';
do $migration$
declare definition text; changed text;
begin
 definition:=pg_get_functiondef('cobranca_private.financial_quote(public.cobranca_debts,date)'::regprocedure);
 if position('''days'',greatest(as_of-charge_start,0)' in definition)=0 then
  raise exception 'Unexpected financial_quote version; inspect current definition before migration';
 end if;
 changed:=replace(definition,
   '''days'',greatest(as_of-charge_start,0)',
   '''days'',greatest(as_of-charge_start,0),''days_in_arrears'',greatest(as_of-d.due_date,0),''chargeable_days'',greatest(as_of-charge_start,0)');
 execute changed;
end
$migration$;
commit;
