begin;
create index if not exists attendance_messages_tenant_date on cobranca_private.attendance_messages(tenant_id,created_at desc,id);
create index if not exists attendance_threads_tenant_account on cobranca_private.attendance_threads(tenant_id,account_id,id);
create or replace function cobranca_private.mail_query(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles; a cobranca_private.attendance_accounts;
 v_thread cobranca_private.attendance_threads; result jsonb;
 q text:=lower(trim(left(coalesce(payload->>'search',''),250)));
 v_folder text:=coalesce(payload->>'folder','all'); off int:=greatest(0,least(1000000,coalesce((payload->>'offset')::int,0)));
 lim int:=greatest(1,least(50,coalesce((payload->>'limit')::int,25)));
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if p.id is null or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;
 select * into a from cobranca_private.attendance_accounts where id=(payload->>'account_id')::uuid;
 if not cobranca_private.attendance_allowed(p,a) or a.channel<>'email' then raise exception 'Caixa postal não autorizada';end if;
 if payload->>'operation'='detail' then
  select * into v_thread from cobranca_private.attendance_threads where id=(payload->>'thread_id')::uuid and tenant_id=p.tenant_id and account_id=a.id
   and (p.role in ('admin','master','supervisor','commercial_manager') or owner_id=p.id);
  if v_thread.id is null then raise exception 'Mensagem não autorizada';end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') into result from (
   select m.* from cobranca_private.attendance_messages m where m.thread_id=v_thread.id and m.tenant_id=p.tenant_id
    and coalesce(m.mail_state->>'purged','false')<>'true'
    and (nullif(payload->>'message_id','') is null or m.id=(payload->>'message_id')::uuid)
   order by m.created_at desc,m.id desc limit 50
  ) x;
  return jsonb_build_object('thread',to_jsonb(v_thread),'messages',result);
 end if;
 if v_folder not in ('all','inbox','sent','pending','notes','trash') then raise exception 'Pasta inválida';end if;
 with accessible as (
  select m.*,to_jsonb(t) thread,case when m.mail_state->>'trashed'='true' then 'trash' when m.direction='note' then 'notes'
   when m.direction='inbound' then 'inbox' when m.status in ('accepted','received') then 'sent' else 'pending' end folder
  from cobranca_private.attendance_messages m join cobranca_private.attendance_threads t on t.id=m.thread_id and t.tenant_id=m.tenant_id
  where m.tenant_id=p.tenant_id and t.account_id=a.id and coalesce(m.mail_state->>'purged','false')<>'true'
   and (p.role in ('admin','master','supervisor','commercial_manager') or t.owner_id=p.id)
 ), filtered as (
  select * from accessible x where (v_folder='all' or x.folder=v_folder)
   and (q='' or position(q in lower(x.subject||' '||x.content||' '||(x.thread->>'name')||' '||(x.thread->>'address')))>0
    or exists(select 1 from cobranca_private.crm_opportunities o where o.tenant_id=p.tenant_id and lower(trim(o.email))=lower(x.thread->>'address')
     and (p.role in ('admin','master','supervisor','commercial_manager') or o.owner_id=p.id)
     and position(q in lower(o.name||' '||coalesce(o.phone,'')))>0))
   and (coalesce(payload->>'status','')='' or x.status=payload->>'status')
   and (nullif(payload->>'from_date','') is null or x.created_at>=((payload->>'from_date')::date::timestamp at time zone 'America/Sao_Paulo'))
   and (nullif(payload->>'to_date','') is null or x.created_at<(((payload->>'to_date')::date+1)::timestamp at time zone 'America/Sao_Paulo'))
 ), page as (
  select jsonb_build_object('id',id,'thread',thread,'folder',x.folder,'subject',subject,'content',left(content,160),'direction',direction,'status',status,
   'created_at',created_at,'provider_id',provider_id,'mail_state',mail_state,
   'attachments',coalesce((select jsonb_agg(v-'base64') from jsonb_array_elements(attachments) v),'[]')) item
  from filtered x order by created_at desc,id desc limit lim offset off
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(item) from page),'[]'),'total',(select count(*) from filtered),
 'offset',off,'limit',lim,'counts',coalesce((select jsonb_object_agg(x.folder,x.n) from (select accessible.folder,count(*) n from accessible group by accessible.folder) x),'{}')) into result;
 return result;
end$$;
revoke all on function cobranca_private.mail_query(jsonb) from public,anon;
grant execute on function cobranca_private.mail_query(jsonb) to authenticated;
create or replace function public.cobranca_mail_query(payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select cobranca_private.mail_query(payload)$$;
revoke all on function public.cobranca_mail_query(jsonb) from public,anon;
grant execute on function public.cobranca_mail_query(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
