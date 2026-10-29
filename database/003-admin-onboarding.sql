begin;
create table cobranca_private.bootstrap (
 email text primary key,
 tenant_id uuid not null references public.cobranca_tenants(id),
 claimed_by uuid references auth.users(id),
 claimed_at timestamptz
);
revoke all on cobranca_private.bootstrap from public,anon,authenticated;
create function cobranca_private.claim_admin() returns jsonb
language plpgsql security definer set search_path='' as $$
declare address text; verified timestamptz; setup cobranca_private.bootstrap;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária';end if;
 if exists(select 1 from public.cobranca_profiles where id=auth.uid() and active) then return jsonb_build_object('ready',true);end if;
 select lower(email),email_confirmed_at into address,verified from auth.users where id=auth.uid();
 if verified is null then raise exception 'Confirme seu e-mail antes de acessar';end if;
 select * into setup from cobranca_private.bootstrap where email=address for update;
 if not found or setup.claimed_by is not null then raise exception 'Este e-mail não está autorizado para administração';end if;
 insert into public.cobranca_profiles(id,tenant_id,name,role,discount_limit)
 values(auth.uid(),setup.tenant_id,'Administrador','admin',100);
 update cobranca_private.bootstrap set claimed_by=auth.uid(),claimed_at=now() where email=address;
 perform cobranca_private.audit(setup.tenant_id,'admin_onboarding','profiles',auth.uid(),null,jsonb_build_object('role','admin'));
 return jsonb_build_object('ready',true);
end $$;
revoke all on function cobranca_private.claim_admin() from public,anon;
grant execute on function cobranca_private.claim_admin() to authenticated;
create function public.cobranca_claim_admin() returns jsonb
language sql security invoker set search_path='' as $$select cobranca_private.claim_admin()$$;
revoke all on function public.cobranca_claim_admin() from public,anon;
grant execute on function public.cobranca_claim_admin() to authenticated;
commit;
