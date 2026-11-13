-- Additive attendance: authorization is checked for every message and download.
alter table cobranca_private.crm_activities add column client_nonce uuid, add column delivery_state text not null default 'internal' check(delivery_state in ('internal','sending','accepted','unknown')), add column provider_id text, add column delivery_claim uuid;
create unique index crm_activity_nonce on cobranca_private.crm_activities(opportunity_id,client_nonce) where client_nonce is not null;
create table cobranca_private.chat_attachments (
 id uuid primary key default gen_random_uuid(),activity_id uuid not null unique references cobranca_private.crm_activities(id),
 name text not null,mime text not null,bytes bytea not null check(octet_length(bytes) between 1 and 5242880)
);
alter table cobranca_private.chat_attachments enable row level security;
create policy deny_raw_chat on cobranca_private.chat_attachments for all to anon,authenticated using(false) with check(false);
revoke all on cobranca_private.chat_attachments from public,anon,authenticated;
create function cobranca_private.chat(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;o cobranca_private.crm_opportunities;ident uuid;attachment jsonb;raw bytea;mime text;filename text;result jsonb;nonce uuid;m cobranca_private.crm_activities;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','commercial','commercial_manager') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Atendimento não autorizado';end if;
 select * into o from cobranca_private.crm_opportunities where id=(payload->>'id')::uuid and tenant_id=p.tenant_id and (p.role in ('admin','master','commercial_manager') or owner_id=p.id);
 if not found then raise exception 'Oportunidade não encontrada';end if;
 if action='chat_download' then
  select jsonb_build_object('name',a.name,'mime',a.mime,'base64',encode(a.bytes,'base64')) into result from cobranca_private.chat_attachments a join cobranca_private.crm_activities c on c.id=a.activity_id where a.id=(payload->>'attachment_id')::uuid and c.opportunity_id=o.id and c.tenant_id=p.tenant_id;
  if result is null then raise exception 'Anexo não encontrado';end if;return result;
 elsif action='chat_send' then
  nonce:=(payload->>'nonce')::uuid;if nonce is null then raise exception 'Identificador da mensagem obrigatório';end if;
  -- Opportunity lock makes retries idempotent, including the attachment.
  perform 1 from cobranca_private.crm_opportunities where id=o.id for update;
  select id into ident from cobranca_private.crm_activities where opportunity_id=o.id and client_nonce=nonce;
  if ident is null then
   attachment:=payload->'attachment';
   if length(coalesce(payload->>'content',''))>10000 or (length(trim(coalesce(payload->>'content','')))=0 and (attachment is null or attachment='null'::jsonb)) then raise exception 'Escreva uma mensagem ou selecione um anexo';end if;
   if attachment is not null and attachment<>'null'::jsonb then
    if length(coalesce(attachment->>'base64','')) not between 4 and 6990508 or (attachment->>'base64') !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception 'Anexo inválido ou maior que 5 MB';end if;
    raw:=decode(attachment->>'base64','base64');mime:=attachment->>'mime';filename:=attachment->>'name';
    if octet_length(raw) not between 1 and 5242880 or length(filename) not between 1 and 200 or filename ~ '[[:cntrl:]/\\]' then raise exception 'Arquivo inválido';end if;
    if not (
     (mime='application/pdf' and filename ~* '\.pdf$' and substring(raw,1,5)=decode('255044462d','hex')) or
     (mime='image/png' and filename ~* '\.png$' and substring(raw,1,8)=decode('89504e470d0a1a0a','hex')) or
     (mime='image/jpeg' and filename ~* '\.jpe?g$' and substring(raw,1,3)=decode('ffd8ff','hex')) or
     (mime in ('text/plain','text/csv') and filename ~* '\.(txt|csv)$' and position(decode('00','hex') in raw)=0) or
     (mime='audio/webm' and filename ~* '\.webm$' and substring(raw,1,4)=decode('1a45dfa3','hex')) or
     (mime='audio/ogg' and filename ~* '\.(ogg|opus)$' and substring(raw,1,4)=decode('4f676753','hex')) or
     (mime='audio/wav' and filename ~* '\.wav$' and substring(raw,1,4)=decode('52494646','hex') and substring(raw,9,4)=decode('57415645','hex')) or
     (mime='audio/mpeg' and filename ~* '\.mp3$' and (substring(raw,1,3)=decode('494433','hex') or (octet_length(raw)>2 and get_byte(raw,0)=255 and (get_byte(raw,1)&224)=224)))
    ) then raise exception 'Formato ou conteúdo de arquivo não permitido';end if;
   end if;
   insert into cobranca_private.crm_activities(tenant_id,opportunity_id,actor,subject,content,channel,client_nonce) values(p.tenant_id,o.id,p.id,'Mensagem',coalesce(payload->>'content',''),'Nota',nonce) returning id into ident;
   if raw is not null then insert into cobranca_private.chat_attachments(activity_id,name,mime,bytes) values(ident,filename,mime,raw);end if;
   perform cobranca_private.audit(p.tenant_id,'chat_send','crm_activities',ident,null,jsonb_build_object('opportunity_id',o.id,'attachment_name',filename));
  end if;

 elsif action in ('chat_claim','chat_delivery') then
  select * into m from cobranca_private.crm_activities where id=(payload->>'message_id')::uuid and opportunity_id=o.id and tenant_id=p.tenant_id for update;
  if not found or m.client_nonce is null then raise exception 'Mensagem não encontrada';end if;
  if action='chat_claim' then
   if m.delivery_state='accepted' then return jsonb_build_object('already',true,'provider_id',m.provider_id);end if;
   if m.delivery_state<>'internal' then raise exception 'Envio em andamento ou sem confirmação. Confira na Evolution antes de reenviar';end if;
   nonce:=gen_random_uuid();update cobranca_private.crm_activities set delivery_state='sending',delivery_claim=nonce where id=m.id;
   select jsonb_build_object('name',a.name,'mime',a.mime,'base64',encode(a.bytes,'base64')) into attachment from cobranca_private.chat_attachments a where a.activity_id=m.id;
   return jsonb_build_object('claim',nonce,'phone',o.phone,'content',m.content,'attachment',attachment);
  else
   if m.delivery_state<>'sending' or m.delivery_claim is distinct from (payload->>'claim')::uuid or payload->>'status' not in ('accepted','unknown') or (payload->>'status'='accepted' and length(coalesce(payload->>'provider_id','')) not between 1 and 200) then raise exception 'Confirmação inválida';end if;
   update cobranca_private.crm_activities set delivery_state=payload->>'status',provider_id=payload->>'provider_id' where id=m.id;
   perform cobranca_private.audit(p.tenant_id,'chat_delivery','crm_activities',m.id,null,jsonb_build_object('state',payload->>'status','provider_id',payload->>'provider_id'));return jsonb_build_object('ok',true);
  end if;
 elsif action<>'chat_list' then raise exception 'Operação de atendimento inválida';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') into result from (
  select c.id,c.subject,c.content,c.channel,c.created_at,c.actor,c.client_nonce,c.delivery_state,c.provider_id,pr.name as actor_name,
   case when a.id is null then null else jsonb_build_object('id',a.id,'name',a.name,'mime',a.mime,'size',octet_length(a.bytes)) end as attachment
  from cobranca_private.crm_activities c join public.cobranca_profiles pr on pr.id=c.actor left join cobranca_private.chat_attachments a on a.activity_id=c.id
  where c.opportunity_id=o.id and c.tenant_id=p.tenant_id and (nullif(payload->>'before','') is null or (c.created_at,c.id)<((payload->>'before')::timestamptz,coalesce(nullif(payload->>'before_id','')::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))) order by c.created_at desc,c.id desc limit 100
 ) x;
 return jsonb_build_object('rows',result,'opportunity',jsonb_build_object('id',o.id,'name',o.name,'phone',o.phone),'internal',true);
end$$;
revoke all on function cobranca_private.chat(text,jsonb) from public,anon;
grant execute on function cobranca_private.chat(text,jsonb) to authenticated;

-- Reuse the existing report authorization, metrics and receipt/history behavior.
create function cobranca_private.reports(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;p public.cobranca_profiles;rows jsonb;f jsonb:=coalesce(payload->'filters','{}');kind text:=payload->>'report';
begin
 if nullif(f->>'start','')::date>nullif(f->>'end','')::date then raise exception 'A data inicial deve ser anterior à data final';end if;
 if kind not in ('Painel gerencial','Financeiro','Títulos Cadastrados','Títulos Captados','Processos do Cliente — Totais','Histórico do Processo','E-mail de Clientes','Clientes Inativos','Análise Gerencial','Recebimentos','Consulta de Recebimentos','Honorários e Repasses') then raise exception 'Relatório inválido';end if;
 result:=cobranca_private.api('report',payload);
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if kind='Títulos Captados' then
  select coalesce(jsonb_agg(jsonb_build_object('processo',d.external_ref,'cliente',d.creditor_name,'devedor',d.debtor_name,'saldo',d.current_amount,'situacao',d.app_status,'bordero',raw.metadata->>'bordero_id') order by d.created_at desc),'[]') into rows from cobranca_private.process_list d join public.cobranca_debts raw on raw.id=d.id where cobranca_private.can_read_debt(p,raw) and cobranca_private.matches(d,f) and raw.metadata ? 'connection_id';
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
create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select case when action like 'chat_%' then cobranca_private.chat(action,payload) when action='report' then cobranca_private.reports(payload) when action='erp_config' then cobranca_private.erp_config(payload) when action like 'fin_%' then cobranca_private.finance(action,payload) else cobranca_private.api(action,payload) end$$;
