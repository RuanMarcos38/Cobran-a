begin;
-- A token-scoped worker has no auth.uid(). Keep its audit identity explicit.
do $patch$
declare definition text;
 old_call text:=$old$perform cobranca_private.audit(c.tenant_id,'prospect_auto_approve','prospect_leads',l.id,null,jsonb_build_object('basis','B2B, origem HTTPS e domínio com MX; não comprova existência da caixa'));$old$;
 new_call text:=$new$insert into public.cobranca_audit_logs(tenant_id,actor,action,entity_type,entity_id,after_data) values(c.tenant_id,'commercial_automation','prospect_auto_approve','prospect_leads',l.id,jsonb_build_object('responsible',c.owner_id,'basis','B2B, origem HTTPS e domínio com MX; não comprova existência da caixa'));$new$;
begin
 select pg_get_functiondef('cobranca_private.prospect_receive(text,jsonb)'::regprocedure) into definition;
 if position(old_call in definition)=0 then raise exception 'Unexpected commercial worker definition';end if;
 execute replace(definition,old_call,new_call);
end $patch$;
notify pgrst,'reload schema';
commit;
