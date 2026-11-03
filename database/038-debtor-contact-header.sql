begin;
create function cobranca_private.debtor_context(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.cobranca_profiles;ids uuid[];n integer;found_count integer;debtor_count integer;b public.cobranca_debtors;m jsonb;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if p.id is null or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Acesso não autorizado';end if;
 if p.role='creditor' and not coalesce((p.client_access->>'processes')::boolean,false) then raise exception 'Consulta de processos não liberada';end if;
 if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_array_length(payload->'ids')>1000 then raise exception 'Selecione até 1.000 títulos';end if;
 select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(payload->'ids');n:=cardinality(ids);
 if n=0 then return jsonb_build_object('selection_count',0,'debtor_count',0,'debtor',null);end if;
 select count(*),count(distinct d.debtor_id) into found_count,debtor_count from public.cobranca_debts d where d.id=any(ids) and d.tenant_id=p.tenant_id and cobranca_private.can_read_debt(p,d);
 if found_count<>n then raise exception 'Título não autorizado';end if;
 if debtor_count<>1 then return jsonb_build_object('selection_count',n,'debtor_count',debtor_count,'debtor',null);end if;
 select * into b from public.cobranca_debtors where id=(select d.debtor_id from public.cobranca_debts d where d.id=ids[1] and d.tenant_id=p.tenant_id) and tenant_id=p.tenant_id;
 if b.id is null then raise exception 'Devedor não encontrado';end if;
 m:=coalesce(b.metadata,'{}');
 return jsonb_build_object('selection_count',n,'debtor_count',1,'debtor',jsonb_build_object(
  'name',b.name,'document',b.document,'email',coalesce(nullif(b.email,''),m->>'email'),'phone',coalesce(nullif(b.phone,''),m->>'phone'),
  'phone2',coalesce(m->>'phone2',m->>'phone_2',m->>'telefone2'),'mobile',coalesce(m->>'mobile',m->>'cell_phone',m->>'celular'),
  'contact_phone',m->>'contact_phone','whatsapp',coalesce(m->>'whatsapp',nullif(split_part(coalesce(b.whatsapp_jid,''),'@',1),'')),'phones',coalesce(m->'phones',m->'telefones','[]'),
  'address',coalesce(m->'address',m->'endereco'),'street',coalesce(m->>'street',m->>'logradouro'),'number',coalesce(m->>'number',m->>'numero'),
  'complement',coalesce(m->>'complement',m->>'complemento'),'district',coalesce(m->>'district',m->>'neighborhood',m->>'bairro'),
  'city',coalesce(m->>'city',m->>'cidade'),'state',coalesce(m->>'state',m->>'uf'),'zip_code',coalesce(m->>'zip_code',m->>'zip',m->>'postal_code',m->>'cep')
 ));
end$$;
revoke all on function cobranca_private.debtor_context(jsonb) from public,anon,authenticated;
grant execute on function cobranca_private.debtor_context(jsonb) to authenticated;
create function public.cobranca_debtor_context(payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.debtor_context(payload)$$;
revoke all on function public.cobranca_debtor_context(jsonb) from public,anon;
grant execute on function public.cobranca_debtor_context(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
