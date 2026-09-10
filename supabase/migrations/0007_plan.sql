-- decenchro — tier-based plans, replacing metered billing.
-- A company is on a plan: 'pro' (self-serve, one agent, 1-hour runtime) or
-- 'enterprise' (managed, many agents — set manually / via sales). null = no
-- plan chosen yet, so the deploy surface shows the tier picker.
--
-- Pro agents carry an `expires_at` on the deployment row; reconcile-on-read and
-- the /api/agents/expire cron tear the server down once it passes. Enterprise
-- agents get a null expires_at (never auto-removed). See lib/dashboard/plan.ts.
--
-- All columns nullable / defaulted so existing rows migrate cleanly. Run in the
-- Supabase SQL editor (or `supabase db push`) against your project.

alter table public.companies
  -- 'pro' | 'enterprise' | null (null = never chose a plan)
  add column if not exists plan text;

alter table public.deployments
  -- When a Pro agent should be torn down (created_at + 1h). null = never.
  add column if not exists expires_at timestamptz;

-- The old metered-billing columns (stripe_customer_id, stripe_subscription_id,
-- subscription_status, metered_usd_reported, metered_month) from 0006 are no
-- longer read. Left in place so this migration is non-destructive; drop them
-- manually if you want the columns gone.
