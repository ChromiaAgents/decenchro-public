-- decenchro — Stripe metered billing, anchored on the company (tenant) row.
-- The company is the Stripe customer; its metered subscription is billed on
-- month-to-date LLM spend summed across its agents (reported by the
-- /api/stripe/report-usage cron). See lib/stripe/billing.ts.
--
-- All columns nullable / defaulted so existing rows migrate cleanly.
-- Run in the Supabase SQL editor (or `supabase db push`) against your project.

alter table public.companies
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  -- active | past_due | canceled | null (null = never subscribed)
  add column if not exists subscription_status text,
  -- Idempotency cursor for meter reporting: cumulative USD already reported to
  -- Stripe for the period named by metered_month. The cron sends only the
  -- delta above this, so re-runs with unchanged spend send nothing.
  add column if not exists metered_usd_reported numeric not null default 0,
  -- 'YYYY-MM' (UTC) the cursor belongs to; a change resets metered_usd_reported.
  add column if not exists metered_month text;
