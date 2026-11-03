begin;
-- One identity across creditor-specific debtor records, with an ID fallback.
create function cobranca_private.debtor_identity(ident uuid) returns text language sql stable set search_path='' as $$
 select case when length(regexp_replace(upper(coalesce(document,'')),'[^A-Z0-9]','','g')) in (11,14) then regexp_replace(upper(document),'[^A-Z0-9]','','g') else id::text end from public.cobranca_debtors where id=ident
$$;
revoke all on function cobranca_private.debtor_identity(uuid) from public,anon,authenticated;
create or replace function cobranca_private.assign_automatically() returns trigger language plpgsql security definer set search_path='' as $$
declare r cobranca_private.distribution_rules;chosen uuid;owners integer;company text;
begin
 select * into r from cobranca_private.distribution_rules where tenant_id=new.tenant_id and enabled for update;
 if not found then return new;end if;
 company:=cobranca_private.debtor_identity(new.debtor_id);
 select count(distinct d.assigned_to),(array_agg(d.assigned_to order by d.created_at,d.id))[1] into owners,chosen
 from public.cobranca_debts d join public.cobranca_profiles p on p.id=d.assigned_to and p.active and p.role='collector' and p.tenant_id=new.tenant_id
 where d.tenant_id=new.tenant_id and cobranca_private.debtor_identity(d.debtor_id)=company and d.status not in ('paid','uncollectible','cancelled','canceled');
 if owners>1 then raise exception 'Empresa devedora possui mais de um cobrador. Distribua seus títulos em conjunto antes de importar novos títulos';end if;
 if chosen is null then
  select id into chosen from public.cobranca_profiles where tenant_id=new.tenant_id and active and role='collector' and id=any(r.members) and (r.last_assigned is null or id>r.last_assigned) order by id limit 1;
  if chosen is null then select id into chosen from public.cobranca_profiles where tenant_id=new.tenant_id and active and role='collector' and id=any(r.members) order by id limit 1;end if;
  if chosen is null then raise exception 'Distribuição automática ativa sem negociadores habilitados';end if;
  update cobranca_private.distribution_rules set last_assigned=chosen where tenant_id=new.tenant_id;
 end if;
 new.assigned_to:=chosen;return new;
end$$;
create function cobranca_private.debt_batch(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;ids uuid[];expanded uuid[];d public.cobranca_debts;ref record;linked boolean;rows jsonb:='[]';token text;total numeric:=0;blocked integer:=0;reason text;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;
 if p.role not in ('admin','master') and not(action='distribute' and p.role='supervisor') then raise exception 'Ação exclusiva do administrador';end if;
 if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids') not between 1 and 1000 then raise exception 'Selecione de 1 a 1000 títulos';end if;
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(payload->'ids');
 if (select count(*) from public.cobranca_debts where id=any(ids) and tenant_id=p.tenant_id)<>cardinality(ids) then raise exception 'Seleção contém títulos indisponíveis';end if;
 if action='distribute' then
  -- Serialize with imports before expanding the company set.
  perform 1 from cobranca_private.distribution_rules where tenant_id=p.tenant_id for update;
  select array_agg(x.id order by x.id) into expanded from public.cobranca_debts x where x.tenant_id=p.tenant_id and x.status not in ('paid','uncollectible','cancelled','canceled') and cobranca_private.debtor_identity(x.debtor_id) in (select cobranca_private.debtor_identity(s.debtor_id) from public.cobranca_debts s where s.id=any(ids));
  if expanded is null then raise exception 'Nenhum título aberto para distribuir';end if;
  return cobranca_private.api('distribute',payload||jsonb_build_object('ids',to_jsonb(expanded)));
 end if;
 if action not in ('debt_delete_preview','debt_delete_commit') then raise exception 'Operação inválida';end if;
 -- Lock parents before checking every FK, including future integrations. Never cascade history.
 for d in select * from public.cobranca_debts where id=any(ids) and tenant_id=p.tenant_id order by id for update loop
  linked:=false;
  for ref in select n.nspname,c.relname,a.attname from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid=k.conrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] where k.contype='f' and k.confrelid='public.cobranca_debts'::regclass loop
   execute format('select exists(select 1 from %I.%I where %I=$1)',ref.nspname,ref.relname,ref.attname) into linked using d.id;
   exit when linked;
  end loop;
  if linked then blocked:=blocked+1;end if;
  total:=total+d.original_amount;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',d.id,'reference',d.external_ref,'debtor',(select name from public.cobranca_debtors where id=d.debtor_id),'amount',d.original_amount,'blocked',linked,'version',d.updated_at));
 end loop;
 token:=encode(sha256(convert_to(rows::text,'UTF8')),'hex');
 if action='debt_delete_preview' then return jsonb_build_object('rows',rows,'count',cardinality(ids),'total',total,'blocked',blocked,'token',token);end if;
 reason:=trim(coalesce(payload->>'reason',''));
 if payload->>'token' is distinct from token then raise exception 'Os títulos mudaram. Gere uma nova prévia';end if;
 if length(reason) not between 10 and 1000 or payload->>'confirmation' is distinct from 'EXCLUIR' then raise exception 'Informe o motivo e digite EXCLUIR para confirmar';end if;
 if blocked>0 then raise exception 'Há títulos com histórico ou vínculos. Nenhum título foi excluído';end if;
 for d in select * from public.cobranca_debts where id=any(ids) and tenant_id=p.tenant_id order by id loop
  perform cobranca_private.audit(p.tenant_id,'bulk_delete','debts',d.id,to_jsonb(d),jsonb_build_object('reason',reason,'batch_token',token));
  delete from public.cobranca_debts where id=d.id and tenant_id=p.tenant_id;
 end loop;
 return jsonb_build_object('deleted',cardinality(ids),'total',total);
end$$;
revoke all on function cobranca_private.debt_batch(text,jsonb) from public,anon;
grant execute on function cobranca_private.debt_batch(text,jsonb) to authenticated;
create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$
 select case
 when action in ('distribute','debt_delete_preview','debt_delete_commit') then cobranca_private.debt_batch(action,payload)
 when action='schedule_config' then cobranca_private.schedule_config(payload)
 when action='crm_tasks' then cobranca_private.schedule_tasks(payload)
 when action like 'company_%' or action like 'bank_%' then cobranca_private.company_bank(action,payload)
 when action in ('bordero_context','bordero_import') then cobranca_private.file_bordero(action,payload)
 when action like 'pricing_%' then cobranca_private.pricing(action,payload)
 when action='detail' then cobranca_private.fee_detail(payload)
 when action like 'chat_%' then cobranca_private.chat(action,payload)
 when action='report' then cobranca_private.reports(payload)
 when action='erp_config' then cobranca_private.erp_config(payload)
 when action like 'fin_%' then cobranca_private.finance(action,payload)
 else cobranca_private.api(action,payload) end
$$;
notify pgrst,'reload schema';
commit;

