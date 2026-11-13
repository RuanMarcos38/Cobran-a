begin;
create or replace function cobranca_private.attendance_allowed(p public.cobranca_profiles,a cobranca_private.attendance_accounts) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p.active and a.active and p.tenant_id=a.tenant_id and (p.role in ('admin','master') or (p.id=any(a.members) and ((a.sector='commercial' and p.role in ('commercial','commercial_manager')) or (a.sector='collections' and p.role in ('collector','supervisor','finance'))))),false)
$$;
commit;
