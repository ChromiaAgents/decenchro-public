-- Baseline schema for Neon, transcribed from the live Supabase production
-- database on 2026-08-20 rather than replayed
-- from supabase/migrations/. Those 11 files no longer describe what shipped:
-- the credits feature was applied from the `uat` branch, `0010_erc8004.sql`
-- from `main` never was, and three columns (companies.credit_balance,
-- deployments.metered_until, deployments.llm_cost_billed) plus the
-- deployments.server_type default were changed by hand. This file is what
-- production actually looked like.
--
-- Four Supabase-only things are deliberately NOT carried over, because none of
-- them exist on plain Postgres:
--
--   * `references auth.users(id)` on companies.owner_id and deployments.owner_id.
--     Identity moves to Neon Auth, which owns its own `neon_auth` schema; the
--     link is companies.owner_email (migration 0003).
--   * every `enable row level security` and all 7 policies. The service-role
--     client bypassed RLS for all but two queries anyway, and ownership is
--     enforced in TypeScript at every route (`row.company_id !== owner.companyId`).
--   * `handle_new_user()` and its trigger on auth.users, which was the only
--     thing that ever inserted a companies row. The signup handler does it now.
--   * `rls_auto_enable()` and the `ensure_rls` event trigger, a Supabase-side
--     guard that flipped RLS on for every newly created table.

create table public.companies (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null unique,
  name                   text not null check (char_length(trim(name)) between 1 and 120),
  description            text not null default '' check (char_length(description) <= 2000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Dead Stripe columns from the retired metered-billing attempt. Kept because
  -- the rows carry values and dropping them is not this migration's job.
  stripe_customer_id     text,
  stripe_subscription_id text,
  subscription_status    text,
  metered_usd_reported   numeric not null default 0,
  metered_month          text,
  plan                   text,
  credit_balance         bigint not null default 0
);

comment on table public.companies is 'Company profile per authenticated user, captured at signup.';

create table public.deployments (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  owner_id               uuid not null,
  agent_name             text not null default 'agent',
  atbash_pubkey          text not null,
  model_id               text not null default '',
  server_type            text not null default 'cx22',
  atbash_privkey_enc     text not null,
  openrouter_key_enc     text not null,
  telegram_token_enc     text not null,
  telegram_allowed_users text not null default '',
  soul_md                text not null default '',
  -- Read-only shims for the 36 rows created before migration 0009. Nothing
  -- writes these, not even null; read ids through serviceId()/metricsBase().
  hetzner_server_id      bigint,
  hetzner_server_ip      text,
  hetzner_ssh_key_id     bigint,
  ssh_privkey_enc        text,
  status                 text not null default 'pending'
    check (status in ('pending','provisioning','running','starting','stopping','stopped','failed','deleted')),
  provision_phase        int not null default 0,
  last_seen              timestamptz,
  fail_reason            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Deliberately still accepts the retired VM providers. Narrowing this to
  -- 'render' alone would reject every historical row on its next update.
  provider               text not null default 'hetzner'
    check (provider in ('hetzner','digitalocean','render')),
  monthly_budget_usd     numeric,
  expires_at             timestamptz,
  -- Unconstrained on purpose: the catalog lives in lib/dashboard/agent-categories.ts.
  category_id            text not null default 'general',
  provider_service_id    text,
  agent_endpoint         text,
  metered_until          timestamptz,
  llm_cost_billed        numeric not null default 0
);

create index deployments_company_idx on public.deployments (company_id);
create index deployments_pubkey_idx  on public.deployments (atbash_pubkey);

create table public.contact_submissions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  company    text,
  email      text not null,
  message    text not null,
  subject    text,
  created_at timestamptz not null default now()
);

create table public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  delta         bigint not null,
  balance_after bigint not null,
  kind          text not null check (kind in ('grant','topup','runtime','llm','adjustment')),
  deployment_id uuid references public.deployments (id) on delete set null,
  ref           text,
  note          text,
  created_at    timestamptz not null default now(),
  -- The idempotency key credit_apply() relies on: a repeated (kind, ref) pair
  -- raises unique_violation, which that function swallows. `ref` is nullable
  -- and Postgres treats nulls as distinct, so unreferenced entries stack.
  unique (kind, ref)
);

create index credit_ledger_company_idx on public.credit_ledger (company_id, created_at desc);

create table public.credit_payments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  cpay_payment_id  text unique,
  pack_id          text not null,
  credits          bigint not null,
  amount_usd       numeric not null,
  settlement_asset text not null check (settlement_asset in ('chr','usdc','usdt')),
  status           text not null default 'created'
    check (status in ('created','pending','confirmed','overpaid','underpaid','expired','canceled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index credit_payments_company_idx on public.credit_payments (company_id, created_at desc);

-- Webhook de-duplication: the id is Chromia Pay's event id, so a redelivery
-- collides on the primary key instead of being processed twice.
create table public.cpay_events (
  id              text primary key,
  type            text,
  cpay_payment_id text,
  received_at     timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_touch_updated_at       before update on public.companies       for each row execute function public.touch_updated_at();
create trigger deployments_touch_updated_at     before update on public.deployments     for each row execute function public.touch_updated_at();
create trigger credit_payments_touch_updated_at before update on public.credit_payments for each row execute function public.touch_updated_at();

-- Moves the balance and writes the ledger entry in one statement, so a crash
-- between the two cannot leave a balance nobody can account for. Idempotent by
-- (kind, ref): a retried top-up hits the unique index, the exception block
-- swallows it, and the caller gets the balance that is already there.
--
-- No longer `security definer` — that existed to punch through RLS, which this
-- database does not have. It runs as the single application role.
create or replace function public.credit_apply(
  p_company    uuid,
  p_delta      bigint,
  p_kind       text,
  p_ref        text default null,
  p_deployment uuid default null,
  p_note       text default null
) returns bigint
language plpgsql
set search_path to 'public'
as $$
declare
  v_balance bigint;
begin
  begin
    update public.companies
       set credit_balance = credit_balance + p_delta
     where id = p_company
    returning credit_balance into v_balance;

    if v_balance is null then
      raise exception 'unknown company %', p_company;
    end if;

    insert into public.credit_ledger
      (company_id, delta, balance_after, kind, deployment_id, ref, note)
    values
      (p_company, p_delta, v_balance, p_kind, p_deployment, p_ref, p_note);
  exception when unique_violation then
    select credit_balance into v_balance from public.companies where id = p_company;
  end;

  return v_balance;
end;
$$;
