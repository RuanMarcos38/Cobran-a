-- Rollback only objects introduced by migration 034. Does not delete business data.
begin;
do $$declare r record;begin
 for r in select n.nspname,c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where t.tgname in ('tenant_ownership_guard','tenant_members_guard','tenant_allocation_guard') and (n.nspname='cobranca_private' or (n.nspname='public' and c.relname like 'cobranca_%')) loop execute format('drop trigger %I on %I.%I',r.tgname,r.nspname,r.relname);end loop;
 for r in select n.nspname,c.relname,x.conname from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where x.conname like 'tenant_iso_fk_%' and (n.nspname='cobranca_private' or (n.nspname='public' and c.relname like 'cobranca_%')) loop execute format('alter table %I.%I drop constraint %I',r.nspname,r.relname,r.conname);end loop;
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='i' and c.relname like 'tenant_iso_u_%' and n.nspname in ('public','cobranca_private') loop execute format('drop index %I.%I',r.nspname,r.relname);end loop;
end$$;
drop function cobranca_private.tenant_ownership_guard();
drop function cobranca_private.tenant_members_guard();
drop function cobranca_private.tenant_allocation_guard();
drop policy tenant_isolation_deny_direct on cobranca_private.bootstrap;
drop policy tenant_isolation_deny_direct on cobranca_private.invitations;
alter table cobranca_private.bootstrap disable row level security;
alter table cobranca_private.invitations disable row level security;
notify pgrst,'reload schema';
commit;
