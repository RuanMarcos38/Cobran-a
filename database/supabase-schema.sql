-- =============================================================
-- ASSESSORIA DE COBRANÇA IA - SUPABASE / POSTGRESQL
-- Execute no SQL Editor do Supabase.
-- =============================================================

create extension if not exists "pgcrypto";

create table if not exists public.cobranca_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text,
  timezone text not null default 'America/Sao_Paulo',
  collection_start_hour int not null default 8,
  collection_end_hour int not null default 20,
  max_attempts_day int not null default 3,
  max_attempts_week int not null default 7,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobranca_creditors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cobranca_tenants(id) on delete cascade,
  name text not null,
  document text,
  email text,
  phone text,
  billing_policy jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobranca_debtors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cobranca_tenants(id) on delete cascade,
  creditor_id uuid references public.cobranca_creditors(id) on delete set null,
  name text,
  document text,
  email text,
  phone text,
  whatsapp_jid text,
  preferred_channel text not null default 'whatsapp',
  lgpd_basis text not null default 'protecao_credito',
  opt_out boolean not null default false,
  opt_out_reason text,
  dispute_status text not null default 'none', -- none | open | resolved
  human_required boolean not null default false,
  tags text[] not null default array[]::text[],
  metadata jsonb not null default '{}'::jsonb,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobranca_debts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cobranca_tenants(id) on delete cascade,
  creditor_id uuid references public.cobranca_creditors(id) on delete set null,
  debtor_id uuid not null references public.cobranca_debtors(id) on delete cascade,
  external_ref text,
  contract_ref text,
  invoice_ref text,
  description text,
  original_amount numeric(14,2) not null default 0,
  current_amount numeric(14,2) not null default 0,
  due_date date not null,
  status text not null default 'open', -- open | promised | agreement | disputed | paid | legal_review | uncollectible
  stage text not null default 'pre_due', -- pre_due | d0_d2 | d3_d6 | d7_d14 | d15_d29 | d30_plus | human
  payment_link text,
  pix_code text,
  boleto_url text,
  last_attempt_at timestamptz,
  next_action_at timestamptz,
  promised_payment_date date,
  human_required boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobranca_agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cobranca_tenants(id) on delete cascade,
  debt_id uuid not null references public.cobranca_debts(id) on delete cascade,
  debtor_id uuid not null references public.cobranca_debtors(id) on delete cascade,
  status text not null default 'pending', -- pending | active | paid | broken | canceled
  total_amount numeric(14,2) not null,
  down_payment numeric(14,2) default 0,
  installments int not null default 1,
  first_due_date date,
  notes text,
  created_by text default 'ai_agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobranca_agreement_installments (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.cobranca_agreements(id) on delete cascade,
  installment_number int not null,
  amount numeric(14,2) not null,
  due_date date not null,
  paid_at timestamptz,
  status text not null default 'open', -- open | paid | overdue | canceled
  payment_link text,
  pix_code text,
  boleto_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.cobranca_interaction_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.cobranca_tenants(id) on delete cascade,
  creditor_id uuid references public.cobranca_creditors(id) on delete set null,
  debtor_id uuid references public.cobranca_debtors(id) on delete set null,
  debt_id uuid references public.cobranca_debts(id) on delete set null,
  channel text not null, -- whatsapp | email | voice | human | system
  direction text not null, -- inbound | outbound | internal
  status text not null default 'registered', -- registered | sent | failed | blocked | escalated
  stage text,
  subject text,
  content text,
  provider_message_id text,
  compliance_flags jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cobranca_attempt_counters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.cobranca_tenants(id) on delete cascade,
  debtor_id uuid not null references public.cobranca_debtors(id) on delete cascade,
  debt_id uuid references public.cobranca_debts(id) on delete cascade,
  channel text not null,
  day date not null default current_date,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  unique (tenant_id, debtor_id, debt_id, channel, day)
);

create table if not exists public.cobranca_human_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.cobranca_tenants(id) on delete cascade,
  creditor_id uuid references public.cobranca_creditors(id) on delete set null,
  debtor_id uuid references public.cobranca_debtors(id) on delete set null,
  debt_id uuid references public.cobranca_debts(id) on delete set null,
  type text not null default 'review', -- review | call | dispute | proof_payment | negotiation | legal_review
  priority text not null default 'normal', -- low | normal | high | urgent
  title text not null,
  description text,
  status text not null default 'open', -- open | in_progress | done | canceled
  assigned_to text,
  due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobranca_payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.cobranca_tenants(id) on delete cascade,
  debt_id uuid references public.cobranca_debts(id) on delete set null,
  debtor_id uuid references public.cobranca_debtors(id) on delete set null,
  provider text,
  event_type text not null,
  amount numeric(14,2),
  paid_at timestamptz,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cobranca_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.cobranca_tenants(id) on delete cascade,
  channel text not null,
  stage text not null,
  name text not null,
  content text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cobranca_raw_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.cobranca_tenants(id) on delete cascade,
  provider text not null,
  event_type text,
  payload jsonb not null,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.cobranca_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.cobranca_tenants(id) on delete cascade,
  actor text not null default 'system',
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cobranca_debtors_phone on public.cobranca_debtors(phone);
create index if not exists idx_cobranca_debtors_email on public.cobranca_debtors(email);
create index if not exists idx_cobranca_debts_status_next on public.cobranca_debts(status, next_action_at);
create index if not exists idx_cobranca_debts_due_date on public.cobranca_debts(due_date);
create index if not exists idx_cobranca_logs_debtor_created on public.cobranca_interaction_logs(debtor_id, created_at desc);
create index if not exists idx_cobranca_tasks_status_due on public.cobranca_human_tasks(status, due_at);

create or replace function public.cobranca_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare r record;
begin
  for r in select table_name from information_schema.columns where column_name='updated_at' and table_schema='public' and table_name like 'cobranca_%'
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', r.table_name, r.table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.cobranca_touch_updated_at()', r.table_name, r.table_name);
  end loop;
end $$;

-- RLS básico. Ajuste a claim tenant_id conforme seu JWT/app.
alter table public.cobranca_tenants enable row level security;
alter table public.cobranca_creditors enable row level security;
alter table public.cobranca_debtors enable row level security;
alter table public.cobranca_debts enable row level security;
alter table public.cobranca_agreements enable row level security;
alter table public.cobranca_agreement_installments enable row level security;
alter table public.cobranca_interaction_logs enable row level security;
alter table public.cobranca_attempt_counters enable row level security;
alter table public.cobranca_human_tasks enable row level security;
alter table public.cobranca_payment_events enable row level security;
alter table public.cobranca_templates enable row level security;
alter table public.cobranca_raw_webhooks enable row level security;
alter table public.cobranca_audit_logs enable row level security;

-- Em produção, use políticas por tenant. Service Role do N8N ignora RLS.
-- Exemplo para usuários autenticados com claim app_metadata.tenant_id:
-- create policy "tenant_select_debtors" on public.cobranca_debtors for select using (tenant_id::text = auth.jwt() -> 'app_metadata' ->> 'tenant_id');

-- Seed inicial opcional
insert into public.cobranca_tenants (id, name, timezone)
values ('00000000-0000-0000-0000-000000000000', 'Assessoria de Cobrança', 'America/Sao_Paulo')
on conflict (id) do nothing;
