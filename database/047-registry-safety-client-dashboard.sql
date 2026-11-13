-- Additive safeguards for debtor identity and controlled registry cleanup.
-- Existing duplicate records are NEVER automatically merged, moved or deleted.
begin;

create or replace function cobranca_private.prevent_duplicate_debtor()
returns trigger language plpgsql set search_path='' as $$
declare candidate public.cobranca_debtors; normalized_doc text; normalized_name text; external_code text;
begin
 if new.creditor_id is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':'||new.creditor_id::text, 20261110));
 normalized_doc:=nullif(regexp_replace(coalesce(new.document,''),'[^0-9]','','g'),'');
 normalized_name:=lower(regexp_replace(trim(coalesce(new.name,'')),'[[:space:]]+',' ','g'));
 external_code:=nullif(trim(coalesce(new.metadata->>'external_debtor_code','')),'');
 select b.* into candidate from public.cobranca_debtors b
 where b.tenant_id=new.tenant_id and b.creditor_id=new.creditor_id and b.id<>new.id and (
  (normalized_doc is not null and nullif(regexp_replace(coalesce(b.document,''),'[^0-9]','','g'),'')=normalized_doc)
  or (external_code is not null and nullif(trim(coalesce(b.metadata->>'external_debtor_code','')),'')=external_code)
  or (normalized_name<>'' and lower(regexp_replace(trim(coalesce(b.name,'')),'[[:space:]]+',' ','g'))=normalized_name
     and (normalized_doc is null or nullif(regexp_replace(coalesce(b.document,''),'[^0-9]','','g'),'') is null))
 ) order by b.created_at,b.id limit 1;
 if found then
  raise exception 'Devedor possivelmente duplicado (%). Consulte o cadastro existente e seus títulos antes de continuar.',candidate.id
    using errcode='23505',hint='Não crie nem exclua automaticamente devedores. Confira vínculos e identidade.';
 end if;
 return new;
end $$;
revoke all on function cobranca_private.prevent_duplicate_debtor() from public,anon,authenticated;
drop trigger if exists cobranca_prevent_duplicate_debtor on public.cobranca_debtors;
create trigger cobranca_prevent_duplicate_debtor before insert or update of creditor_id,name,document,metadata
on public.cobranca_debtors for each row execute function cobranca_private.prevent_duplicate_debtor();

create or replace function cobranca_private.registry_safety(action text,payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles; target_id uuid; entity text; record_data jsonb;
 owner_id uuid; entity_name text; blocked boolean:=false; refs jsonb:='[]'::jsonb;
 fk record; has_link boolean; reason text; fingerprint text; incoming text; 
 chosen_table regclass;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso negado';end if;
 if action='creditor_dashboard' then
  if p.role='creditor' then
   if not coalesce((p.client_access->>'processes')::boolean,false) then raise exception 'Consulta não autorizada';end if;
   owner_id:=p.creditor_id;
  elsif p.role in ('admin','master','supervisor') then
   owner_id:=nullif(payload->>'creditor_id','')::uuid;
  else raise exception 'Permissão insuficiente';end if;
  if owner_id is null or not exists(select 1 from public.cobranca_creditors where id=owner_id and tenant_id=p.tenant_id) then raise exception 'Credor não encontrado';end if;
  return jsonb_build_object(
   'creditor_id',owner_id,
   'titles_total',(select count(*) from public.cobranca_debts d where d.tenant_id=p.tenant_id and d.creditor_id=owner_id),
   'titles_open',(select count(*) from public.cobranca_debts d where d.tenant_id=p.tenant_id and d.creditor_id=owner_id and d.current_amount>0),
   'outstanding',(select coalesce(sum(d.current_amount),0) from public.cobranca_debts d where d.tenant_id=p.tenant_id and d.creditor_id=owner_id),
   'contacts_total',case when p.role<>'creditor' or coalesce((p.client_access->>'history')::boolean,false) then
    (select count(*) from public.cobranca_interaction_logs l where l.tenant_id=p.tenant_id and l.creditor_id=owner_id)
    else null end,
   'titles_contacted',case when p.role<>'creditor' or coalesce((p.client_access->>'history')::boolean,false) then
    (select count(distinct l.debt_id) from public.cobranca_interaction_logs l where l.tenant_id=p.tenant_id and l.creditor_id=owner_id)
    else null end,
   'titles_negotiated',(select count(distinct a.debt_id) from public.cobranca_agreements a join public.cobranca_debts d on d.id=a.debt_id where a.tenant_id=p.tenant_id and d.creditor_id=owner_id),
   'agreements_active',(select count(*) from public.cobranca_agreements a join public.cobranca_debts d on d.id=a.debt_id where a.tenant_id=p.tenant_id and d.creditor_id=owner_id and a.status='active')
  );
 end if;
 if p.role not in ('admin','master') then raise exception 'Ação exclusiva do administrador';end if;
 if action='duplicate_debtors' then
  return jsonb_build_object('rows',coalesce((
   select jsonb_agg(to_jsonb(q)) from (
    select b.creditor_id,lower(regexp_replace(trim(b.name),'[[:space:]]+',' ','g')) as normalized_name,
     count(*) as duplicates,
     jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'document',b.document,'email',b.email,
       'titles',(select count(*) from public.cobranca_debts d where d.tenant_id=p.tenant_id and d.debtor_id=b.id)) order by b.created_at) as records
    from public.cobranca_debtors b where b.tenant_id=p.tenant_id
    group by b.creditor_id,lower(regexp_replace(trim(b.name),'[[:space:]]+',' ','g')) having count(*)>1
   ) q
  ),'[]'::jsonb));
 end if;
 if action not in ('registry_delete_preview','registry_delete_commit') then raise exception 'Operação inválida';end if;
 entity:=payload->>'entity';
 if entity='debtors' then chosen_table:='public.cobranca_debtors'::regclass;
 elsif entity='creditors' then chosen_table:='public.cobranca_creditors'::regclass;
 else raise exception 'Exclusão permitida somente para cadastros de devedor ou credor. Empresas com dados financeiros exigem procedimento específico.';end if;
 target_id:=nullif(payload->>'id','')::uuid;
 if target_id is null then raise exception 'Selecione um registro';end if;
 -- Lock selected row. Never delete another tenant's data.
 execute format('select to_jsonb(x) from %s x where x.id=$1 and x.tenant_id=$2 for update',chosen_table)
 into record_data using target_id,p.tenant_id;
 if record_data is null then raise exception 'Registro não encontrado';end if;
 entity_name:=record_data->>'name';
 for fk in
  select n.nspname as schema_name, t.relname as table_name, a.attname as column_name,
    array_length(k.conkey,1) as key_count, array_length(k.confkey,1) as referenced_count
  from pg_catalog.pg_constraint k
  join pg_catalog.pg_class t on t.oid=k.conrelid
  join pg_catalog.pg_namespace n on n.oid=t.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
  where k.contype='f' and k.confrelid=chosen_table
 loop
  if fk.key_count<>1 or fk.referenced_count<>1 then
   blocked:=true;
   refs:=refs||jsonb_build_array(jsonb_build_object('table',fk.table_name,'reason','Chave composta requer análise'));
  else
   execute format('select exists(select 1 from %I.%I where %I=$1)',fk.schema_name,fk.table_name,fk.column_name) into has_link using target_id;
   if has_link then
    blocked:=true;refs:=refs||jsonb_build_array(jsonb_build_object('table',fk.table_name,'reason','Há vínculos'));
   end if;
  end if;
 end loop;
 fingerprint:=encode(sha256(convert_to(record_data::text||refs::text,'UTF8')),'hex');
 if action='registry_delete_preview' then
  return jsonb_build_object('id',target_id,'entity',entity,'name',entity_name,'blocked',blocked,'dependencies',refs,'token',fingerprint);
 end if;
 if blocked then raise exception 'Registro possui vínculos e não pode ser excluído. Preserve os títulos e históricos.';end if;
 if payload->>'token' is distinct from fingerprint or payload->>'confirmation' is distinct from 'EXCLUIR' then raise exception 'Prévia desatualizada ou confirmação inválida';end if;
 reason:=trim(coalesce(payload->>'reason',''));
 if length(reason) not between 10 and 1000 then raise exception 'Motivo da exclusão deve ter entre 10 e 1000 caracteres';end if;
 perform cobranca_private.audit(p.tenant_id,'registry_delete',entity,target_id,record_data,jsonb_build_object('reason',reason,'name',entity_name));
 execute format('delete from %s where id=$1 and tenant_id=$2',chosen_table) using target_id,p.tenant_id;
 return jsonb_build_object('deleted',true,'entity',entity,'id',target_id);
end $$;
revoke all on function cobranca_private.registry_safety(text,jsonb) from public,anon;
grant execute on function cobranca_private.registry_safety(text,jsonb) to authenticated;

-- Preserve existing application routes by delegating new ones only.
create or replace function public.cobranca_app(action text,payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
 select case
 when action in ('creditor_dashboard','duplicate_debtors','registry_delete_preview','registry_delete_commit')
  then cobranca_private.registry_safety(action,payload)
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
