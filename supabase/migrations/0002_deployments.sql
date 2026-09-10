-- decenchro — cloud agent deployment registry
-- Tracks each Hetzner VPS agent provisioned from the console: its on-chain
-- Atbash identity (the join key to the fleet), its host, status, and the
-- encrypted secrets needed to (re)provision and control it. Owned by a company
-- (one row per signed-up user, see 0001_auth_companies.sql).
--
-- Run in the Supabase SQL editor (or `supabase db push`) against your project.

create table if not exists public.deployments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  owner_id        uuid not null references auth.users (id) on delete cascade,

  -- Identity + presentation
  agent_name      text not null default 'agent',
  atbash_pubkey   text not null,            -- join key to the on-chain fleet
  model_id        text not null default '',
  server_type     text not null default 'cpx11',

  -- Secrets, AES-256-GCM encrypted at rest (lib/dashboard/crypto.ts)
  atbash_privkey_enc   text not null,
  openrouter_key_enc   text not null,
  telegram_token_enc   text not null,
  telegram_allowed_users text not null default '',
  soul_md         text not null default '',

  -- Host + control channel
  hetzner_server_id   bigint,
  hetzner_server_ip   text,
  hetzner_ssh_key_id  bigint,               -- uploaded key id (cleaned up on delete)
  ssh_privkey_enc     text,                 -- encrypted; for in-agent control (Phase 3)

  -- Lifecycle
  status          text not null default 'pending'
                  check (status in ('pending','provisioning','running','stopped','failed','deleted')),
  provision_phase int not null default 0,
  last_seen       timestamptz,
  fail_reason     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.deployments is
  'Cloud agent deployment registry: host + control metadata keyed to an on-chain Atbash identity.';

create index if not exists deployments_company_idx on public.deployments (company_id);
create index if not exists deployments_pubkey_idx on public.deployments (atbash_pubkey);

-- updated_at trigger (function defined in 0001).
drop trigger if exists deployments_touch_updated_at on public.deployments;
create trigger deployments_touch_updated_at
  before update on public.deployments
  for each row execute function public.touch_updated_at();

-- RLS: the service-role client (control-plane routes) bypasses RLS and enforces
-- ownership in code. We additionally grant owners read-only visibility for
-- defence in depth; all writes go through the service role. Secrets columns are
-- never selected by the anon/owner path.
alter table public.deployments enable row level security;

drop policy if exists "deployments_select_own" on public.deployments;
create policy "deployments_select_own" on public.deployments
  for select using (auth.uid() = owner_id);
