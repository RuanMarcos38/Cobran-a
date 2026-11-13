begin;
alter table cobranca_private.prospect_connections add column daily_limit integer not null default 20 check(daily_limit between 1 and 90);
alter table cobranca_private.prospect_connections add column provider_daily_limit integer check(provider_daily_limit>0);
alter table cobranca_private.prospect_connections add column provider_limit_checked_at timestamptz;

create function cobranca_private.prospect_contact_time(value text) returns timestamptz language plpgsql stable set search_path='' as $$
begin return nullif(trim(value),'')::timestamptz;exception when invalid_datetime_format or datetime_field_overflow then return null;end$$;
revoke all on function cobranca_private.prospect_contact_time(text) from public,anon,authenticated;

create function cobranca_private.prospect_capacity(tenant uuid) returns jsonb language sql stable set search_path='' as $$
 with connection as (select * from cobranca_private.prospect_connections where tenant_id=tenant),
 events as (
  select coalesce(a.provider_id,'attempt:'||a.id::text) event_key,a.claimed_at event_at from cobranca_private.prospect_attempts a where a.tenant_id=tenant and a.claimed_at>now()-interval '24 hours'
  union all
  select m.provider_id,m.created_at from cobranca_private.attendance_messages m join cobranca_private.attendance_threads t on t.id=m.thread_id join connection c on c.account_id=t.account_id
   where m.tenant_id=tenant and m.direction='outbound' and m.status in ('accepted','received') and m.created_at>now()-interval '24 hours' and not exists(select 1 from cobranca_private.prospect_attempts a where a.tenant_id=tenant and a.provider_id=m.provider_id)
  union all
  select 'import:'||q.email,coalesce(cobranca_private.prospect_contact_time(q.source->>'data_contato'),q.imported_at) from cobranca_private.prospect_leads q where q.tenant_id=tenant and nullif(q.source->>'data_contato','') is not null and coalesce(cobranca_private.prospect_contact_time(q.source->>'data_contato'),q.imported_at)>now()-interval '24 hours' and not exists(select 1 from cobranca_private.prospect_attempts a where a.lead_id=q.id)
 ), deduplicated as (select event_key,min(event_at) event_at from events group by event_key),
 policy as (select case when daily_limit<=20 then daily_limit when provider_daily_limit>=daily_limit+10 and provider_limit_checked_at>now()-interval '30 days' then daily_limit else 20 end maximum from connection),
 usage as (select count(*)::int used,coalesce(max(event_at)+interval '15 minutes',now()) next_at from deduplicated)
 select jsonb_build_object('daily_limit',maximum,'used',used,'remaining',greatest(0,maximum-used),'interval_minutes',15,'next_allowed_at',greatest(now(),next_at),'window','rolling_24h','hold',exists(select 1 from cobranca_private.prospect_attempts where tenant_id=tenant and status in ('sending','unknown'))) from policy cross join usage
$$;
revoke all on function cobranca_private.prospect_capacity(uuid) from public,anon,authenticated;

-- Replace only the claim budget guard. Token validation, durable claims and uncertainty hold remain intact.
do $patch$
declare definition text;start_at integer;end_at integer;
begin
 select pg_get_functiondef('cobranca_private.prospect_receive_v1(text,jsonb)'::regprocedure) into definition;
 start_at:=position('  if exists(select 1 from cobranca_private.prospect_attempts where tenant_id=c.tenant_id and claimed_at' in definition);
 end_at:=position('  select * into l from cobranca_private.prospect_leads x' in definition);
 if start_at=0 or end_at<=start_at or position($decl$op text:=payload->>'operation';$decl$ in definition)=0 then raise exception 'Unexpected original claim guard';end if;
 definition:=substring(definition from 1 for start_at-1)||$guard$  capacity:=cobranca_private.prospect_capacity(c.tenant_id);
  if (capacity->>'remaining')::int<=0 or (capacity->>'next_allowed_at')::timestamptz>now() then return jsonb_build_object('lead',null,'reason','rate_limit');end if;
$guard$||substring(definition from end_at);
 definition:=replace(definition,$decl$op text:=payload->>'operation';$decl$,$decl$op text:=payload->>'operation';capacity jsonb;$decl$);
 execute definition;
end $patch$;

-- Keep the existing access checks and separate views, with a shorter visible page.
do $patch$ declare definition text;begin
 select pg_get_functiondef('cobranca_private.prospect_panel(text,jsonb)'::regprocedure) into definition;
 if position('limit 100 offset' in definition)=0 then raise exception 'Unexpected prospect pagination';end if;
 execute replace(definition,'limit 100 offset','limit 25 offset');
end $patch$;
alter function cobranca_private.prospect_panel(text,jsonb) rename to prospect_panel_before_capacity;
create function cobranca_private.prospect_panel(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;p public.cobranca_profiles;
begin
 result:=cobranca_private.prospect_panel_before_capacity(action,payload);
 if action='list' then
  select * into p from public.cobranca_profiles where id=auth.uid() and active;
  return result||jsonb_build_object('page_size',25,'policy',cobranca_private.prospect_capacity(p.tenant_id));
 end if;
 return result;
end$$;
revoke all on function cobranca_private.prospect_panel_before_capacity(text,jsonb) from public,anon,authenticated;
revoke all on function cobranca_private.prospect_panel(text,jsonb) from public,anon;
grant execute on function cobranca_private.prospect_panel(text,jsonb) to authenticated;
create or replace function public.cobranca_prospect(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.prospect_panel(action,payload)$$;

-- Label automatic records and repair only genuinely acknowledged sends, without sending anything.
do $patch$ declare definition text;r record;begin
 select pg_get_functiondef('cobranca_private.prospect_mail_record(uuid,text,text,text,text)'::regprocedure) into definition;
 if position($old$jsonb_build_object('local_only',true,'message_id',provider)$old$ in definition)=0 then raise exception 'Unexpected mail recording function';end if;
 execute replace(definition,$old$jsonb_build_object('local_only',true,'message_id',provider)$old$,$new$jsonb_build_object('local_only',true,'message_id',provider,'prospect_lead_id',l.id)$new$);
 for r in select q.id,a.provider_id,a.subject,a.message from cobranca_private.prospect_leads q join cobranca_private.prospect_attempts a on a.lead_id=q.id and a.status='accepted' where not exists(select 1 from cobranca_private.attendance_messages m where m.tenant_id=q.tenant_id and m.direction='outbound' and m.provider_id=a.provider_id) loop
  perform cobranca_private.prospect_mail_record(r.id,r.provider_id,'outbound',r.message,r.subject);
 end loop;
 update cobranca_private.attendance_messages m set mail_state=m.mail_state||jsonb_build_object('prospect_lead_id',q.id) from cobranca_private.prospect_attempts a join cobranca_private.prospect_leads q on q.id=a.lead_id where m.tenant_id=q.tenant_id and m.provider_id=a.provider_id and m.direction='outbound' and a.status='accepted';
end $patch$;
notify pgrst,'reload schema';
commit;
