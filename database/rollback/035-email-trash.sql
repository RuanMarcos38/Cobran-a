begin;
create or replace function public.cobranca_attendance(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.attendance(action,payload)$$;
drop function cobranca_private.mail_attendance(text,jsonb);
-- Preserve mail_state for non-destructive rollback; original messages remain retained.
commit;
