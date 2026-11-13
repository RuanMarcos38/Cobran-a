-- API bidirectional event ingestion for an already-authorized creditor connection.
-- Does NOT send calls/messages or create an agreement. Only records verified external events.
begin;
set local lock_timeout='5s';
create table if not exists cobranca_private.integration_contact_events(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.cobranca_tenants(id),
 connection_id uuid not null references cobranca_private.creditor_connections(id),
 external_id text not null,
 payload_hash text not null,
 interaction_id uuid not null references public.cobranca_interaction_logs(id),
 created_at timestamptz not null default now(),
 unique(connection_id,external_id)
);
alter table cobranca_private.integration_contact_events enable row level security;
revoke all on cobranca_private.integration_contact_events from public,anon,authenticated;
drop policy if exists deny_direct on cobranca_private.integration_contact_events;
create policy deny_direct on cobranca_private.integration_contact_events to anon,authenticated using(false) with check(false);

create or replace function cobranca_private.integration_contact_event(token text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c cobranca_private.creditor_connections; d public.cobranca_debts;
 previous cobranca_private.integration_contact_events;ident uuid;event_key text;digest text;
 channel_name text;direction_name text;status_name text;subject_text text;body_text text;ref text;
begin
 if length(coalesce(token,''))<>64 then raise exception 'Credencial inválida' using errcode='28000';end if;
 if octet_length(payload::text)>50000 or jsonb_typeof(payload)<>'object' then raise exception 'Evento inválido';end if;
 select * into c from cobranca_private.creditor_connections
 where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and active
 for update;
 if not found or not exists(select 1 from public.cobranca_tenants where id=c.tenant_id and active)
 then raise exception 'Credencial inválida' using errcode='28000';end if;
 event_key:=trim(coalesce(payload->>'external_id',''));
 channel_name:=payload->>'channel';direction_name:=payload->>'direction';status_name:=coalesce(payload->>'status','registered');
 subject_text:=left(trim(coalesce(payload->>'subject','')),250);
 body_text:=trim(coalesce(payload->>'content',''));
 ref:=nullif(trim(coalesce(payload->>'provider_message_id','')),'');
 if length(event_key) not between 1 and 160 or event_key !~ '^[A-Za-z0-9._:-]+$'
  or channel_name not in ('voice','whatsapp','email','human')
  or direction_name not in ('inbound','outbound','internal')
  or status_name not in ('registered','sent','failed','blocked','escalated')
  or length(body_text) not between 1 and 10000
  or length(ref)>250 then raise exception 'Campos do evento inválidos';end if;
 select * into d from public.cobranca_debts
 where id=nullif(payload->>'debt_id','')::uuid and tenant_id=c.tenant_id and creditor_id=c.creditor_id;
 if not found then raise exception 'Título não pertence à carteira conectada';end if;
 -- Commit at most one event per key. Repeated requests with different payload are rejected.
 digest:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
 select * into previous from cobranca_private.integration_contact_events
 where connection_id=c.id and external_id=event_key;
 if found then
  if previous.payload_hash<>digest then raise exception 'Identificador de evento já usado com conteúdo diferente';end if;
  return jsonb_build_object('saved',true,'duplicate',true,'id',previous.interaction_id);
 end if;
 insert into public.cobranca_interaction_logs(
  tenant_id,creditor_id,debtor_id,debt_id,channel,direction,status,subject,content,provider_message_id,payload
 ) values(c.tenant_id,c.creditor_id,d.debtor_id,d.id,channel_name,direction_name,status_name,subject_text,body_text,ref,
  jsonb_build_object('source','connected_api','external_id',event_key,'connection_id',c.id))
 returning id into ident;
 insert into cobranca_private.integration_contact_events(tenant_id,connection_id,external_id,payload_hash,interaction_id)
 values(c.tenant_id,c.id,event_key,digest,ident);
 return jsonb_build_object('saved',true,'duplicate',false,'id',ident);
end$$;
revoke all on function cobranca_private.integration_contact_event(text,jsonb) from public,anon,authenticated;
create or replace function public.cobranca_contact_event(token text,payload jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select cobranca_private.integration_contact_event(token,payload)
$$;
revoke all on function public.cobranca_contact_event(text,jsonb) from public;
grant execute on function public.cobranca_contact_event(text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
