begin;
-- O acesso é feito pela API autorizada. Não há acesso direto às tabelas.
do $$declare t text;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'cobranca_%' loop
  execute format('create policy cobranca_rpc_only on public.%I for all to authenticated using (false) with check (false)',t);
 end loop;
end $$;
commit;
