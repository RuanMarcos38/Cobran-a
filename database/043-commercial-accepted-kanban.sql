begin;
-- Only a recorded presentation attempt, with provider evidence and an exact
-- tenant/contact relationship, may advance an existing prospect card.
create or replace function cobranca_private.prospect_advance_accepted(p_lead uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare l cobranca_private.prospect_leads; a cobranca_private.prospect_attempts;
 o cobranca_private.crm_opportunities;
begin
 select * into l from cobranca_private.prospect_leads where id=p_lead;
 if l.opportunity_id is null then return false;end if;
 select * into a from cobranca_private.prospect_attempts
 where lead_id=l.id and tenant_id=l.tenant_id and status='accepted'
 and nullif(trim(provider_id),'') is not null and finished_at is not null;
 if a.id is null then return false;end if;
 select * into o from cobranca_private.crm_opportunities
 where id=l.opportunity_id and tenant_id=l.tenant_id
 and lower(trim(email))=lower(trim(l.email)) for update;
 if o.id is null or o.stage<>'Prospecção' then return false;end if;
 update cobranca_private.crm_opportunities set stage='Contato',version=version+1,updated_at=now() where id=o.id;
 insert into cobranca_private.crm_activities(tenant_id,opportunity_id,actor,subject,content,channel,stage)
 values(l.tenant_id,o.id,l.owner_id,'Apresentação aceita pelo servidor: Prospecção → Contato',
 'Aceite SMTP registrado em '||a.finished_at::text||'. Identificador: '||a.provider_id||'. Não comprova entrega ou leitura.',
 'E-mail','Contato');
 insert into public.cobranca_audit_logs(tenant_id,actor,action,entity_type,entity_id,before_data,after_data)
 values(l.tenant_id,coalesce(auth.uid()::text,'system:commercial'),'commercial_accepted_kanban','crm_opportunities',o.id,
 jsonb_build_object('stage',o.stage,'version',o.version,'updated_at',o.updated_at),
 jsonb_build_object('stage','Contato','version',o.version+1,'lead_id',l.id,'attempt_id',a.id,'provider_id',a.provider_id,'accepted_at',a.finished_at));
 return true;
end$$;
revoke all on function cobranca_private.prospect_advance_accepted(uuid) from public,anon,authenticated;

create or replace function cobranca_private.prospect_accepted_kanban_event()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='prospect_attempts' then
  perform cobranca_private.prospect_advance_accepted(new.lead_id);
 else
  perform cobranca_private.prospect_advance_accepted(new.id);
 end if;
 return new;
end$$;
revoke all on function cobranca_private.prospect_accepted_kanban_event() from public,anon,authenticated;
-- Reapplication is safe and leaves unrelated triggers intact.
create or replace trigger prospect_attempt_accepted_kanban
after insert or update of status,provider_id,finished_at on cobranca_private.prospect_attempts
for each row when (new.status='accepted') execute function cobranca_private.prospect_accepted_kanban_event();
create or replace trigger prospect_link_accepted_kanban
after insert or update of opportunity_id on cobranca_private.prospect_leads
for each row when (new.opportunity_id is not null) execute function cobranca_private.prospect_accepted_kanban_event();

-- Reconcile only explicit lead/card links, never domain, company or phone guesses.
do $$declare ident uuid;begin
 for ident in select l.id from cobranca_private.prospect_leads l
 join cobranca_private.crm_opportunities o on o.id=l.opportunity_id and o.tenant_id=l.tenant_id
 where o.stage='Prospecção' order by l.id loop
  perform cobranca_private.prospect_advance_accepted(ident);
 end loop;
end$$;
commit;
