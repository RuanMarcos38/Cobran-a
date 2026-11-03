begin;
drop function if exists public.cobranca_mail_query(jsonb);
drop function if exists cobranca_private.mail_query(jsonb);
drop index if exists cobranca_private.attendance_messages_tenant_date;
drop index if exists cobranca_private.attendance_threads_tenant_account;
notify pgrst,'reload schema';
commit;
