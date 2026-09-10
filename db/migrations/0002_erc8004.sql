-- ERC-8004 identity + attestation anchoring, translated from
-- supabase/migrations/0010_erc8004.sql minus its RLS statement.
--
-- Applied here even though production never had it. On Supabase the absence was
-- survivable: PostgREST reported an unknown column and
-- updateDeploymentTolerant() retried with these stripped, while eight read
-- helpers caught the error and returned []. Drizzle has no such fallback, so
-- the columns have to exist for lib/dashboard/bsc.ts and the attest cron to
-- typecheck. They arrive empty; nothing behaves differently until an agent
-- registers.

alter table public.deployments
  add column erc8004_agent_id     bigint,
  add column erc8004_tx           text,
  add column bsc_address          text,
  add column erc8004_chain_id     integer,
  add column erc8004_attested_at  timestamptz;

comment on column public.deployments.erc8004_agent_id is 'ERC-8004 registry token id (NFT), null until registered.';
comment on column public.deployments.bsc_address is 'Per-deployment BSC wallet, derived from ENCRYPTION_KEY and never stored as a key.';

create table public.erc8004_attestations (
  id             uuid primary key default gen_random_uuid(),
  deployment_id  uuid not null references public.deployments (id) on delete cascade,
  agent_id       bigint not null,
  chain_id       integer not null,
  -- The EXACT bytes served at /api/agents/attestation/<id>. keccak256 of this
  -- string is what went on-chain, so rewriting it invalidates the attestation.
  summary        text not null,
  request_hash   text not null,
  request_tx     text,
  response_tx    text,
  response_value integer,
  created_at     timestamptz not null default now()
);

create index erc8004_attestations_deployment_idx
  on public.erc8004_attestations (deployment_id, created_at desc);
