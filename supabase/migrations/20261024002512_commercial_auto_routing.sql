begin;
alter table cobranca_private.prospect_connections add column auto_approve boolean not null default false;
alter table cobranca_private.prospect_connections add column automation_state jsonb not null default '{}';
alter table cobranca_private.prospect_leads add column email_checked_at timestamptz;
alter table cobranca_private.prospect_leads add column email_domain_valid boolean;
alter table cobranca_private.prospect_leads add column checked_email text;
alter table cobranca_private.prospect_leads add column whatsapp_checked_at timestamptz;
alter table cobranca_private.prospect_leads add column whatsapp_number text;
alter table cobranca_private.prospect_leads add column whatsapp_active boolean;
alter table cobranca_private.prospect_leads add column positive_reply_at timestamptz;
alter table cobranca_private.prospect_leads add column opportunity_id uuid references cobranca_private.crm_opportunities(id);
create table cobranca_private.prospect_replies (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),
 lead_id uuid not null references cobranca_private.prospect_leads(id),provider_id text not null,
 classification text not null check(classification in ('positive','optout','review')),content text not null,
 received_at timestamptz not null default now(),unique(tenant_id,provider_id)
);
alter table cobranca_private.prospect_replies enable row level security;
revoke all on cobranca_private.prospect_replies from public,anon,authenticated;
create policy deny_direct on cobranca_private.prospect_replies to anon,authenticated using(false) with check(false);

-- Internal helper; callers already hold the tenant connection lock and validate scope.
create function cobranca_private.prospect_route(lead_id uuid) returns uuid language plpgsql set search_path='' as $$
declare l cobranca_private.prospect_leads; ident uuid; pipeline uuid;
begin
 select * into l from cobranca_private.prospect_leads where id=lead_id for update;
 if l.id is null or l.suppressed or not (coalesce(l.whatsapp_active,false) and l.whatsapp_checked_at>now()-interval '30 days' or l.positive_reply_at is not null) then return null;end if;
 if l.opportunity_id is not null then
  update cobranca_private.crm_opportunities set stage=case when l.positive_reply_at is not null and stage='Prospecção' then 'Contato' else stage end,phone=case when coalesce(phone,'')='' and l.whatsapp_active then l.whatsapp_number else phone end,version=version+1,updated_at=now() where id=l.opportunity_id and tenant_id=l.tenant_id;
  return l.opportunity_id;
 end if;
 select id into ident from cobranca_private.crm_opportunities where tenant_id=l.tenant_id and (lower(email)=l.email or (l.document<>'' and regexp_replace(coalesce(document,''),'[^0-9]','','g')=l.document)) order by created_at limit 1;
 if ident is null then
  insert into cobranca_private.crm_pipelines(tenant_id,name) values(l.tenant_id,'Funil principal') on conflict do nothing;
  select id into pipeline from cobranca_private.crm_pipelines where tenant_id=l.tenant_id and active order by (name='Funil principal') desc,created_at limit 1;
  insert into cobranca_private.crm_opportunities(tenant_id,name,document,email,phone,source,stage,owner_id,company_data,pipeline_id)
  values(l.tenant_id,l.company,l.document,l.email,coalesce(l.whatsapp_number,''),'Prospecção automática',case when l.positive_reply_at is null then 'Prospecção' else 'Contato' end,l.owner_id,jsonb_build_object('name',l.company,'document',l.document,'email',l.email,'phone',coalesce(l.whatsapp_number,''),'city',l.source->>'cidade_uf','website',l.source->>'dominio'),pipeline) returning id into ident;
  insert into cobranca_private.crm_activities(tenant_id,opportunity_id,actor,subject,content,channel)
  values(l.tenant_id,ident,l.owner_id,'Entrada automática no funil',case when l.positive_reply_at is not null then 'Resposta positiva recebida em conversa vinculada ao envio comercial.' else 'WhatsApp confirmado pela integração. Nenhuma mensagem WhatsApp foi enviada automaticamente.' end,'Nota');
 end if;
 update cobranca_private.prospect_leads set opportunity_id=ident where id=l.id;
 return ident;
end$$;
revoke all on function cobranca_private.prospect_route(uuid) from public,anon,authenticated;

create function cobranca_private.prospect_mail_record(lead_id uuid,provider text,direction_name text,body_text text,subject_text text) returns void language plpgsql set search_path='' as $$
declare l cobranca_private.prospect_leads;c cobranca_private.prospect_connections;v_thread uuid;
begin
 select * into l from cobranca_private.prospect_leads where id=lead_id;
 select * into c from cobranca_private.prospect_connections where tenant_id=l.tenant_id;
 insert into cobranca_private.attendance_threads(tenant_id,account_id,address,name,owner_id) values(l.tenant_id,c.account_id,l.email,l.company,l.owner_id) on conflict(account_id,address) do nothing;
 select id into v_thread from cobranca_private.attendance_threads where account_id=c.account_id and address=l.email and tenant_id=l.tenant_id;
 insert into cobranca_private.attendance_messages(tenant_id,thread_id,provider_id,provider_ref,direction,content,subject,status,actor,mail_state)
 values(l.tenant_id,v_thread,provider,provider,direction_name,left(body_text,100000),left(subject_text,250),case when direction_name='outbound' then 'accepted' else 'received' end,l.owner_id,jsonb_build_object('local_only',true,'message_id',provider)) on conflict(thread_id,provider_id) do nothing;
 update cobranca_private.attendance_threads set updated_at=now() where id=v_thread;
end$$;
revoke all on function cobranca_private.prospect_mail_record(uuid,text,text,text,text) from public,anon,authenticated;

alter function cobranca_private.prospect_panel(text,jsonb) rename to prospect_panel_v1;
create function cobranca_private.prospect_panel(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;result jsonb; rows jsonb; view_name text; l cobranca_private.prospect_leads;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if p.id is null or p.role not in ('admin','master','commercial_manager','commercial') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Área comercial não autorizada';end if;
 if action='automation' then
  if p.role not in ('admin','master','commercial_manager') then raise exception 'Gestor necessário';end if;
  update cobranca_private.prospect_connections set auto_approve=coalesce((payload->>'enabled')::boolean,false),updated_at=now() where tenant_id=p.tenant_id;
  perform cobranca_private.audit(p.tenant_id,'prospect_automation','prospect_connections',p.tenant_id,null,jsonb_build_object('enabled',payload->'enabled'));
  return jsonb_build_object('saved',true);
 elsif action='list' then
  result:=cobranca_private.prospect_panel_v1(action,payload);
  view_name:=case when payload->>'view'='history' then 'history' else 'queue' end;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc,x.id),'[]') into rows from (
   select q.*,a.id attempt_id,a.status attempt_status,a.provider_id,a.claimed_at,a.finished_at from cobranca_private.prospect_leads q left join cobranca_private.prospect_attempts a on a.lead_id=q.id
   where q.tenant_id=p.tenant_id and (p.role in ('admin','master','commercial_manager') or q.owner_id=p.id)
    and (case when view_name='history' then q.status in ('accepted','reported','responded') else q.status not in ('accepted','reported','responded') end)
    and (coalesce(payload->>'status','')='' or q.status=payload->>'status')
    and (coalesce(payload->>'search','')='' or position(lower(left(payload->>'search',150)) in lower(q.company||' '||q.email||' '||q.document))>0)
   order by q.updated_at desc,q.id limit 100 offset least(100000,greatest(0,coalesce((payload->>'offset')::int,0)))
  ) x;
  return result||jsonb_build_object('rows',rows,'view',view_name,'summary',(result->'summary')||jsonb_build_object('accepted',(select count(*) from cobranca_private.prospect_attempts a join cobranca_private.prospect_leads q on q.id=a.lead_id where a.tenant_id=p.tenant_id and a.status='accepted' and (p.role in ('admin','master','commercial_manager') or q.owner_id=p.id))));
 elsif action='detail' then
  select * into l from cobranca_private.prospect_leads where id=(payload->>'id')::uuid and tenant_id=p.tenant_id and (p.role in ('admin','master','commercial_manager') or owner_id=p.id);
  if l.id is null then raise exception 'Contato não encontrado';end if;
  return jsonb_build_object('replies',coalesce((select jsonb_agg(jsonb_build_object('classification',classification,'content',content,'received_at',received_at) order by received_at desc) from cobranca_private.prospect_replies where lead_id=l.id),'[]'));
 end if;
 return cobranca_private.prospect_panel_v1(action,payload);
end$$;
revoke all on function cobranca_private.prospect_panel_v1(text,jsonb) from public,anon,authenticated;
revoke all on function cobranca_private.prospect_panel(text,jsonb) from public,anon;
grant execute on function cobranca_private.prospect_panel(text,jsonb) to authenticated;
create or replace function public.cobranca_prospect(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.prospect_panel(action,payload)$$;

alter function cobranca_private.prospect_receive(text,jsonb) rename to prospect_receive_v1;
create function cobranca_private.prospect_receive(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c cobranca_private.prospect_connections;l cobranca_private.prospect_leads;result jsonb; op text:=payload->>'operation'; a cobranca_private.attendance_accounts; wp cobranca_private.attendance_accounts;p public.cobranca_profiles; ident uuid; phone text;
begin
 if octet_length(payload::text)>900000 then raise exception 'Lote excede o limite';end if;
 -- The original health operation validates token format, tenant and active owner.
 perform cobranca_private.prospect_receive_v1(token,jsonb_build_object('operation','health'));
 select * into c from cobranca_private.prospect_connections where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') for update;
 select * into p from public.cobranca_profiles where id=c.owner_id;
 if op='automation_context' then
  select * into a from cobranca_private.attendance_accounts where id=c.account_id and active and cobranca_private.attendance_allowed(p,attendance_accounts);
  select * into wp from cobranca_private.attendance_accounts where tenant_id=c.tenant_id and active and sector='commercial' and channel='whatsapp' and cobranca_private.attendance_allowed(p,attendance_accounts) order by created_at limit 1;
  return jsonb_build_object('enabled',c.auto_approve,'sender',case when a.id is null then null else jsonb_build_object('id',a.id,'tenant_id',a.tenant_id,'address',a.address,'cipher',a.cipher) end,
   'whatsapp',case when wp.id is not null then jsonb_build_object('cipher',wp.cipher,'aad',c.tenant_id||':attendance:'||wp.id) when exists(select 1 from cobranca_private.channel_settings where tenant_id=c.tenant_id and channel='whatsapp') then (select jsonb_build_object('cipher',cipher,'aad',c.tenant_id||':whatsapp') from cobranca_private.channel_settings where tenant_id=c.tenant_id and channel='whatsapp') else null end,
   'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email)) from (select * from cobranca_private.prospect_leads where tenant_id=c.tenant_id and not suppressed and status='pending' and last_seen_at>now()-interval '20 minutes' and (email_checked_at is null or email_checked_at<now()-interval '7 days') order by email_checked_at nulls first,imported_at,id limit 5) q),'[]'),
   'phones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'phone',source->>'whatsapp')) from (select * from cobranca_private.prospect_leads where tenant_id=c.tenant_id and not suppressed and length(regexp_replace(coalesce(source->>'whatsapp',''),'[^0-9]','','g')) between 10 and 15 and (whatsapp_checked_at is null or whatsapp_checked_at<now()-interval '30 days') order by whatsapp_checked_at nulls first,imported_at,id limit 1) q),'[]'),
   'contacted',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'email',q.email,'provider_id',attempt.provider_id)) from cobranca_private.prospect_leads q join cobranca_private.prospect_attempts attempt on attempt.lead_id=q.id where q.tenant_id=c.tenant_id and not q.suppressed and attempt.status='accepted' and attempt.finished_at>now()-interval '90 days'),'[]'));
 elsif op='sheet_updates' then
  return coalesce((select jsonb_agg(jsonb_build_object('status','accepted','id',q.id,'email',q.email,'attempt_id',attempt.id,'provider_id',attempt.provider_id,'finished_at',attempt.finished_at,'responded',q.status='responded','suppressed',q.suppressed)) from (select * from cobranca_private.prospect_leads where tenant_id=c.tenant_id and status in ('accepted','responded') and (coalesce(source->>'status_email','')<>'ENVIADO' or (status='responded' and coalesce(source->>'situacao','')<>'RESPONDEU' and not suppressed) or (suppressed and coalesce(source->>'situacao','')<>'OPTOUT')) order by imported_at,id limit 20) q join cobranca_private.prospect_attempts attempt on attempt.lead_id=q.id and attempt.status='accepted'),'[]');
 elsif op='automation_status' then
  if payload->>'channel' not in ('email','whatsapp') or payload->>'status' not in ('ready','unavailable') then raise exception 'Estado inválido';end if;
  update cobranca_private.prospect_connections set automation_state=automation_state||jsonb_build_object(payload->>'channel',jsonb_build_object('status',payload->>'status','checked_at',now())) where tenant_id=c.tenant_id;
  return jsonb_build_object('saved',true);
 elsif op='email_check' then
  update cobranca_private.prospect_leads set email_domain_valid=(payload->>'valid')::boolean,email_checked_at=now(),checked_email=email where id=(payload->>'id')::uuid and tenant_id=c.tenant_id and email=payload->>'email' and status='pending' and not suppressed;
  return jsonb_build_object('saved',true);
 elsif op='whatsapp_check' then
  select * into l from cobranca_private.prospect_leads where id=(payload->>'id')::uuid and tenant_id=c.tenant_id for update;
  phone:=regexp_replace(coalesce(l.source->>'whatsapp',''),'[^0-9]','','g');if length(phone) in (10,11) then phone:='55'||phone;end if;
  if l.id is null or phone is distinct from payload->>'number' or phone !~ '^[1-9][0-9]{11,14}$' or jsonb_typeof(payload->'exists') is distinct from 'boolean' then raise exception 'Número ou confirmação inválidos';end if;
  update cobranca_private.prospect_leads set whatsapp_number=phone,whatsapp_active=(payload->>'exists')::boolean,whatsapp_checked_at=now() where id=l.id;
  ident:=cobranca_private.prospect_route(l.id);return jsonb_build_object('saved',true,'opportunity_id',ident);
 elsif op='reply' then
  select q.* into l from cobranca_private.prospect_leads q join cobranca_private.prospect_attempts attempt on attempt.lead_id=q.id where q.id=(payload->>'id')::uuid and q.tenant_id=c.tenant_id and q.email=payload->>'email' and attempt.status='accepted' and attempt.provider_id=payload->>'in_reply_to' for update of q;
  if l.id is null or length(coalesce(payload->>'provider_id','')) not between 1 and 500 or payload->>'classification' not in ('positive','optout','review') then raise exception 'Resposta não vinculada a envio confirmado';end if;
  insert into cobranca_private.prospect_replies(tenant_id,lead_id,provider_id,classification,content) values(c.tenant_id,l.id,payload->>'provider_id',payload->>'classification',left(coalesce(payload->>'content',''),5000)) on conflict do nothing returning id into ident;
  if ident is null then return jsonb_build_object('duplicate',true);end if;
  perform cobranca_private.prospect_mail_record(l.id,payload->>'provider_id','inbound',coalesce(payload->>'content',''),'Resposta ao e-mail de apresentação');
  if payload->>'classification'='optout' then update cobranca_private.prospect_leads set suppressed=true where id=l.id;
  elsif payload->>'classification'='positive' and not l.suppressed then
   update cobranca_private.prospect_leads set positive_reply_at=coalesce(positive_reply_at,now()),status='responded',updated_at=now() where id=l.id;ident:=cobranca_private.prospect_route(l.id);
   if l.positive_reply_at is null and ident is not null then insert into cobranca_private.crm_tasks(tenant_id,opportunity_id,name,owner_id,due_at) values(c.tenant_id,ident,'Acompanhar retorno positivo: '||left(l.company,150),l.owner_id,now()+interval '1 hour');end if;
  end if;
  if l.opportunity_id is not null then insert into cobranca_private.crm_activities(tenant_id,opportunity_id,actor,subject,content,channel) values(c.tenant_id,l.opportunity_id,c.owner_id,'Resposta ao e-mail de apresentação',left(coalesce(payload->>'content',''),5000),'E-mail');end if;
  return jsonb_build_object('saved',true);
 elsif op='auto_approve' then
  if not c.auto_approve then return jsonb_build_object('approved',0);end if;
  for l in select * from cobranca_private.prospect_leads q where tenant_id=c.tenant_id and status='pending' and not suppressed and last_seen_at>now()-interval '20 minutes' and email_domain_valid and checked_email=email and email_checked_at>now()-interval '7 days' and upper(trim(coalesce(source->>'b2b_confirmado','')))='SIM' and source->>'fonte_url' ~ '^https://[^[:space:]]+$' and email ~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+$' and not exists(select 1 from cobranca_private.prospect_attempts where lead_id=q.id) order by imported_at,id for update loop
   if l.document<>'' and exists(select 1 from cobranca_private.prospect_leads where tenant_id=c.tenant_id and id<>l.id and document=l.document and (suppressed or status in ('ready','sending','accepted','reported','review','responded'))) then continue;end if;
   update cobranca_private.prospect_leads set status='ready',approved_by=c.owner_id,subject='Apresentação da R&R Estratégia Performance',message='Olá, equipe da '||regexp_replace(l.company,E'[\r\n]',' ','g')||E'.\n\nSomos a R&R Estratégia Performance. Gostaríamos de apresentar nossas soluções de recuperação de crédito e organização de cobranças para empresas.\n\nHá interesse em uma breve conversa para avaliar se podemos ajudar? Basta responder a este e-mail para nossa equipe acompanhar seu retorno.\n\nR&R Estratégia Performance\ncontato@rrestrategiaperformance.com.br\nSe não deseja receber novos contatos comerciais, responda solicitando a remoção.',version=version+1,updated_at=now() where id=l.id;
   perform cobranca_private.audit(c.tenant_id,'prospect_auto_approve','prospect_leads',l.id,null,jsonb_build_object('basis','B2B, origem HTTPS e domínio com MX; não comprova existência da caixa'));
  end loop;
  return jsonb_build_object('saved',true);
 end if;
 result:=cobranca_private.prospect_receive_v1(token,payload);
 if op='finish' and payload->>'status'='accepted' then
  select q.* into l from cobranca_private.prospect_leads q join cobranca_private.prospect_attempts attempt on attempt.lead_id=q.id where attempt.id=(payload->>'attempt_id')::uuid and q.tenant_id=c.tenant_id;
  perform cobranca_private.prospect_mail_record(l.id,payload->>'provider_id','outbound',l.message,l.subject);
 end if;
 if op='mirror' then
  -- Changed phone evidence cannot remain attached to a different number.
  update cobranca_private.prospect_leads set whatsapp_active=false,whatsapp_checked_at=null,whatsapp_number=null where tenant_id=c.tenant_id and whatsapp_number is not null and whatsapp_number is distinct from case when length(regexp_replace(coalesce(source->>'whatsapp',''),'[^0-9]','','g')) in (10,11) then '55'||regexp_replace(source->>'whatsapp','[^0-9]','','g') else regexp_replace(coalesce(source->>'whatsapp',''),'[^0-9]','','g') end;
 end if;
 return result;
end$$;
revoke all on function cobranca_private.prospect_receive_v1(text,jsonb) from public,anon,authenticated;
revoke all on function cobranca_private.prospect_receive(text,jsonb) from public;
grant execute on function cobranca_private.prospect_receive(text,jsonb) to anon,authenticated;
create or replace function public.cobranca_prospect_sync(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.prospect_receive(token,payload)$$;

alter function cobranca_private.improvements(text,jsonb) rename to improvements_before_routing;
create function cobranca_private.improvements(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;rows jsonb;p public.cobranca_profiles;
begin
 result:=cobranca_private.improvements_before_routing(action,payload);
 if action='crm_board' then
  select * into p from public.cobranca_profiles where id=auth.uid() and active;
  select coalesce(jsonb_agg(value),'[]') into rows from jsonb_array_elements(result->'rows') card where exists(select 1 from cobranca_private.prospect_leads q where q.tenant_id=p.tenant_id and not q.suppressed and (q.opportunity_id=(card.value->>'id')::uuid or lower(q.email)=lower(card.value->>'email') or (q.document<>'' and q.document=regexp_replace(coalesce(card.value->>'document',''),'[^0-9]','','g'))) and ((q.whatsapp_active and q.whatsapp_checked_at>now()-interval '30 days' and q.whatsapp_number=regexp_replace(coalesce(card.value->>'phone',''),'[^0-9]','','g')) or q.positive_reply_at is not null));
  return result||jsonb_build_object('rows',rows,'eligibility_rule','WhatsApp ativo confirmado ou resposta positiva vinculada ao envio. Cadastros sem confirmação são preservados fora do quadro.');
 end if;
 return result;
end$$;
revoke all on function cobranca_private.improvements_before_routing(text,jsonb) from public,anon,authenticated;
revoke all on function cobranca_private.improvements(text,jsonb) from public,anon;
grant execute on function cobranca_private.improvements(text,jsonb) to authenticated;
create or replace function public.cobranca_improvements(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.improvements(action,payload)$$;
notify pgrst,'reload schema';
commit;
