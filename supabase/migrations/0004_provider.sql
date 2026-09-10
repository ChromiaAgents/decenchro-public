-- decenchro — per-deployment host provider
-- The console can provision to either Hetzner or DigitalOcean, chosen per deploy
-- in the wizard. Reconcile-on-read and lifecycle control (lib/dashboard/deploy.ts,
-- app/api/agents/manage) read this column to dispatch to the right provider API.
-- The hetzner_server_id/ip/ssh_key_id columns are generic (numeric id / string
-- ip) and shared by both providers, so no per-provider column split is needed.
--
-- Run in the Supabase SQL editor (or `supabase db push`) against your project.

alter table public.deployments
  add column if not exists provider text not null default 'hetzner'
  check (provider in ('hetzner','digitalocean'));

-- Existing rows were all Hetzner (the only provider before this change); the
-- 'hetzner' default backfills them correctly. New inserts specify explicitly.
comment on column public.deployments.provider is
  'Host provider for this deployment: hetzner | digitalocean.';
