-- 051: explicit title-level grace, no changes to original maturity or historical receipts/agreements.
begin;
set local lock_timeout='5s';

create or replace function cobranca_private.title_grace(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare p public.cobranca_profiles; d public.cobranca_debts; c public.cobranca_creditors;
 selection text; days int; rationale text; previous jsonb; updated jsonb; before_quote jsonb; after_quote jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master') or
    not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then
  raise exception 'Somente o administrador pode alterar a carência de um título';
 end if;
 select * into d from public.cobranca_debts
 where id=nullif(payload->>'id','')::uuid and tenant_id=p.tenant_id for update;
 if not found then raise exception 'Título não encontrado ou não autorizado';end if;
 if d.status in ('paid','cancelled','canceled','uncollectible') or
    coalesce((d.metadata->>'financial_frozen')::boolean,false) or
    exists(select 1 from public.cobranca_receipts r where r.tenant_id=p.tenant_id and r.debt_id=d.id) or
    exists(select 1 from public.cobranca_agreements a where a.tenant_id=p.tenant_id and a.debt_id=d.id) then
    raise exception 'Título com pagamentos, acordos ou saldo encerrado: preserve a memória histórica. Solicite revisão financeira auditada.';
 end if;
 select * into c from public.cobranca_creditors where id=d.creditor_id and tenant_id=p.tenant_id;
 if not found then raise exception 'Credor não encontrado';end if;
 selection:=coalesce(payload->>'selection','');
 if selection not in ('inherit','custom','none') then raise exception 'Escolha herdar do credor, carência personalizada ou sem carência';end if;
 if selection='custom' then
  if coalesce(payload->>'days','') !~ '^[0-9]{1,4}$' then raise exception 'Carência inválida';end if;
  days:=(payload->>'days')::int;
  if days not between 0 and 3650 then raise exception 'Carência deve estar entre zero e 3650 dias';end if;
 else days:=null;end if;
 rationale:=trim(coalesce(payload->>'reason',''));
 if length(rationale) not between 10 and 1000 then raise exception 'Justificativa obrigatória de 10 a 1000 caracteres';end if;
 previous:=d.metadata->'title_grace';
 before_quote:=cobranca_private.financial_quote(d,(now() at time zone 'America/Sao_Paulo')::date);
 updated:=jsonb_build_object('selection',selection,'days',days,'reason',rationale,
    'saved_at',now(),'saved_by',p.id,'creditor_id',d.creditor_id,'original_due_date',d.due_date);
 update public.cobranca_debts
 set metadata=case when selection='inherit'
  then coalesce(d.metadata,'{}'::jsonb)-'title_grace'
  else coalesce(d.metadata,'{}'::jsonb)||jsonb_build_object('title_grace',updated) end
 where id=d.id and tenant_id=p.tenant_id returning * into d;
 after_quote:=cobranca_private.financial_quote(d,(now() at time zone 'America/Sao_Paulo')::date);
 perform cobranca_private.audit(p.tenant_id,'title_grace','cobranca_debts',d.id,
   jsonb_build_object('previous',previous,'quote',before_quote,'due_date',d.due_date),
   jsonb_build_object('new',case when selection='inherit' then null else updated end,'quote',after_quote,'reason',rationale));
 return jsonb_build_object('saved',true,'id',d.id,'due_date',d.due_date,
    'selection',selection,'days',days,'quote',after_quote);
end
$function$;
revoke all on function cobranca_private.title_grace(jsonb) from public,anon;
grant execute on function cobranca_private.title_grace(jsonb) to authenticated;

do $patch$
declare original_def text;next_def text;
begin
 original_def:=pg_get_functiondef('cobranca_private.financial_quote(public.cobranca_debts,date)'::regprocedure);
 if position('charge_start:=d.due_date+coalesce((terms->>''grace_days'')::int,0);cursor_date:=charge_start;' in original_def)=0 then
  raise exception 'Motor financeiro alterado: abortado para preservar os cálculos existentes';
 end if;
 next_def:=replace(original_def,
  'charge_start:=d.due_date+coalesce((terms->>''grace_days'')::int,0);cursor_date:=charge_start;',
  $quote$-- An explicit per-title rule overrides only grace, preserving creditor interest, fine and fee rates.
 if jsonb_typeof(d.metadata->'title_grace')='object' then
  if d.metadata->'title_grace'->>'selection'='custom' then
   terms:=terms||jsonb_build_object('grace_days',(d.metadata->'title_grace'->>'days')::int,'grace_source','title');
  elsif d.metadata->'title_grace'->>'selection'='none' then
   terms:=terms||jsonb_build_object('grace_days',0,'grace_source','title_no_grace');
  end if;
 else
  terms:=terms||jsonb_build_object('grace_source','creditor_or_contract');
 end if;
 charge_start:=d.due_date+coalesce((terms->>'grace_days')::int,0);cursor_date:=charge_start;$quote$);
 if next_def=original_def then raise exception 'Não foi possível atualizar a precedência da carência';end if;
 execute next_def;
end
$patch$;

-- Add only one routing branch, keeping all other API operations as they are.
do $route$
declare definition text;new_definition text;
begin
 definition:=pg_get_functiondef('public.cobranca_app(text,jsonb)'::regprocedure);
 if position('when action in (''creditor_dashboard'',''duplicate_debtors''' in definition)=0 then
  raise exception 'Roteador incompatível, migração não aplicada';
 end if;
 new_definition:=replace(definition,
   'when action in (''creditor_dashboard'',''duplicate_debtors''',
   'when action=''title_grace'' then cobranca_private.title_grace(payload)'||chr(10)||
   ' when action in (''creditor_dashboard'',''duplicate_debtors''');
 execute new_definition;
end
$route$;

notify pgrst,'reload schema';
commit;
