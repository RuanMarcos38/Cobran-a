begin;
-- Preserve audit and financial references: removing access never deletes auth identities.
alter table public.cobranca_profiles add column if not exists removed_at timestamptz;
alter table cobranca_private.invitations add column if not exists removed_at timestamptz;
create or replace function cobranca_private.team(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;target public.cobranca_profiles;inv cobranca_private.invitations;ident uuid;address text;chosen_role text;limit_percent numeric;creditor uuid;enabled boolean;result jsonb;access_rules jsonb;manage_users boolean;linked uuid;requested_operation text:=payload->>'operation';
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not (p.role in ('admin','master') or (p.role='supervisor' and p.can_manage_users)) then raise exception 'Gestão de usuários não autorizada';end if;
 if requested_operation='list' then
  select coalesce(jsonb_agg(row_data order by row_data->>'name'),'[]') into result from (
   select jsonb_build_object('id',x.id,'name',x.name,'email',u.email,'role',x.role,'creditor_id',x.creditor_id,'discount_limit',x.discount_limit,'active',x.active,'invitation',false,'removed',x.removed_at is not null,'client_access',x.client_access,'can_manage_users',x.can_manage_users) row_data from public.cobranca_profiles x join auth.users u on u.id=x.id where x.tenant_id=p.tenant_id and (x.removed_at is null or coalesce((payload->>'include_removed')::boolean,false)) and (p.role<>'supervisor' or x.role not in ('commercial','commercial_manager'))
   union all select jsonb_build_object('id',i.id,'name',i.name,'email',i.email,'role',i.role,'creditor_id',i.creditor_id,'discount_limit',i.discount_limit,'active',i.active,'expires_at',i.expires_at,'invitation',true,'removed',i.removed_at is not null,'client_access',i.client_access,'can_manage_users',i.can_manage_users) from cobranca_private.invitations i where i.tenant_id=p.tenant_id and (i.removed_at is null or coalesce((payload->>'include_removed')::boolean,false)) and not exists(select 1 from auth.users au join public.cobranca_profiles ap on ap.id=au.id where lower(au.email)=i.email and ap.tenant_id=i.tenant_id) and (p.role<>'supervisor' or i.role not in ('commercial','commercial_manager')) and i.claimed_by is null
  ) rows;
  return jsonb_build_object('rows',result,'count',jsonb_array_length(result),'total',null);
 elsif requested_operation not in ('save','deactivate','archive','restore') then raise exception 'Operação inválida';end if;

 ident:=nullif(payload->>'id','')::uuid;
 if ident is not null and coalesce((payload->>'invitation')::boolean,false) then
  select * into inv from cobranca_private.invitations where id=ident and tenant_id=p.tenant_id for update;
  if not found then raise exception 'Convite não encontrado';end if;
  select ap.id into linked from public.cobranca_profiles ap join auth.users au on au.id=ap.id where ap.tenant_id=p.tenant_id and lower(au.email)=inv.email;
  if linked is not null then
   update cobranca_private.invitations set claimed_by=linked,active=false where id=ident;
   payload:=payload||jsonb_build_object('id',linked,'invitation',false);ident:=linked;
  end if;
 end if;
 if requested_operation in ('deactivate','archive','restore') then
  if ident is null then raise exception 'Selecione o usuário';end if;
  if coalesce((payload->>'invitation')::boolean,false) then
   select * into inv from cobranca_private.invitations where id=ident and tenant_id=p.tenant_id for update;
   if not found or (p.role='supervisor' and inv.role not in ('collector','creditor')) then raise exception 'Convite não autorizado';end if;
   update cobranca_private.invitations set active=false,removed_at=case when requested_operation='archive' then now() else null end where id=ident;
  else
   select * into target from public.cobranca_profiles where id=ident and tenant_id=p.tenant_id for update;
   if not found or target.role='master' or ident=p.id or (p.role='supervisor' and target.role not in ('collector','creditor')) then raise exception 'Você não pode remover seu próprio acesso nem alterar um perfil protegido';end if;
   update public.cobranca_profiles set active=false,removed_at=case when requested_operation='archive' then now() else null end where id=ident;
  end if;
  perform cobranca_private.audit(p.tenant_id,'member_'||requested_operation,'profiles',ident,null,jsonb_build_object('active',false,'removed',requested_operation='archive'));
  return jsonb_build_object('id',ident,'active',false);
 end if;

 ident:=nullif(payload->>'id','')::uuid;address:=lower(trim(coalesce(payload->>'email','')));chosen_role:=payload->>'role';limit_percent:=coalesce(nullif(payload->>'discount_limit','')::numeric,-1);enabled:=coalesce((payload->>'active')::boolean,true);creditor:=nullif(payload->>'creditor_id','')::uuid;
 if length(trim(coalesce(payload->>'name',''))) not between 1 and 250 or coalesce(chosen_role,'') not in ('admin','supervisor','collector','finance','creditor','commercial','commercial_manager') or limit_percent not between 0 and 100 then raise exception 'Nome, perfil ou alçada inválidos';end if;
 if chosen_role='creditor' and not exists(select 1 from public.cobranca_creditors where id=creditor and tenant_id=p.tenant_id and active) then raise exception 'Cliente credor inválido';end if;
 access_rules:=cobranca_private.validate_client_access(payload->'client_access');
 manage_users:=coalesce((payload->>'can_manage_users')::boolean,false);
 if p.role='supervisor' and (chosen_role not in ('collector','creditor') or manage_users or limit_percent>p.discount_limit) then raise exception 'Gestor só pode criar negociador ou cliente, dentro da própria alçada';end if;
 if manage_users and chosen_role<>'supervisor' then raise exception 'Delegação de usuários disponível somente para gestor';end if;
 if chosen_role<>'creditor' then creditor:=null;end if;
 if ident is not null and not coalesce((payload->>'invitation')::boolean,false) then
  select * into target from public.cobranca_profiles where id=ident and tenant_id=p.tenant_id for update;
  if not found then raise exception 'Usuário não encontrado';end if;
  if p.role='supervisor' and target.role not in ('collector','creditor') then raise exception 'Gestor não pode alterar outro gestor ou administrador';end if;
  if target.role='master' then raise exception 'Perfil reservado';end if;
  if ident=p.id and (chosen_role<>'admin' or not enabled) then raise exception 'Você não pode desativar ou remover seu próprio acesso administrativo';end if;
  update public.cobranca_profiles set name=payload->>'name',role=chosen_role,creditor_id=creditor,discount_limit=limit_percent,active=enabled,removed_at=null,client_access=access_rules,can_manage_users=manage_users where id=ident;
  perform cobranca_private.audit(p.tenant_id,'update_member','profiles',ident,to_jsonb(target),payload-'email');
 else
  if address !~ '^[^ @]+@[^ @]+\.[^ @]+$' or length(address)>254 then raise exception 'E-mail inválido';end if;
  if exists(select 1 from auth.users u join public.cobranca_profiles x on x.id=u.id where lower(u.email)=address) then raise exception 'E-mail já possui acesso. Edite o usuário na sua empresa';end if;
  select * into inv from cobranca_private.invitations where email=address for update;
  if found and p.role='supervisor' and inv.role not in ('collector','creditor') then raise exception 'Gestor não pode alterar convite de gestor ou administrador';end if;
  if found and (inv.tenant_id<>p.tenant_id or (ident is not null and inv.id<>ident)) then raise exception 'E-mail indisponível para convite';end if;
  if ident is not null and not exists(select 1 from cobranca_private.invitations where id=ident and tenant_id=p.tenant_id and email=address) then raise exception 'Convite não encontrado';end if;
  insert into cobranca_private.invitations(email,tenant_id,name,role,creditor_id,discount_limit,active,client_access,can_manage_users) values(address,p.tenant_id,payload->>'name',chosen_role,creditor,limit_percent,enabled,access_rules,manage_users)
  on conflict(email) do update set name=excluded.name,role=excluded.role,creditor_id=excluded.creditor_id,discount_limit=excluded.discount_limit,active=excluded.active,client_access=excluded.client_access,can_manage_users=excluded.can_manage_users,removed_at=null,expires_at=now()+interval '7 days' returning id into ident;
  perform cobranca_private.audit(p.tenant_id,'invite_member','invitations',ident,to_jsonb(inv),payload);
 end if;
 return jsonb_build_object('id',ident);
end $$;

revoke all on function cobranca_private.team(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
