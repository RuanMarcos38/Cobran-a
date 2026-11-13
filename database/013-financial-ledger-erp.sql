-- Additive agency finance ledger. Collections portfolio remains unchanged.
create table cobranca_private.finance_titles(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),kind text not null check(kind in ('payable','receivable','invoice')),reference text not null,party text not null,creditor_id uuid references public.cobranca_creditors(id),description text not null default '',amount numeric(14,2) not null check(amount>0),due_date date not null,canceled boolean not null default false,created_by uuid not null references public.cobranca_profiles(id),created_at timestamptz not null default now(),unique(tenant_id,reference)
);
create table cobranca_private.finance_accounts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),name text not null,bank text not null,account_ref text not null,created_at timestamptz not null default now(),unique(tenant_id,account_ref));
create table cobranca_private.finance_bank_entries(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),account_id uuid not null references cobranca_private.finance_accounts(id),external_ref text not null,booked_date date not null,amount numeric(14,2) not null check(amount<>0),description text not null,created_at timestamptz not null default now(),unique(account_id,external_ref));
create table cobranca_private.finance_settlements(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),title_id uuid not null references cobranca_private.finance_titles(id),bank_entry_id uuid references cobranca_private.finance_bank_entries(id),amount numeric(14,2) not null check(amount>0),paid_date date not null,reference text not null,reason text not null,actor uuid not null references public.cobranca_profiles(id),reversed boolean not null default false,created_at timestamptz not null default now(),unique(tenant_id,reference));
create unique index finance_bank_matched on cobranca_private.finance_settlements(bank_entry_id) where not reversed and bank_entry_id is not null;
create index finance_titles_tenant on cobranca_private.finance_titles(tenant_id,kind,due_date);
create index finance_settlements_title on cobranca_private.finance_settlements(title_id) where not reversed;
create table cobranca_private.finance_credit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),creditor_id uuid not null references public.cobranca_creditors(id),credit_limit numeric(14,2) not null check(credit_limit>=0),blocked boolean not null default false,reason text not null,updated_at timestamptz not null default now(),unique(tenant_id,creditor_id));
create table cobranca_private.finance_events(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),creditor_id uuid references public.cobranca_creditors(id),actor uuid not null references public.cobranca_profiles(id),action text not null,record_id uuid not null,data jsonb not null,created_at timestamptz not null default now());
create index finance_events_customer on cobranca_private.finance_events(tenant_id,creditor_id,created_at);
create index finance_customer_titles on cobranca_private.finance_titles(tenant_id,creditor_id) where not canceled;
create index finance_bank_scope on cobranca_private.finance_bank_entries(tenant_id,booked_date);
do $$declare tab text;begin foreach tab in array array['finance_titles','finance_accounts','finance_bank_entries','finance_settlements','finance_credit','finance_events'] loop execute format('alter table cobranca_private.%I enable row level security',tab);execute format('revoke all on cobranca_private.%I from public,anon,authenticated',tab);execute format('create policy explicit_deny on cobranca_private.%I to anon,authenticated using(false) with check(false)',tab);end loop;end$$;

create function cobranca_private.finance(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare p public.cobranca_profiles;t cobranca_private.finance_titles;s cobranca_private.finance_settlements;b cobranca_private.finance_bank_entries;ident uuid;creditor uuid;value numeric;balance numeric;item jsonb;result jsonb;kind text;event text;account uuid;
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;
 if not found or p.role not in ('admin','master','finance') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Perfil financeiro não autorizado';end if;
 if action='fin_list' then
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x) order by due_date,created_at) from (select ft.*,ft.amount-coalesce((select sum(fs.amount) from cobranca_private.finance_settlements fs where fs.title_id=ft.id and not reversed),0) balance from cobranca_private.finance_titles ft where tenant_id=p.tenant_id and (coalesce(payload->>'kind','')='' or kind=payload->>'kind')) x),'[]'),'settlements',coalesce((select jsonb_agg(to_jsonb(fs) order by created_at desc) from cobranca_private.finance_settlements fs where tenant_id=p.tenant_id),'[]'),'creditors',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.cobranca_creditors where tenant_id=p.tenant_id and active),'[]'));
 elsif action='fin_save' then
  kind:=payload->>'kind';value:=nullif(payload->>'amount','')::numeric;creditor:=nullif(payload->>'creditor_id','')::uuid;
  if kind is null or kind not in ('payable','receivable','invoice') or value is null or value not between 0.01 and 999999999999.99 or value<>round(value,2) or length(trim(coalesce(payload->>'party',''))) not between 1 and 250 or length(trim(coalesce(payload->>'reference',''))) not between 1 and 200 or nullif(payload->>'due_date','')::date is null then raise exception 'Título financeiro inválido';end if;
  if creditor is not null and not exists(select 1 from public.cobranca_creditors where id=creditor and tenant_id=p.tenant_id and active) then raise exception 'Cliente inválido';end if;
  -- Serialize issuance for the same customer when a credit limit is configured.
  if kind in ('invoice','receivable') and creditor is not null then
   perform 1 from public.cobranca_creditors where id=creditor for update;
   select credit_limit into balance from cobranca_private.finance_credit where tenant_id=p.tenant_id and creditor_id=creditor;
   if found then
    if exists(select 1 from cobranca_private.finance_credit where tenant_id=p.tenant_id and creditor_id=creditor and blocked) then raise exception 'Crédito bloqueado';end if;
    select balance-coalesce(sum(ft.amount-coalesce((select sum(fs.amount) from cobranca_private.finance_settlements fs where title_id=ft.id and not reversed),0)),0) into balance from cobranca_private.finance_titles ft where tenant_id=p.tenant_id and creditor_id=creditor and kind in ('receivable','invoice') and not canceled;
    if value>balance then raise exception 'Limite de crédito insuficiente';end if;
   end if;
  end if;
  insert into cobranca_private.finance_titles(tenant_id,kind,reference,party,creditor_id,description,amount,due_date,created_by) values(p.tenant_id,kind,trim(payload->>'reference'),trim(payload->>'party'),creditor,coalesce(payload->>'description',''),value,(payload->>'due_date')::date,p.id) returning * into t;event:='title_created';result:=to_jsonb(t);ident:=t.id;
 elsif action in ('fin_settle','fin_match') then
  if action='fin_match' then
   select * into b from cobranca_private.finance_bank_entries where id=(payload->>'bank_entry_id')::uuid and tenant_id=p.tenant_id for update;if not found then raise exception 'Movimento bancário não encontrado';end if;
   if exists(select 1 from cobranca_private.finance_settlements where bank_entry_id=b.id and not reversed) then raise exception 'Movimento já conciliado';end if;
   value:=abs(b.amount);
  else value:=nullif(payload->>'amount','')::numeric;end if;
  select * into t from cobranca_private.finance_titles where id=(payload->>'id')::uuid and tenant_id=p.tenant_id for update;if not found or t.canceled then raise exception 'Título não encontrado ou cancelado';end if;
  select t.amount-coalesce(sum(amount),0) into balance from cobranca_private.finance_settlements where title_id=t.id and not reversed;
  if value is null or value not between 0.01 and balance or value<>round(value,2) or nullif(payload->>'paid_date','')::date is null or (payload->>'paid_date')::date>current_date or length(trim(coalesce(payload->>'reference',''))) not between 1 and 200 or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Baixa inválida';end if;
  if action='fin_match' and ((t.kind='payable' and b.amount>0) or (t.kind<>'payable' and b.amount<0) or b.booked_date<>(payload->>'paid_date')::date) then raise exception 'Direção ou data do extrato incompatível';end if;
  insert into cobranca_private.finance_settlements(tenant_id,title_id,bank_entry_id,amount,paid_date,reference,reason,actor) values(p.tenant_id,t.id,case when action='fin_match' then b.id else null end,value,(payload->>'paid_date')::date,trim(payload->>'reference'),payload->>'reason',p.id) returning * into s;event:='settlement';result:=to_jsonb(s);ident:=s.id;creditor:=t.creditor_id;
 elsif action='fin_reverse' then
  select * into s from cobranca_private.finance_settlements where id=(payload->>'id')::uuid and tenant_id=p.tenant_id for update;if not found or s.reversed or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Estorno inválido';end if;
  select * into t from cobranca_private.finance_titles where id=s.title_id and tenant_id=p.tenant_id for update;
  update cobranca_private.finance_settlements set reversed=true where id=s.id;event:='settlement_reversed';result:=jsonb_build_object('id',s.id,'reversed',true,'reason',payload->>'reason');ident:=s.id;creditor:=t.creditor_id;
 elsif action='fin_cancel' then
  select * into t from cobranca_private.finance_titles where id=(payload->>'id')::uuid and tenant_id=p.tenant_id for update;if not found or t.canceled or length(trim(coalesce(payload->>'reason','')))=0 or exists(select 1 from cobranca_private.finance_settlements where title_id=t.id and not reversed) then raise exception 'Cancelamento exige motivo e título sem baixas ativas';end if;
  update cobranca_private.finance_titles set canceled=true where id=t.id;event:='title_canceled';result:=jsonb_build_object('id',t.id,'reason',payload->>'reason');ident:=t.id;creditor:=t.creditor_id;
 elsif action='fin_bank' then
  if payload->>'operation'='account' then
   if length(trim(coalesce(payload->>'name','')))=0 or length(trim(coalesce(payload->>'bank','')))=0 or length(trim(coalesce(payload->>'account_ref','')))=0 then raise exception 'Conta bancária inválida';end if;
   insert into cobranca_private.finance_accounts(tenant_id,name,bank,account_ref) values(p.tenant_id,payload->>'name',payload->>'bank',payload->>'account_ref') returning id into ident;event:='bank_account';result:=jsonb_build_object('id',ident);
  elsif payload->>'operation'='import' then
   account:=(payload->>'account_id')::uuid;perform 1 from cobranca_private.finance_accounts where id=account and tenant_id=p.tenant_id for update;if not found then raise exception 'Conta bancária não encontrada';end if;
   if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 500 then raise exception 'Envie de 1 a 500 movimentos';end if;
   for item in select value from jsonb_array_elements(payload->'items') loop
    value:=nullif(item->>'amount','')::numeric;
    if value is null or abs(value) not between 0.01 and 999999999999.99 or value<>round(value,2) or length(trim(coalesce(item->>'external_ref',''))) not between 1 and 200 or nullif(item->>'booked_date','')::date is null then raise exception 'Movimento bancário inválido';end if;
    if exists(select 1 from cobranca_private.finance_bank_entries where account_id=account and external_ref=item->>'external_ref' and (amount<>value or booked_date<>(item->>'booked_date')::date)) then raise exception 'Identificador do extrato reutilizado com dados diferentes';end if;
    insert into cobranca_private.finance_bank_entries(tenant_id,account_id,external_ref,booked_date,amount,description) values(p.tenant_id,account,item->>'external_ref',(item->>'booked_date')::date,value,coalesce(item->>'description','')) on conflict(account_id,external_ref) do nothing;
   end loop;ident:=account;event:='bank_import';result:=jsonb_build_object('count',jsonb_array_length(payload->'items'));
  else
   return jsonb_build_object('accounts',coalesce((select jsonb_agg(to_jsonb(a)) from cobranca_private.finance_accounts a where tenant_id=p.tenant_id),'[]'),'rows',coalesce((select jsonb_agg(to_jsonb(x) order by booked_date) from (select be.*,exists(select 1 from cobranca_private.finance_settlements fs where bank_entry_id=be.id and not reversed) reconciled from cobranca_private.finance_bank_entries be where tenant_id=p.tenant_id) x),'[]'));
  end if;
 elsif action='fin_credit' then
  if payload->>'operation'='save' then
   creditor:=(payload->>'creditor_id')::uuid;value:=nullif(payload->>'credit_limit','')::numeric;
   perform 1 from public.cobranca_creditors where id=creditor and tenant_id=p.tenant_id and active for update;if not found or value is null or value not between 0 and 999999999999.99 or value<>round(value,2) or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Regra de crédito inválida';end if;
   insert into cobranca_private.finance_credit(tenant_id,creditor_id,credit_limit,blocked,reason) values(p.tenant_id,creditor,value,coalesce((payload->>'blocked')::boolean,false),payload->>'reason') on conflict(tenant_id,creditor_id) do update set credit_limit=excluded.credit_limit,blocked=excluded.blocked,reason=excluded.reason,updated_at=now() returning id into ident;event:='credit_changed';result:=jsonb_build_object('id',ident,'limit',value,'reason',payload->>'reason');
  else
   return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(x)) from (select cr.*,c.name,coalesce((select sum(ft.amount-coalesce((select sum(fs.amount) from cobranca_private.finance_settlements fs where title_id=ft.id and not reversed),0)) from cobranca_private.finance_titles ft where ft.creditor_id=cr.creditor_id and ft.tenant_id=p.tenant_id and kind in ('receivable','invoice') and not canceled),0) exposure from cobranca_private.finance_credit cr join public.cobranca_creditors c on c.id=cr.creditor_id where cr.tenant_id=p.tenant_id) x),'[]'));
  end if;
 elsif action='fin_history' then
  creditor:=nullif(payload->>'creditor_id','')::uuid;
  if creditor is not null and not exists(select 1 from public.cobranca_creditors where id=creditor and tenant_id=p.tenant_id) then raise exception 'Cliente não encontrado';end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc) from cobranca_private.finance_events e where tenant_id=p.tenant_id and (creditor is null or creditor_id=creditor)),'[]'),'collections',jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('processo',d.external_ref,'data',l.created_at,'canal',l.channel,'assunto',l.subject,'descricao',l.content) order by l.created_at desc) from public.cobranca_interaction_logs l join public.cobranca_debts d on d.id=l.debt_id where d.tenant_id=p.tenant_id and l.tenant_id=p.tenant_id and (creditor is null or d.creditor_id=creditor)),'[]')));
 else raise exception 'Operação financeira desconhecida';end if;
 insert into cobranca_private.finance_events(tenant_id,creditor_id,actor,action,record_id,data) values(p.tenant_id,creditor,p.id,event,ident,result);return result;
end$$;
revoke all on function cobranca_private.finance(text,jsonb) from public,anon;
grant execute on function cobranca_private.finance(text,jsonb) to authenticated;
create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select case when action like 'fin_%' then cobranca_private.finance(action,payload) else cobranca_private.api(action,payload) end$$;

-- ERP sources use a canonical contract, scoped to the existing creditor connection.
alter table cobranca_private.creditor_connections add column provider text not null default 'generic' check(provider in ('generic','sap','totvs','protheus','senior'));
alter table cobranca_private.creditor_connections add column product_version text not null default '';
create table cobranca_private.erp_events(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.cobranca_tenants(id),connection_id uuid not null references cobranca_private.creditor_connections(id),external_id text not null,request_hash text not null,result jsonb not null,created_at timestamptz not null default now(),unique(connection_id,external_id));
alter table cobranca_private.erp_events enable row level security;revoke all on cobranca_private.erp_events from public,anon,authenticated;create policy explicit_deny on cobranca_private.erp_events to anon,authenticated using(false) with check(false);
create function cobranca_private.erp_config(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.cobranca_profiles;c cobranca_private.creditor_connections;provider text:=payload->>'provider';
begin
 select * into p from public.cobranca_profiles where id=auth.uid() and active;if not found or p.role not in ('admin','master') or not exists(select 1 from public.cobranca_tenants where id=p.tenant_id and active) then raise exception 'Configuração ERP exclusiva do administrador';end if;
 if payload->>'operation'='save' then
  if provider is null or provider not in ('generic','sap','totvs','protheus','senior') or length(coalesce(payload->>'product_version',''))>200 then raise exception 'Fornecedor ERP inválido';end if;
  update cobranca_private.creditor_connections set provider=payload->>'provider',product_version=coalesce(payload->>'product_version','') where id=(payload->>'id')::uuid and tenant_id=p.tenant_id returning * into c;if not found then raise exception 'Conexão não encontrada';end if;
 end if;
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',cc.id,'name',cc.name,'creditor_name',cr.name,'provider',cc.provider,'product_version',cc.product_version,'active',cc.active,'last_received_at',cc.last_received_at)) from cobranca_private.creditor_connections cc join public.cobranca_creditors cr on cr.id=cc.creditor_id where cc.tenant_id=p.tenant_id),'[]'),'events',coalesce((select jsonb_agg(jsonb_build_object('external_id',e.external_id,'created_at',e.created_at,'result',e.result)) from cobranca_private.erp_events e where tenant_id=p.tenant_id),'[]'));
end$$;
revoke all on function cobranca_private.erp_config(jsonb) from public,anon;grant execute on function cobranca_private.erp_config(jsonb) to authenticated;
create or replace function public.cobranca_app(action text,payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select case when action='erp_config' then cobranca_private.erp_config(payload) when action like 'fin_%' then cobranca_private.finance(action,payload) else cobranca_private.api(action,payload) end$$;

create table cobranca_private.erp_outbox(seq bigserial primary key,tenant_id uuid not null references public.cobranca_tenants(id),creditor_id uuid not null references public.cobranca_creditors(id),data jsonb not null,created_at timestamptz not null default now());
create index erp_outbox_scope on cobranca_private.erp_outbox(tenant_id,creditor_id,seq);
alter table cobranca_private.erp_outbox enable row level security;revoke all on cobranca_private.erp_outbox from public,anon,authenticated;create policy explicit_deny on cobranca_private.erp_outbox to anon,authenticated using(false) with check(false);
create function cobranca_private.erp_receipt_event() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.cobranca_debts;
begin
 select * into d from public.cobranca_debts where id=new.debt_id;
 if d.creditor_id is not null then insert into cobranca_private.erp_outbox(tenant_id,creditor_id,data) values(new.tenant_id,d.creditor_id,jsonb_build_object('receipt_id',new.id,'external_ref',d.external_ref,'reference',new.reference,'amount',new.amount,'fee_amount',new.fee_amount,'paid_date',new.paid_date,'reversed',new.reversed,'origin',case when new.reason like 'ERP:%' then 'erp' else 'cobranca' end));end if;return new;
end$$;
revoke all on function cobranca_private.erp_receipt_event() from public,anon,authenticated;
create trigger cobranca_erp_receipt_event after insert or update of reversed on public.cobranca_receipts for each row execute function cobranca_private.erp_receipt_event();
create function cobranca_private.erp_sync(token text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare conn cobranca_private.creditor_connections;c public.cobranca_creditors;d public.cobranca_debts;r public.cobranca_receipts;inst public.cobranca_agreement_installments;actor uuid;t uuid;amount numeric;unallocated numeric;allocated numeric;prior cobranca_private.erp_events;result jsonb;items jsonb:='[]';item jsonb;digest text;cursor_seq bigint;
begin
 if length(coalesce(token,''))<>64 or octet_length(payload::text)>1048576 then raise exception 'Credencial ou tamanho inválidos';end if;
 select * into conn from cobranca_private.creditor_connections where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') and active for update;
 if not found or not exists(select 1 from public.cobranca_tenants where id=conn.tenant_id and active) or not exists(select 1 from public.cobranca_creditors where id=conn.creditor_id and tenant_id=conn.tenant_id and active) then raise exception 'Credencial inválida';end if;
 if payload->>'provider' is distinct from conn.provider then raise exception 'Fornecedor diferente da conexão';end if;
 t:=conn.tenant_id;
 if payload->>'operation'='poll' then
  cursor_seq:=coalesce((payload->>'cursor')::bigint,0);if cursor_seq<0 then raise exception 'Cursor inválido';end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by seq),'[]') into result from (select seq,data,created_at from cobranca_private.erp_outbox where tenant_id=t and creditor_id=conn.creditor_id and seq>cursor_seq order by seq limit 100) e;return jsonb_build_object('events',result,'cursor',coalesce((select max((e->>'seq')::bigint) from jsonb_array_elements(result) e),cursor_seq));
 end if;
 if length(trim(coalesce(payload->>'external_id',''))) not between 1 and 200 or coalesce(payload->>'operation','') not in ('overdue','payments') or jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 then raise exception 'Evento ERP inválido';end if;
 digest:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');select * into prior from cobranca_private.erp_events where connection_id=conn.id and external_id=payload->>'external_id';
 if found then if prior.request_hash<>digest then raise exception 'Evento reutilizado com dados diferentes';end if;return prior.result||jsonb_build_object('duplicate',true);end if;
 if payload->>'operation'='overdue' then
  for item in select value from jsonb_array_elements(payload->'items') loop if nullif(item->>'due_date','')::date is null or (item->>'due_date')::date>=current_date then raise exception 'Integração de cobrança aceita somente títulos vencidos';end if;end loop;
  result:=cobranca_private.bordero(token,payload);
 else
  select id into actor from public.cobranca_profiles where tenant_id=t and active and role in ('admin','master','finance') order by created_at limit 1;if actor is null then raise exception 'Operador financeiro ativo necessário';end if;
  for item in select value from jsonb_array_elements(payload->'items') loop
   select * into d from public.cobranca_debts where tenant_id=t and creditor_id=conn.creditor_id and external_ref=item->>'external_ref' for update;if not found then raise exception 'Título do credor não encontrado';end if;
   if length(trim(coalesce(item->>'reference',''))) not between 1 and 160 then raise exception 'Referência de baixa inválida';end if;
   payload:=payload||jsonb_build_object('amount',item->>'amount','paid_date',item->>'paid_date','reference','ERP:'||conn.id::text||':'||(item->>'reference'),'reason','ERP:'||conn.provider||' baixa automática');
   select * into r from public.cobranca_receipts where tenant_id=t and reference=payload->>'reference';
   if found then if r.debt_id<>d.id or r.amount is distinct from (item->>'amount')::numeric or r.paid_date is distinct from (item->>'paid_date')::date or r.reversed then raise exception 'Referência de baixa já utilizada ou estornada';end if;items:=items||jsonb_build_array(jsonb_build_object('receipt_id',r.id,'duplicate',true));continue;end if;




   if not (cobranca_private.financial_quote(d)->>'configured')::boolean then raise exception 'Regra contratual pendente: configure os encargos antes de receber';end if;
   if nullif(payload->>'paid_date','')::date is null then raise exception 'Data do recebimento obrigatória';end if;
   d.current_amount:=(cobranca_private.financial_quote(d,(payload->>'paid_date')::date)->>'total')::numeric;
   amount:=(payload->>'amount')::numeric;

   if amount is null or (payload->>'amount')::numeric<>round((payload->>'amount')::numeric,2) or amount<=0 or amount>d.current_amount or length(trim(coalesce(payload->>'reference','')))=0 or length(trim(coalesce(payload->>'reason','')))=0 then raise exception 'Recebimento inválido';end if;

   if exists(select 1 from public.cobranca_receipts where debt_id=d.id and not reversed and paid_date>(payload->>'paid_date')::date) then raise exception 'Data anterior ao último recebimento';end if;
   if (payload->>'paid_date')::date>current_date then raise exception 'Pagamento não pode estar no futuro';end if;

   select * into c from public.cobranca_creditors where id=d.creditor_id;

   insert into public.cobranca_receipts(tenant_id,debt_id,reference,amount,fee_amount,paid_date,actor,reason,calculation)

    values(t,d.id,payload->>'reference',amount,round(amount*c.fee_percent/100,2),(payload->>'paid_date')::date,actor,payload->>'reason',cobranca_private.financial_quote(d,(payload->>'paid_date')::date)) returning * into r;

   unallocated:=amount;

   for inst in select ins.* from public.cobranca_agreement_installments ins join public.cobranca_agreements ag on ag.id=ins.agreement_id

    where ag.debt_id=d.id and ag.status='active' and ins.paid_amount<ins.amount order by ins.due_date,ins.installment_number for update of ins loop

    exit when unallocated=0;

    allocated:=least(unallocated,inst.amount-inst.paid_amount);

    insert into public.cobranca_payment_allocations(receipt_id,installment_id,amount) values(r.id,inst.id,allocated);

    update public.cobranca_agreement_installments set paid_amount=paid_amount+allocated,

     status=case when paid_amount+allocated=amount then 'paid' else 'open' end,

     paid_at=case when paid_amount+allocated=amount then now() else null end where id=inst.id;

    unallocated:=unallocated-allocated;

   end loop;

   update public.cobranca_debts set current_amount=d.current_amount-amount,

    app_status=case when d.current_amount=amount then 'Quitado' else 'Parcialmente pago' end,

    status=case when d.current_amount=amount then 'paid' else status end where id=d.id;

   if amount=d.current_amount then update public.cobranca_agreements set status='paid' where debt_id=d.id and status='active';end if;


   items:=items||jsonb_build_array(jsonb_build_object('receipt_id',r.id,'duplicate',false));
  end loop;
  result:=jsonb_build_object('items',items,'count',jsonb_array_length(items),'duplicate',false);
 end if;
 insert into cobranca_private.erp_events(tenant_id,connection_id,external_id,request_hash,result) values(t,conn.id,payload->>'external_id',digest,result);update cobranca_private.creditor_connections set last_received_at=now() where id=conn.id;return result;
end$$;
revoke all on function cobranca_private.erp_sync(text,jsonb) from public;grant execute on function cobranca_private.erp_sync(text,jsonb) to anon,authenticated;
create function public.cobranca_erp_sync(token text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select cobranca_private.erp_sync(token,payload)$$;
revoke all on function public.cobranca_erp_sync(text,jsonb) from public;grant execute on function public.cobranca_erp_sync(text,jsonb) to anon,authenticated;
