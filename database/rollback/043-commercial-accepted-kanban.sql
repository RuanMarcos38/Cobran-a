begin;
drop trigger if exists prospect_attempt_accepted_kanban on cobranca_private.prospect_attempts;
drop trigger if exists prospect_link_accepted_kanban on cobranca_private.prospect_leads;
-- Restore only cards untouched since this change. Retain every activity and audit.
with saved as (
 select distinct on (entity_id) * from public.cobranca_audit_logs
 where action='commercial_accepted_kanban' order by entity_id,created_at desc,id desc
), restored as (
 update cobranca_private.crm_opportunities o set stage=s.before_data->>'stage',version=o.version+1,updated_at=now()
 from saved s where s.entity_id=o.id and s.tenant_id=o.tenant_id
 and o.stage=s.after_data->>'stage' and o.version=(s.after_data->>'version')::int
 returning o.id,o.tenant_id,o.version
)
insert into public.cobranca_audit_logs(tenant_id,actor,action,entity_type,entity_id,after_data)
select tenant_id,coalesce(auth.uid()::text,'system:commercial'),'rollback_commercial_accepted_kanban','crm_opportunities',id,
jsonb_build_object('stage','Prospecção','version',version) from restored;
drop function if exists cobranca_private.prospect_accepted_kanban_event();
drop function if exists cobranca_private.prospect_advance_accepted(uuid);
commit;
