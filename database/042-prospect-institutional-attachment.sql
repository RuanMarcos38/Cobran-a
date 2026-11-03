begin;
-- Only a newly acknowledged send may gain this attachment record. Historical sends are unchanged.
alter function cobranca_private.prospect_receive(text,jsonb) rename to prospect_receive_before_attachment;
create function cobranca_private.prospect_receive(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;attachment jsonb;attempt cobranca_private.prospect_attempts;connection cobranca_private.prospect_connections;already_finished boolean;
begin
 if payload->>'operation'='finish' and payload->>'status'='accepted' and payload ? 'attachments' then
  perform cobranca_private.prospect_receive_before_attachment(token,jsonb_build_object('operation','health'));
  select * into connection from cobranca_private.prospect_connections where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
  select * into attempt from cobranca_private.prospect_attempts where id=(payload->>'attempt_id')::uuid and tenant_id=connection.tenant_id for update;
  if attempt.id is null then raise exception 'Reserva de envio inválida';end if;
  already_finished:=attempt.status='accepted';
  if jsonb_typeof(payload->'attachments')<>'array' or jsonb_array_length(payload->'attachments')<>1 then raise exception 'Anexo institucional inválido';end if;
  attachment:=payload->'attachments'->0;
  if attachment->>'asset' is distinct from 'rr-institutional-v1' or attachment->>'name' is distinct from 'Institucional RR.pdf' or attachment->>'mime' is distinct from 'application/pdf' or attachment->>'size' is distinct from '354506' or attachment->>'sha256' is distinct from 'b85c9d394271baaa90da6e5728068fae8b98fd818b4bc3a8efd5f20fb542f193' or not exists(select 1 from cobranca_private.attendance_accounts where id=connection.account_id and tenant_id=connection.tenant_id and address='contato@rrestrategiaperformance.com.br' and sector='commercial' and channel='email') then raise exception 'Anexo institucional inválido';end if;
 end if;
 result:=cobranca_private.prospect_receive_before_attachment(token,payload);
 if attachment is not null and not already_finished then
  update cobranca_private.attendance_messages m set attachments=jsonb_build_array(jsonb_build_object('index',0,'name',attachment->>'name','mime',attachment->>'mime','size',354506,'asset',attachment->>'asset','sha256',attachment->>'sha256'))
  where m.tenant_id=connection.tenant_id and m.provider_id=payload->>'provider_id' and m.direction='outbound' and m.status='accepted' and exists(select 1 from cobranca_private.attendance_threads t where t.id=m.thread_id and t.account_id=connection.account_id);
  if not found then raise exception 'Registro do envio confirmado não encontrado';end if;
 end if;
 return result;
end$$;
revoke all on function cobranca_private.prospect_receive_before_attachment(text,jsonb) from public,anon,authenticated;
revoke all on function cobranca_private.prospect_receive(text,jsonb) from public;
grant execute on function cobranca_private.prospect_receive(text,jsonb) to anon,authenticated;
create or replace function public.cobranca_prospect_sync(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.prospect_receive(token,payload)$$;
notify pgrst,'reload schema';
commit;
