-- decenchro — agent category on each deployment
-- Which curated category an agent was deployed as (see
-- lib/dashboard/agent-categories.ts). The catalog lives in code, so this column
-- is deliberately unconstrained text: adding a category should be a pull
-- request, not a migration. Validation happens server-side in /api/deploy.
--
-- Fixed at deploy (user decision 2026-08-11): nothing updates this column after
-- insert, so an agent's category cannot drift from the SOUL.md it booted with.
--
-- PREREQUISITE: apply this BEFORE shipping the code that writes category_id, or
-- every deploy insert fails on an unknown column.
--
-- Run in the Supabase SQL editor (or `supabase db push`) against your project.

alter table public.deployments
  add column if not exists category_id text not null default 'general';

comment on column public.deployments.category_id is
  'Curated agent category id chosen at deploy (general | research | web3). Catalog defined in lib/dashboard/agent-categories.ts; set once, never updated.';
