-- decenchro — per-agent monthly spend budget (USD). Null = no budget set.
-- The console compares this against the agent's month-to-date spend (reported by
-- its metrics endpoint): warns at 80%, and — when auto-pause is enabled — powers
-- the agent off at 100%. See lib/dashboard/agent-metrics.ts + /api/agent-budget.
--
-- Run in the Supabase SQL editor (or `supabase db push`) against your project.

alter table public.deployments
  add column if not exists monthly_budget_usd numeric;
