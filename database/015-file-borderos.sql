-- Additive manual import; no integration tokens, secrets or existing data changed.
begin;
create function cobranca_private.file_bordero(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;c public.cobranca_creditors;b public.cobranca_debtors;d public.cobranca_debts;
 item jsonb;result jsonb:='[]';created_count int:=0;duplicate_count int:=0;amount numeric;assigned uuid;ident uuid;
 doc text;code text;external text;source_hash text;terms jsonb;batch uuid:=gen_random_uuid();
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','supervisor') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Perfil de gestão necessário';end if;
 -- Serialize all file imports for a creditor, including files with different hashes.
 select * into c from public.cobranca_creditors where id=(payload->>'creditor_id')::uuid and tenant_id=p.tenant_id and active for update;
 if not found then raise exception 'Credor inválido';end if;
 if action='bordero_context' then return jsonb_build_object('id',c.id,'name',c.name,'document',c.document);end if;
 if action<>'bordero_import' then raise exception 'Operação inválida';end if;
 if octet_length(payload::text)>2097152 or jsonb_typeof(payload->'rows') is distinct from 'array' then raise exception 'Borderô inválido ou maior que 2 MB';end if;
 if jsonb_array_length(payload->'rows') not between 1 and 1000 then raise exception 'Informe de 1 a 1.000 títulos';end if;
 source_hash:=payload->>'file_hash';if source_hash is null or source_hash !~ '^[a-f0-9]{64}$' or length(coalesce(payload->>'file_name','')) not between 1 and 200 then raise exception 'Identificação de arquivo inválida';end if;
 select id into assigned from public.cobranca_profiles where tenant_id=p.tenant_id and active and role='collector' order by id limit 1;
 if assigned is null then raise exception 'Cadastre um negociador antes de importar borderôs';end if;
 terms:=jsonb_build_object('mode',coalesce(c.metadata->>'financial_mode','none'),'interest_percent',coalesce((c.metadata->>'default_interest')::numeric,0),'fine_percent',coalesce((c.metadata->>'default_fine')::numeric,0),'grace_days',coalesce((c.metadata->>'grace_days')::int,0));
 for item in select value from jsonb_array_elements(payload->'rows') loop
  external:=trim(coalesce(item->>'external_ref',''));amount:=nullif(item->>'original_amount','')::numeric;
  doc:=nullif(regexp_replace(coalesce(item->>'debtor_document',''),'[^0-9]','','g'),'');code:=nullif(trim(item->>'debtor_code'),'');
  if length(external) not between 1 and 200 or length(trim(coalesce(item->>'debtor_name',''))) not between 1 and 250 or (doc is null and code is null) or (doc is not null and length(doc) not in (11,14)) or length(coalesce(code,''))>200 or amount is null or amount not between 0.01 and 999999999999.99 or amount<>round(amount,2) or nullif(item->>'due_date','')::date is null then raise exception 'Título inválido: %',external;end if;
  if nullif(item->>'creditor_document','') is not null and regexp_replace(item->>'creditor_document','[^0-9]','','g') is distinct from regexp_replace(coalesce(c.document,''),'[^0-9]','','g') then raise exception 'CNPJ do arquivo difere do credor selecionado';end if;
  if nullif(trim(item->>'creditor_name'),'') is not null and lower(regexp_replace(item->>'creditor_name','[[:space:]]','','g'))<>lower(regexp_replace(c.name,'[[:space:]]','','g')) then raise exception 'Nome do credor no arquivo difere da carteira selecionada';end if;
  if nullif(item->>'debtor_email','') is not null and (length(item->>'debtor_email')>254 or item->>'debtor_email' !~ '^[^ @]+@[^ @]+\.[^ @]+$') then raise exception 'E-mail inválido';end if;
  if nullif(item->>'debtor_phone','') is not null and item->>'debtor_phone' !~ '^55[0-9]{10,11}$' then raise exception 'Telefone inválido';end if;
  if (select count(*) from public.cobranca_debtors where tenant_id=p.tenant_id and creditor_id=c.id and ((doc is not null and regexp_replace(coalesce(document,''),'[^0-9]','','g')=doc) or (code is not null and metadata->>'external_debtor_code'=code)))>1 then raise exception 'Documento ou código aponta para mais de um devedor: %',external;end if;
  select * into b from public.cobranca_debtors where tenant_id=p.tenant_id and creditor_id=c.id and ((doc is not null and regexp_replace(coalesce(document,''),'[^0-9]','','g')=doc) or (code is not null and metadata->>'external_debtor_code'=code)) order by created_at limit 1;
  if found and ((doc is not null and nullif(b.document,'') is not null and regexp_replace(b.document,'[^0-9]','','g')<>doc) or (code is not null and nullif(b.metadata->>'external_debtor_code','') is not null and b.metadata->>'external_debtor_code'<>code) or lower(regexp_replace(coalesce(b.name,''),'[[:space:]]','','g'))<>lower(regexp_replace(item->>'debtor_name','[[:space:]]','','g'))) then raise exception 'Identidade do devedor divergente: %',external;end if;
  select * into d from public.cobranca_debts where tenant_id=p.tenant_id and creditor_id=c.id and external_ref=external;
  if found then
   if b.id is null or d.debtor_id<>b.id or d.original_amount<>amount or d.due_date<>(item->>'due_date')::date then raise exception 'Título já existe com dados diferentes: %',external;end if;
   duplicate_count:=duplicate_count+1;result:=result||jsonb_build_array(jsonb_build_object('id',d.id,'external_ref',external,'duplicate',true));continue;
  end if;
  if b.id is null then
   insert into public.cobranca_debtors(tenant_id,creditor_id,name,document,email,phone,metadata)
   values(p.tenant_id,c.id,item->>'debtor_name',doc,item->>'debtor_email',item->>'debtor_phone',jsonb_build_object('external_debtor_code',code,'address',item->>'address','district',item->>'district','city',item->>'city','state',item->>'state','zip',item->>'zip','import_source',item->>'source')) returning * into b;
  else
   -- Fill missing contact/address data; never overwrite existing details or restrictions.
   update public.cobranca_debtors set document=coalesce(nullif(document,''),doc),email=coalesce(nullif(email,''),nullif(item->>'debtor_email','')),phone=coalesce(nullif(phone,''),nullif(item->>'debtor_phone','')),
    metadata=jsonb_strip_nulls(jsonb_build_object('external_debtor_code',code,'address',item->>'address','district',item->>'district','city',item->>'city','state',item->>'state','zip',item->>'zip'))||metadata
   where id=b.id;
  end if;
  -- Reuse the existing validation, assignment trigger and financial contract rules.
  d:=null;
  select (j->>'id')::uuid into ident from (select cobranca_private.api('new_process',
   item||terms||jsonb_build_object('creditor_id',c.id,'debtor_id',b.id,'assigned_to',assigned,'contract_ref',payload->>'contract_ref','external_ref',external,'original_amount',amount)) j) q;
  update public.cobranca_debts set invoice_ref=coalesce(item->>'invoice_ref',item->'raw'->>'external_ref'),description=item->>'notes',
   metadata=metadata||jsonb_build_object('file_bordero',true,'bordero_id',batch,'file_hash',source_hash,'file_name',payload->>'file_name','source_row',item->>'source','original_fields',item->'raw') where id=ident;
  created_count:=created_count+1;result:=result||jsonb_build_array(jsonb_build_object('id',ident,'external_ref',external,'duplicate',false));
 end loop;
 perform cobranca_private.audit(p.tenant_id,'bordero_import','creditors',c.id,null,jsonb_build_object('batch_id',batch,'file_name',payload->>'file_name','file_hash',source_hash,'created',created_count,'duplicates',duplicate_count));
 return jsonb_build_object('batch_id',batch,'created',created_count,'duplicates',duplicate_count,'items',result);
end$$;
revoke all on function cobranca_private.file_bordero(text,jsonb) from public,anon;
grant execute on function cobranca_private.file_bordero(text,jsonb) to authenticated;
create or replace function cobranca_private.reports(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;p public.cobranca_profiles;rows jsonb;f jsonb:=coalesce(payload->'filters','{}');kind text:=payload->>'report';
begin
 if nullif(f->>'start','')::date>nullif(f->>'end','')::date then raise exception 'A data inicial deve ser anterior à data final';end if;
 if kind not in ('Painel gerencial','Financeiro','Títulos Cadastrados','Títulos Captados','Processos do Cliente — Totais','Histórico do Processo','E-mail de Clientes','Clientes Inativos','Análise Gerencial','Recebimentos','Consulta de Recebimentos','Honorários e Repasses') then raise exception 'Relatório inválido';end if;
 result:=cobranca_private.api('report',payload);
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if kind='Títulos Captados' then
  select coalesce(jsonb_agg(jsonb_build_object('processo',d.external_ref,'cliente',d.creditor_name,'devedor',d.debtor_name,'saldo',d.current_amount,'situacao',d.app_status,'bordero',raw.metadata->>'bordero_id') order by d.created_at desc),'[]') into rows from cobranca_private.process_list d join public.cobranca_debts raw on raw.id=d.id where cobranca_private.can_read_debt(p,raw) and cobranca_private.matches(d,f) and (raw.metadata ? 'connection_id' or raw.metadata @> '{"file_bordero":true}'::jsonb);
 elsif kind='Análise Gerencial' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.situacao),'[]') into rows from (select d.app_status as situacao,count(*) as processos,coalesce(sum(d.original_amount),0) as valor_original,coalesce(sum(d.current_amount),0) as saldo from cobranca_private.process_list d join public.cobranca_debts raw on raw.id=d.id where cobranca_private.can_read_debt(p,raw) and cobranca_private.matches(d,f) group by d.app_status) x;
 elsif kind in ('E-mail de Clientes','Clientes Inativos') then
  select coalesce(jsonb_agg(jsonb_build_object('nome',c.name,'email',c.email,'ativo',c.active) order by c.name),'[]') into rows from public.cobranca_creditors c where c.tenant_id=p.tenant_id and (p.role<>'creditor' or c.id=p.creditor_id) and (kind<>'Clientes Inativos' or not c.active) and (nullif(f->>'start','') is null or c.created_at::date>=(f->>'start')::date) and (nullif(f->>'end','') is null or c.created_at::date<=(f->>'end')::date);
 end if;
 if rows is not null then result:=jsonb_set(result,'{rows}',rows);end if;
 return result;
end$$;
revoke all on function cobranca_private.reports(jsonb) from public,anon;
grant execute on function cobranca_private.reports(jsonb) to authenticated;

create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select case when action in ('bordero_context','bordero_import') then cobranca_private.file_bordero(action,payload) when action like 'chat_%' then cobranca_private.chat(action,payload) when action='report' then cobranca_private.reports(payload) when action='erp_config' then cobranca_private.erp_config(payload) when action like 'fin_%' then cobranca_private.finance(action,payload) else cobranca_private.api(action,payload) end$$;
commit;
