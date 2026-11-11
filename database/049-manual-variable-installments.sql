-- Additive patch: free amounts require a sum equal to the current negotiated balance.
-- Existing equal-installment agreements remain unchanged if installment_amounts is absent.
begin;
set local lock_timeout='5s';
do $patch$
declare
 definition text;
 old_declaration text:='schedule jsonb:=''[]'';';
 old_total text:='total_c:=round(base*(1-discount/100),2)*100;';
 old_payment text:='payment:=(total_c-entry_c)/count_parts+case when part<=(total_c-entry_c)%count_parts then 1 else 0 end;';
begin
 definition:=pg_get_functiondef('cobranca_private.joint_negotiation(text,jsonb)'::regprocedure);
 if position(old_declaration in definition)=0 or position(old_total in definition)=0 or position(old_payment in definition)=0 then
  raise exception 'Assinatura do motor financeiro inesperada; migração abortada sem alterações';
 end if;
 definition:=replace(definition,old_declaration,old_declaration||
   E'\n manual_amounts jsonb;manual_sum bigint:=0;manual_cents bigint;manual_text text;');
 definition:=replace(definition,old_total,old_total||$val$

 manual_amounts:=payload->'installment_amounts';
 if manual_amounts is not null and manual_amounts<>'null'::jsonb then
  if coalesce(payload->>'payment_frequency','monthly')<>'free' or
     jsonb_typeof(manual_amounts)<>'array' or
     jsonb_array_length(manual_amounts)<>count_parts then
    raise exception 'O acordo manual exige todas as parcelas e periodicidade livre';
  end if;
  manual_sum:=0;
  for manual_text in select value from jsonb_array_elements_text(manual_amounts) loop
   if manual_text !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'Valor de parcela inválido';end if;
   manual_cents:=round(manual_text::numeric*100)::bigint;
   if manual_cents<=0 then raise exception 'Parcelas devem ser positivas';end if;
   manual_sum:=manual_sum+manual_cents;
  end loop;
  if manual_sum<>total_c-entry_c then
   raise exception 'Soma das parcelas difere do saldo negociado';
  end if;
 end if;
$val$);
 definition:=replace(definition,old_payment,$payment$
  if manual_amounts is not null and manual_amounts<>'null'::jsonb then
   payment:=round((manual_amounts->>(part-1))::numeric*100)::bigint;
  else
   payment:=(total_c-entry_c)/count_parts+case when part<=(total_c-entry_c)%count_parts then 1 else 0 end;
  end if;
$payment$);
 execute definition;
end $patch$;
notify pgrst,'reload schema';
commit;
