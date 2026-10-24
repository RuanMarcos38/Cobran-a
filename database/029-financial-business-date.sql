begin;
-- Scope the business date to these API calls; preserve database/server defaults.
alter function public.cobranca_app(text,jsonb) set TimeZone to 'America/Sao_Paulo';
alter function public.cobranca_negotiate(text,jsonb) set TimeZone to 'America/Sao_Paulo';
notify pgrst,'reload schema';
commit;
