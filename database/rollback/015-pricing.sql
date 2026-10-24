-- Rollback operacional: desativa integrações novas, preservando TODOS os lançamentos.
-- Publicar a branch backup/antes-honorarios-20261018 junto desta desativação.
begin;
drop trigger if exists cobranca_fee_debt on public.cobranca_debts;
drop trigger if exists cobranca_fee_protect_debt on public.cobranca_debts;
drop trigger if exists cobranca_fee_receipt_before on public.cobranca_receipts;
drop trigger if exists cobranca_fee_receipt_after on public.cobranca_receipts;
create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$
select case when action like 'chat_%' then cobranca_private.chat(action,payload) when action='report' then cobranca_private.reports(payload) when action='erp_config' then cobranca_private.erp_config(payload) when action like 'fin_%' then cobranca_private.finance(action,payload) else cobranca_private.api(action,payload) end
$$;
revoke execute on function cobranca_private.pricing(text,jsonb) from authenticated;
commit;
