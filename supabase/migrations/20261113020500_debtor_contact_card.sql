begin;
create table cobranca_private.debtor_contact_changes (
 id bigint generated always as identity primary key,
 tenant_id uuid not null,
 creditor_id uuid not null,
 debtor_id uuid not null,
 actor_id uuid not null,
 actor_name text not null,
 actor_role text not null,
 fields text[] not null,
 changed_at timestamptz not null default now()
);
alter table cobranca_private.debtor_contact_changes enable row level security;
revoke all on cobranca_private.debtor_contact_changes from public,anon,authenticated;
create index on cobranca_private.debtor_contact_changes(tenant_id,creditor_id,debtor_id,id desc);
create function cobranca_private.debtor_contact_card(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles; b public.cobranca_debtors; details jsonb; previous jsonb; contacts jsonb; changed text[]; log jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso negado'; end if;
 select * into b from public.cobranca_debtors where id=(payload->>'id')::uuid and tenant_id=p.tenant_id
  and (p.role<>'creditor' or creditor_id=p.creditor_id) for update;
 if not found or b.creditor_id is null then raise exception 'Cadastro indisponível';end if;
 if p.role='creditor' then
  if b.creditor_id is distinct from p.creditor_id or not coalesce((p.client_access->>'processes')::boolean,false) then raise exception 'Cadastro indisponível';end if;
 elsif p.role not in ('admin','master') then
  if p.role not in ('supervisor','collector') or not exists(select 1 from public.cobranca_debts d where d.debtor_id=b.id and d.tenant_id=b.tenant_id and d.creditor_id=b.creditor_id and cobranca_private.can_read_debt(p,d)) then raise exception 'Cadastro indisponível';end if;
 end if;
 previous:=jsonb_build_object('email',coalesce(nullif(b.email,''),b.metadata->>'email',''),'phone',coalesce(nullif(b.phone,''),b.metadata->>'phone',''),'contact_name',coalesce(b.metadata->>'contact_name',''),'contacts',coalesce(b.metadata->'additional_contacts','[]'::jsonb));
 details:=previous;
 if action='debtor_contact_card_save' then
  if payload->'expected' is distinct from previous then raise exception 'O cadastro foi atualizado por outra pessoa. Abra a ficha novamente.';end if;
  contacts:=payload->'contacts';
  if jsonb_typeof(contacts) is distinct from 'array' or jsonb_array_length(contacts)>15 then raise exception 'Informe até 15 contatos adicionais';end if;
  if exists(select 1 from jsonb_array_elements(contacts) c where jsonb_typeof(c) is distinct from 'string' or length(trim(c#>>'{}')) not between 1 and 240) then raise exception 'Confira os contatos adicionais';end if;
  if length(coalesce(payload->>'phone',''))>60 or length(coalesce(payload->>'contact_name',''))>120 or length(coalesce(payload->>'email',''))>254 or (coalesce(payload->>'email','')<>'' and (payload->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'Confira o nome, o telefone e o e-mail';end if;
  details:=jsonb_build_object('email',trim(coalesce(payload->>'email','')),'phone',trim(coalesce(payload->>'phone','')),'contact_name',trim(coalesce(payload->>'contact_name','')),'contacts',contacts);
  select array_agg(key order by key) into changed from jsonb_each(details) where value is distinct from previous->key;
  if changed is not null then
   update public.cobranca_debtors set email=nullif(details->>'email',''),phone=nullif(details->>'phone',''),metadata=(coalesce(metadata,'{}')-'email'-'phone')||jsonb_build_object('contact_name',details->>'contact_name','additional_contacts',contacts),updated_at=now() where id=b.id and tenant_id=b.tenant_id and creditor_id=b.creditor_id;
   insert into cobranca_private.debtor_contact_changes(tenant_id,creditor_id,debtor_id,actor_id,actor_name,actor_role,fields) values(b.tenant_id,b.creditor_id,b.id,p.id,coalesce(p.name,'Usuário'),p.role,changed);
  end if;
 elsif action<>'debtor_contact_card' then raise exception 'Ação indisponível';end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by id desc),'[]'::jsonb) into log from
 (select id,actor_name,actor_role,fields,changed_at from cobranca_private.debtor_contact_changes where tenant_id=b.tenant_id and creditor_id=b.creditor_id and debtor_id=b.id order by id desc limit 50) e;
 return jsonb_build_object('details',details,'log',log);
end $$;
revoke all on function cobranca_private.debtor_contact_card(text,jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.debtor_contact_card(text,jsonb) to authenticated;
do $route$
declare definition text:=pg_get_functiondef('public.cobranca_app(text,jsonb)'::regprocedure);
begin
 if position('select case' in definition)=0 then raise exception 'Roteador inesperado';end if;
 execute replace(definition,'select case','select case when action in (''debtor_contact_card'',''debtor_contact_card_save'') then cobranca_private.debtor_contact_card(action,payload)');
end $route$;
notify pgrst,'reload schema';
commit;
