begin;
-- Disable the new entry point and audit hooks; keep all evidence, drafts and original data.
revoke all on function public.cobranca_financial_engine(text,jsonb) from public,anon,authenticated;
drop trigger if exists motor_creditor_audit on public.cobranca_creditors;
drop trigger if exists motor_debt_audit on public.cobranca_debts;
drop trigger if exists motor_receipt_audit on public.cobranca_receipts;
drop trigger if exists motor_agreement_audit on public.cobranca_agreements;
drop trigger if exists motor_contract_audit on cobranca_private.fee_contracts;
drop trigger if exists motor_closing_audit on cobranca_private.fee_closings;
drop trigger if exists motor_settlement_audit on cobranca_private.finance_settlements;
notify pgrst,'reload schema';
commit;
