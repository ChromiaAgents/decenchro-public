-- decenchro — transient lifecycle states (AWS EC2-style state machine)
-- stop/start are async power actions on Hetzner: the row enters a transient
-- state (stopping/starting) immediately and is settled to stopped/running by
-- reconcile-on-read against the Hetzner API (lib/dashboard/deploy.ts).
--
-- Run in the Supabase SQL editor (or `supabase db push`) against your project.

alter table public.deployments
  drop constraint if exists deployments_status_check;

alter table public.deployments
  add constraint deployments_status_check
  check (status in (
    'pending','provisioning','running',
    'starting','stopping','stopped',
    'failed','deleted'
  ));
