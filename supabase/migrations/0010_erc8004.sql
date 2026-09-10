-- 0010: ERC-8004 (Trustless Agents) identity on BNB Smart Chain.
--
-- PREREQUISITE ORDER: run this in the Supabase SQL editor (or `supabase db push`)
-- BEFORE shipping the code that writes these columns — PostgREST rejects a whole
-- update when one column is unknown, and inserts that name a missing column fail
-- outright. The code tolerates the columns' absence for reads, not for writes.
--
-- Every deployed agent gets an ERC-8004 identity NFT on BSC (testnet 97 or
-- mainnet 56), minted by its per-deployment derived wallet. Registration is
-- best-effort at deploy time and backfilled by the /api/agents/attest cron, so
-- all columns are nullable.

alter table public.deployments
  add column if not exists erc8004_agent_id bigint,
  add column if not exists erc8004_tx text,
  add column if not exists bsc_address text,
  add column if not exists erc8004_chain_id integer,
  add column if not exists erc8004_attested_at timestamptz;

comment on column public.deployments.erc8004_agent_id is
  'ERC-721 tokenId minted by the ERC-8004 IdentityRegistry; null until registered';
comment on column public.deployments.erc8004_tx is
  'transaction hash of the register() call';
comment on column public.deployments.bsc_address is
  'the agent''s derived BSC wallet address (public; the key is derived, never stored)';
comment on column public.deployments.erc8004_chain_id is
  'chain the identity lives on (97 testnet / 56 mainnet), stamped at registration';
comment on column public.deployments.erc8004_attested_at is
  'last time the attest cron anchored this agent''s audit summary on-chain';

-- Validation-registry attestations. `summary` stores the exact bytes served at
-- the on-chain requestURI/responseURI, so keccak256(summary) stays equal to the
-- on-chain hash forever — never rewrite a row's summary.
create table if not exists public.erc8004_attestations (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.deployments (id) on delete cascade,
  agent_id bigint not null,
  chain_id integer not null,
  summary text not null,
  request_hash text not null,
  request_tx text,
  response_tx text,
  response_value integer,
  created_at timestamptz not null default now()
);

create index if not exists erc8004_attestations_deployment_idx
  on public.erc8004_attestations (deployment_id, created_at desc);

-- Same posture as deployments: RLS on, service-role writes, no public policies.
-- The public attestation API route serves single rows by unguessable uuid via
-- the service-role client.
alter table public.erc8004_attestations enable row level security;
