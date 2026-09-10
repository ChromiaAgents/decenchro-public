-- When an agent actually started running, as opposed to when its row was created.
--
-- The console's "Uptime" column counted from created_at, which is the moment the
-- operator pressed Deploy. That put the whole provisioning window (measured at
-- 75s on Render, longer when a deploy retries or stalls) inside a number
-- labelled uptime, and for an agent the platform later paused and resumed it
-- counted the downtime too. Billing was never affected — metering only ever
-- looks at rows whose status is running/starting and opens its cursor at that
-- moment — so this is a display correctness fix, not a revenue one.
--
-- Nullable with no backfill on purpose. NULL means "we did not record a start
-- for this row", and the UI falls back to created_at for it, which is exactly
-- the old behaviour. Inventing a value from created_at or last_seen would bake
-- the wrong answer in permanently and be indistinguishable from a real one.
alter table deployments add column if not exists started_at timestamptz;

comment on column deployments.started_at is
  'When the agent last entered running state (deploy webhook status=ready, or a resume). NULL for rows created before this column existed; the console falls back to created_at.';
