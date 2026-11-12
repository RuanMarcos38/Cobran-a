do $migration$
declare
  def text := pg_get_functiondef('cobranca_private.prospect_receive_v1(text,jsonb)'::regprocedure);
  anchor constant text := $anchor$select 1 from cobranca_private.prospect_attempts where tenant_id=c.tenant_id and status in ('sending','unknown')$anchor$;
  replacement constant text := $replacement$select 1 from cobranca_private.prospect_attempts blocked where blocked.tenant_id=c.tenant_id and (blocked.status='sending' or (blocked.status='unknown' and exists (select 1 from cobranca_private.prospect_leads blocked_lead where blocked_lead.tenant_id=c.tenant_id and blocked_lead.id=blocked.lead_id and split_part(lower(trim(blocked_lead.email)), '@', 1) ~ '^(financeiro|finance|financial|contas[._-]?a[._-]?receber|contas[._-]?receber|accounts[._-]?receivable|recebiveis|tesouraria)([._-][a-z0-9]+)*$')))$replacement$;
begin
  if strpos(def, replacement) > 0 then return; end if;
  if strpos(def, anchor) = 0 or strpos(def, 'accounts[._-]?receivable') = 0 then
    raise exception 'A trava existente ou a qualificação financeira não foi localizada';
  end if;
  execute replace(def, anchor, replacement);
end
$migration$;
