begin;
alter table cobranca_private.attendance_messages add column mail_state jsonb not null default '{}'::jsonb check(jsonb_typeof(mail_state)='object');
create function cobranca_private.mail_attendance(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;a cobranca_private.attendance_accounts;t cobranca_private.attendance_threads;m cobranca_private.attendance_messages;item jsonb;batch jsonb:='[]';r jsonb;op text;op_nonce uuid;loc jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;
 if action='mail_claim' then select x.* into a from cobranca_private.attendance_accounts x join cobranca_private.attendance_threads y on y.account_id=x.id where y.id=(payload->>'thread_id')::uuid and y.tenant_id=p.tenant_id;if a.channel='whatsapp' then return cobranca_private.attendance('message_claim',payload);end if;else select * into a from cobranca_private.attendance_accounts where id=(payload->>'account_id')::uuid;end if;
 if not cobranca_private.attendance_allowed(p,a) or a.channel<>'email' then raise exception 'Caixa postal não autorizada';end if;
 if action='mail_sync' then
  if jsonb_typeof(payload->'messages') is distinct from 'array' or jsonb_array_length(payload->'messages')>100 then raise exception 'Lote inválido';end if;
  for item in select value from jsonb_array_elements(payload->'messages') loop
   select * into t from cobranca_private.attendance_threads where account_id=a.id and address=item->>'address' and tenant_id=p.tenant_id;
   if t.id is not null and p.role not in ('admin','master','supervisor','commercial_manager') and t.owner_id is distinct from p.id then continue;end if;
   select * into m from cobranca_private.attendance_messages where thread_id=t.id and tenant_id=p.tenant_id and (provider_id=item->>'provider_id' or mail_state->'location'=item->'mail_location' or (direction=case when item->>'from_me'='true' then 'outbound' else 'inbound' end and nullif(item->>'mail_message_id','') is not null and (provider_id=item->>'mail_message_id' or provider_ref=item->>'mail_message_id' or mail_state->>'message_id'=item->>'mail_message_id'))) order by (mail_state->'location'=item->'mail_location') desc nulls last,(provider_id=item->>'provider_id') desc,created_at limit 1;
   if m.id is not null then item:=jsonb_set(item,'{provider_id}',to_jsonb(m.provider_id));end if;
   perform cobranca_private.attendance('sync',jsonb_build_object('account_id',a.id,'messages',jsonb_build_array(item)));
   select * into t from cobranca_private.attendance_threads where account_id=a.id and address=item->>'address' and tenant_id=p.tenant_id;
   if t.id is null or (p.role not in ('admin','master','supervisor','commercial_manager') and t.owner_id is distinct from p.id) then continue;end if;
   if jsonb_typeof(item->'mail_location')='object' then
    update cobranca_private.attendance_messages set mail_state=(mail_state-'pending'-'pending_nonce'-'pending_at')||jsonb_build_object('local_only',false,'location',item->'mail_location','message_id',item->>'mail_message_id','trashed',coalesce((item->>'mail_trashed')::boolean,false),'original_path',case when item->>'mail_trashed'='true' then coalesce(mail_state->>'original_path',case when direction='outbound' then 'sent' else 'INBOX' end) else item#>>'{mail_location,path}' end) where thread_id=t.id and provider_id=item->>'provider_id' and coalesce(mail_state->>'purged','false')<>'true' and (mail_state->>'pending' is null or nullif(mail_state->>'pending_at','')::timestamptz<now()-interval '90 seconds');
   end if;
  end loop;
  return jsonb_build_object('synced',jsonb_array_length(payload->'messages'));
 elsif action='mail_trash_list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'thread_id',x.thread_id)) from cobranca_private.attendance_messages x join cobranca_private.attendance_threads y on y.id=x.thread_id where y.account_id=a.id and x.tenant_id=p.tenant_id and x.mail_state->>'trashed'='true' and coalesce(x.mail_state->>'purged','false')<>'true' and (p.role in ('admin','master','supervisor','commercial_manager') or y.owner_id=p.id)),'[]');
 end if;
 select * into t from cobranca_private.attendance_threads where id=(payload->>'thread_id')::uuid and account_id=a.id and tenant_id=p.tenant_id;
 if not found or (p.role not in ('admin','master','supervisor','commercial_manager') and t.owner_id is distinct from p.id) then raise exception 'Mensagem não autorizada';end if;
 select * into m from cobranca_private.attendance_messages where id=(payload->>'message_id')::uuid and thread_id=t.id and tenant_id=p.tenant_id for update;
 if not found then raise exception 'Mensagem não encontrada';end if;
 if action='mail_claim' then
  if m.mail_state->>'trashed'='true' or m.mail_state->>'purged'='true' or m.mail_state->>'pending' is not null then raise exception 'Mensagem na lixeira ou com operação pendente';end if;return cobranca_private.attendance('message_claim',payload);
 elsif action='mail_action_begin' then
  op:=payload->>'operation';op_nonce:=(payload->>'nonce')::uuid;
  if op not in ('trash','restore','purge') or op_nonce is null then raise exception 'Operação inválida';end if;
  if m.status='sending' or m.mail_state->>'pending' is not null then raise exception 'Operação pendente. Sincronize antes de tentar novamente';end if;
  if m.mail_state->>'purged'='true' then raise exception 'Mensagem excluída permanentemente';end if;
  if (op='trash' and m.mail_state->>'trashed'='true') or (op in ('restore','purge') and coalesce(m.mail_state->>'trashed','false')<>'true') then raise exception 'Pasta da mensagem alterada. Atualize a lista';end if;
  update cobranca_private.attendance_messages set mail_state=mail_state||jsonb_build_object('pending',op,'pending_nonce',op_nonce,'pending_at',now()) where id=m.id returning * into m;
  return jsonb_build_object('message',to_jsonb(m),'thread',to_jsonb(t));
 elsif action='mail_action_finish' then
  if m.mail_state->>'pending_nonce' is distinct from payload->>'nonce' or m.mail_state->>'pending' is null then raise exception 'Operação já concluída ou inválida';end if;
  if payload->>'uncertain'='true' then return jsonb_build_object('uncertain',true);end if;
  op:=m.mail_state->>'pending';loc:=payload->'location';
  if loc is not null and loc<>'null'::jsonb and (jsonb_typeof(loc)<>'object' or length(coalesce(loc->>'path','')) not between 1 and 200 or coalesce(loc->>'uid','')!~'^[1-9][0-9]*$' or coalesce(loc->>'validity','')!~'^[0-9]+$') then raise exception 'Localização inválida';end if;
  update cobranca_private.attendance_messages set mail_state=(mail_state-'pending'-'pending_nonce'-'pending_at')||jsonb_build_object('trashed',op='trash','purged',op='purge','location',coalesce(loc,mail_state->'location'),'local_only',coalesce((payload->>'local_only')::boolean,false),'original_path',coalesce(mail_state->>'original_path',payload->>'original_path',case when direction='outbound' then 'sent' else 'INBOX' end)),content=case when op='purge' then '[E-mail excluído permanentemente]' else content end,html=case when op='purge' then '' else html end,attachments=case when op='purge' then '[]'::jsonb else attachments end where id=m.id;
  perform cobranca_private.audit(p.tenant_id,'email_'||op,'attendance_messages',m.id,null,jsonb_build_object('account_id',a.id,'thread_id',t.id));
  return jsonb_build_object('done',true);
 end if;
 raise exception 'Operação inválida';
end$$;
revoke all on function cobranca_private.mail_attendance(text,jsonb) from public,anon;
grant execute on function cobranca_private.mail_attendance(text,jsonb) to authenticated;
create or replace function public.cobranca_attendance(action text,payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;
begin
 if action='message_claim' then return cobranca_private.mail_attendance('mail_claim',payload);end if;
 if action in ('mail_sync','mail_trash_list','mail_action_begin','mail_action_finish') then return cobranca_private.mail_attendance(action,payload);end if;
 r:=cobranca_private.attendance(action,payload);
 if action='thread_messages' then r:=jsonb_set(r,'{messages}',coalesce((select jsonb_agg(x) from jsonb_array_elements(r->'messages') x where coalesce(x#>>'{mail_state,purged}','false')<>'true'),'[]'));end if;
 return r;
end$$;
revoke all on function public.cobranca_attendance(text,jsonb) from public,anon;
grant execute on function public.cobranca_attendance(text,jsonb) to authenticated;
commit;
