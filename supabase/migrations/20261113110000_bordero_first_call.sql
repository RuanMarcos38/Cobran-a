begin;
create unique index if not exists cobranca_bordero_first_call_unique
 on public.cobranca_human_tasks(tenant_id,creditor_id,debtor_id)
 where type='call' and metadata->>'source'='bordero_first_call';

create function cobranca_private.import_bordero_with_first_call(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; calls integer;
begin
 result:=cobranca_private.file_bordero('bordero_import',payload);
 insert into public.cobranca_human_tasks
 (tenant_id,creditor_id,debtor_id,debt_id,type,title,description,assigned_to,metadata)
 select distinct on (d.tenant_id,d.creditor_id,d.debtor_id)
  d.tenant_id,d.creditor_id,d.debtor_id,d.id,'call','Primeiro contato do borderô',
  'Confirme o responsável pelo atendimento antes de tratar da pendência e registre a tentativa no histórico.',
  d.assigned_to::text,jsonb_build_object('source','bordero_first_call','batch_id',result->>'batch_id')
 from jsonb_array_elements(result->'items') item
 join public.cobranca_debts d on d.id=(item->>'id')::uuid
 join public.cobranca_debtors b on b.id=d.debtor_id and b.tenant_id=d.tenant_id and b.creditor_id=d.creditor_id
 where not (item->>'duplicate')::boolean and d.metadata->>'bordero_id'=result->>'batch_id'
   and not coalesce(b.opt_out,false) and nullif(regexp_replace(coalesce(b.phone,''),'[^0-9]','','g'),'') is not null
   and d.current_amount>0 and d.due_date<(now() at time zone 'America/Sao_Paulo')::date
 order by d.tenant_id,d.creditor_id,d.debtor_id,d.due_date,d.id
 on conflict do nothing;
 get diagnostics calls=row_count;
 return result||jsonb_build_object('call_tasks_created',calls);
end $$;
revoke all on function cobranca_private.import_bordero_with_first_call(jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.import_bordero_with_first_call(jsonb) to authenticated;
do $route$
declare definition text:=pg_get_functiondef('public.cobranca_app(text,jsonb)'::regprocedure);
begin
 if position('select case' in definition)=0 then raise exception 'Roteador inesperado';end if;
 execute replace(definition,'select case','select case when action=''bordero_import'' then cobranca_private.import_bordero_with_first_call(payload)');
end $route$;
notify pgrst,'reload schema';
commit;
