alter table public.companies
  add column if not exists credit_balance bigint not null default 0;

alter table public.deployments
  add column if not exists metered_until timestamptz,
  add column if not exists llm_cost_billed numeric not null default 0;

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  delta bigint not null,
  balance_after bigint not null,
  kind text not null check (kind in ('grant', 'topup', 'runtime', 'llm', 'adjustment')),
  deployment_id uuid references public.deployments(id) on delete set null,
  ref text,
  note text,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);

create index if not exists credit_ledger_company_idx
  on public.credit_ledger (company_id, created_at desc);

create table if not exists public.credit_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cpay_payment_id text unique,
  pack_id text not null,
  credits bigint not null,
  amount_usd numeric not null,
  settlement_asset text not null check (settlement_asset in ('chr', 'usdc', 'usdt')),
  status text not null default 'created'
    check (status in ('created', 'pending', 'confirmed', 'overpaid', 'underpaid', 'expired', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_payments_company_idx
  on public.credit_payments (company_id, created_at desc);

drop trigger if exists credit_payments_touch_updated_at on public.credit_payments;
create trigger credit_payments_touch_updated_at
  before update on public.credit_payments
  for each row execute function public.touch_updated_at();

create table if not exists public.cpay_events (
  id text primary key,
  type text,
  cpay_payment_id text,
  received_at timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;
alter table public.credit_payments enable row level security;
alter table public.cpay_events enable row level security;

drop policy if exists "credit_ledger_select_own" on public.credit_ledger;
create policy "credit_ledger_select_own" on public.credit_ledger
  for select using (
    exists (
      select 1 from public.companies c
      where c.id = credit_ledger.company_id and c.owner_id = auth.uid()
    )
  );

drop policy if exists "credit_payments_select_own" on public.credit_payments;
create policy "credit_payments_select_own" on public.credit_payments
  for select using (
    exists (
      select 1 from public.companies c
      where c.id = credit_payments.company_id and c.owner_id = auth.uid()
    )
  );

create or replace function public.credit_apply(
  p_company uuid,
  p_delta bigint,
  p_kind text,
  p_ref text default null,
  p_deployment uuid default null,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
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
