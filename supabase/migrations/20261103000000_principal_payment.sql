begin;
do $migration$
declare
 definition text;
 previous text;
begin
 definition:=pg_get_functiondef('cobranca_private.financial_quote(public.cobranca_debts,date)'::regprocedure);
 previous:=definition;
 definition:=replace(definition,'cursor_date:=greatest(cursor_date,event_date);remainder:=r.amount;',
 $sql$cursor_date:=greatest(cursor_date,event_date);
  if r.calculation->>'allocation'='principal' then
   interest:=round(interest,2);
   principal:=greatest(0,principal-r.amount);
   continue;
  end if;
  remainder:=r.amount;$sql$);
 if definition=previous then raise exception 'Versão incompatível do cálculo financeiro';end if;
 execute definition;

 definition:=pg_get_functiondef('cobranca_private.api(text,jsonb)'::regprocedure);
 previous:=definition;
 definition:=replace(definition,'   insert into public.cobranca_receipts(tenant_id,debt_id,reference,amount,fee_amount,paid_date,actor,reason,calculation)',
 $sql$   if payload->>'allocation'='principal' then
    if coalesce((d.metadata->>'financial_frozen')::boolean,false)
      or exists(select 1 from public.cobranca_agreements where debt_id=d.id and status='active') then
     raise exception 'Use a baixa padrão para títulos com saldo congelado ou acordo ativo';
    end if;
    if amount>(cobranca_private.financial_quote(d,(payload->>'paid_date')::date)->>'principal')::numeric then
     raise exception 'O pagamento excede o capital em aberto na data do recebimento';
    end if;
   end if;

   insert into public.cobranca_receipts(tenant_id,debt_id,reference,amount,fee_amount,paid_date,actor,reason,calculation)$sql$);
 if definition=previous then raise exception 'Versão incompatível da validação de recebimentos';end if;
 previous:=definition;
 definition:=replace(definition,
 'p.id,payload->>''reason'',cobranca_private.financial_quote(d,(payload->>''paid_date'')::date)) returning * into r;',
 $sql$p.id,payload->>'reason',cobranca_private.financial_quote(d,(payload->>'paid_date')::date) ||
     case when payload->>'allocation'='principal' then jsonb_build_object('allocation','principal') else '{}'::jsonb end) returning * into r;$sql$);
 if definition=previous then raise exception 'Versão incompatível do serviço de recebimentos';end if;
 execute definition;
end
$migration$;
notify pgrst,'reload schema';
commit;
