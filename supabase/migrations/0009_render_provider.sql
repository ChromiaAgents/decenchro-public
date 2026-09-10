-- decenchro — Render as a third host provider
--
-- Render is container-backed rather than VM-backed, which breaks two assumptions
-- baked into the deployments table when both providers were VPS vendors:
--
--   1. Service ids are strings ("srv-cv1234abcd..."), not bigints. The existing
--      hetzner_server_id column stays authoritative for DigitalOcean and Hetzner
--      (it is read by scripts/deployment-status.mjs and by every historical row);
--      provider_service_id is the provider-agnostic id every new row also writes.
--   2. There is no public IP. A Render service is reachable only at its own
--      HTTPS hostname, on one port. agent_endpoint stores the metrics base URL so
--      the console stops assembling `http://<ip>:9484` by hand.
--
-- Both columns are additive and nullable, and the readers fall back to the old
-- ones, so this migration is safe to apply before the code that writes them.
--
-- Run in the Supabase SQL editor (or `supabase db push`) against your project.
--
-- Wrapped in an explicit transaction so the constraint swap below is atomic:
-- between DROP and ADD there is momentarily no provider constraint, and an
-- explicit BEGIN removes that window instead of relying on the client batching
-- the statements into one implicit transaction. lock_timeout keeps a DDL lock
-- wait from stalling live dashboard reads — if the table is busy this aborts and
-- rolls back rather than queueing behind a long query.
begin;
set local lock_timeout = '5s';

alter table public.deployments
  add column if not exists provider_service_id text,
  add column if not exists agent_endpoint text;

comment on column public.deployments.provider_service_id is
  'Provider-agnostic server/service id. Numeric for DigitalOcean/Hetzner droplets, srv-* for Render services.';
comment on column public.deployments.agent_endpoint is
  'Base URL of the agent metrics endpoint, e.g. http://1.2.3.4:9484 or https://name.onrender.com.';

-- Backfill so existing rows resolve through the new columns from the first read.
update public.deployments
   set provider_service_id = hetzner_server_id::text
 where provider_service_id is null
   and hetzner_server_id is not null;

update public.deployments
   set agent_endpoint = 'http://' || hetzner_server_ip || ':9484'
 where agent_endpoint is null
   and hetzner_server_ip is not null;

-- Widen the provider check-constraint. The constraint was created inline by
-- migration 0004, so Postgres named it automatically; find and drop whichever
-- check constraint covers `provider` rather than guessing the name.
do $$
declare
  con_name text;
begin
  select conname into con_name
    from pg_constraint
   where conrelid = 'public.deployments'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%provider%'
     and pg_get_constraintdef(oid) ilike '%hetzner%'
   limit 1;

  if con_name is not null then
    execute format('alter table public.deployments drop constraint %I', con_name);
  end if;
end $$;

alter table public.deployments
  add constraint deployments_provider_check
  check (provider in ('hetzner','digitalocean','render'));

comment on column public.deployments.provider is
  'Host provider for this deployment: hetzner | digitalocean | render.';

commit;
