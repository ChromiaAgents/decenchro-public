import "server-only";

import { fetchAgentMetrics } from "./agent-metrics";
import { applyCredit, getBalance } from "./credit-ledger";
import {
  CREDITS_EXHAUSTED_REASON,
  METER_INTERVAL_MS,
  llmDebit,
  projectedExpiry,
  runtimeDebit,
  settleRuntimeDebit,
} from "./credits";
import {
  listDeploymentRows,
  serviceId,
  updateDeployment,
  type DeploymentRow,
  type DeploymentStatus,
} from "./deployments";
import { isManagedProvider } from "./deploy-types";
import { hostClient } from "./host";

const LIVE: DeploymentStatus[] = ["running", "starting"];

const lastLlmCheck = new Map<string, number>();
const lastMeter = new Map<string, number>();

const EXPIRY_DRIFT_MS = 60 * 1000;

function isLive(row: DeploymentRow): boolean {
  return LIVE.includes(row.status);
}

function expiryMoved(current: string | null, next: string | null): boolean {
  if (next === null) return current !== null;
  if (!current) return true;
  const a = Date.parse(current);
  if (!Number.isFinite(a)) return true;
  return Math.abs(Date.parse(next) - a) > EXPIRY_DRIFT_MS;
}

// `settle` closes the session out instead of metering it in place: the tail is
// billed to the next whole block and the cursor jumps to now, because after this
// there is no further tick to carry a remainder into.
async function meterRow(
  row: DeploymentRow,
  opts: { settle?: boolean } = {},
): Promise<void> {
  const now = Date.now();
  const patch: Partial<DeploymentRow> = {};

  const stamped = row.metered_until ? Date.parse(row.metered_until) : NaN;
  const meteredUntil = Number.isFinite(stamped) ? stamped : now;
  const runtime = opts.settle
    ? settleRuntimeDebit(meteredUntil, now)
    : runtimeDebit(meteredUntil, now);

  if (runtime.credits > 0) {
    await applyCredit({
      companyId: row.company_id,
      delta: -runtime.credits,
      kind: "runtime",
      // Keyed on where the span STARTED, not where it ended, for a settle: a
      // settle's end cursor is wall-clock now, unique per call, so two
      // concurrent settles of the same session both inserted (three -$1.81
      // "final block" rows, staging, 2026-09-01). The start cursor is the same
      // stale value in every racer, so the (kind, ref) unique index absorbs
      // the duplicates the way it already does for ticks.
      ref: opts.settle
        ? `${row.id}:settle:${meteredUntil}`
        : `${row.id}:${runtime.meteredUntilMs}`,
      deploymentId: row.id,
      note: `${row.agent_name} runtime${opts.settle ? ", final block" : ""}`,
    });
  }
  if (!row.metered_until || runtime.credits > 0 || opts.settle) {
    patch.metered_until = new Date(runtime.meteredUntilMs).toISOString();
  }

  // The throttle keeps a busy dashboard from hammering the agent for metrics. A
  // settle has no later tick to defer to, so it always reconciles, and it does
  // so while the service is still up and can answer.
  if (opts.settle || (lastLlmCheck.get(row.id) ?? 0) + METER_INTERVAL_MS <= now) {
    lastLlmCheck.set(row.id, now);
    const result = await fetchAgentMetrics(row);
    if (result.ok) {
      const billed = Number(row.llm_cost_billed ?? 0);
      const llm = llmDebit(result.metrics.tokens.costUsd, billed);
      if (llm.credits > 0) {
        await applyCredit({
          companyId: row.company_id,
          delta: -llm.credits,
          kind: "llm",
          ref: `${row.id}:${llm.billedUsd.toFixed(6)}`,
          deploymentId: row.id,
          note: `${row.agent_name} model usage`,
        });
        patch.llm_cost_billed = llm.billedUsd;
      }
    }
  }

  if (Object.keys(patch).length) {
    await updateDeployment(row.id, patch);
    // The caller's object has to match what was just written: meterCompany
    // ticks a row and then may settle the SAME object via pauseForCredits, and
    // a stale metered_until there re-bills the span the tick just charged.
    Object.assign(row, patch);
  }
}

// Close a running session out before the service stops answering. Never throws:
// a metering failure must not be able to block an operator stopping their agent,
// or block a teardown that is freeing paid infrastructure.
export async function settleDeploymentSafe(row: DeploymentRow): Promise<void> {
  if (!isLive(row)) return;
  try {
    await meterRow(row, { settle: true });
  } catch (err) {
    console.log(
      `[AUDIT] settle skipped deployment=${row.id} reason=${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
}

export async function pauseForCredits(row: DeploymentRow): Promise<boolean> {
  // Retired-provider rows have no client to power off; they are settled by
  // teardownDeployment, not here, so leave them alone rather than casting.
  const id = serviceId(row);
  if (!isLive(row) || !id || !isManagedProvider(row.provider)) return false;
  try {
    await settleDeploymentSafe(row);
    await hostClient(row.provider).powerAction(id, "poweroff");
    const patch = {
      fail_reason: CREDITS_EXHAUSTED_REASON,
      expires_at: null,
      metered_until: null,
    };
    await updateDeployment(row.id, { status: "stopping", ...patch }).catch(() =>
      updateDeployment(row.id, { status: "stopped", ...patch }),
    );
    console.log(
      `[AUDIT] credits pause deployment=${row.id} company=${row.company_id}`,
    );
    return true;
  } catch {
    return false;
  }
}

export async function meterCompany(
  companyId: string,
  rows?: DeploymentRow[],
): Promise<number> {
  const all = rows ?? (await listDeploymentRows(companyId));
  const live = all.filter(isLive);
  if (!live.length) return getBalance(companyId);

  for (const row of live) await meterRow(row);

  const balance = await getBalance(companyId);
  const expiry = projectedExpiry(balance, live.length, Date.now());
  for (const row of live) {
    if (balance <= 0) await pauseForCredits(row);
    else if (expiryMoved(row.expires_at, expiry))
      await updateDeployment(row.id, { expires_at: expiry });
  }
  return balance;
}

/**
 * Meter on the read path, but not on every read.
 *
 * The console polls /api/agents every 15 seconds, and metering writes: it
 * applies ledger entries and stamps metered_until and expires_at. Running it
 * per poll meant four write cycles a minute per open tab, which is why the
 * console dominated Supabase call volume. The hourly cron is what guarantees
 * metering happens; this exists only so a balance change shows in the console
 * without waiting for it.
 *
 * The window is held in memory, so each serverless instance keeps its own. That
 * caps the damage rather than eliminating it, which is the right trade here: the
 * cron is the guarantee, this is the courtesy.
 *
 * Returns true when it ran, so the caller knows any rows it already holds are
 * now stale.
 */
export async function meterCompanyThrottled(
  companyId: string,
  rows?: DeploymentRow[],
): Promise<boolean> {
  const now = Date.now();
  if ((lastMeter.get(companyId) ?? 0) + METER_INTERVAL_MS > now) return false;
  // Stamped before the work, so two concurrent polls cannot both run it.
  lastMeter.set(companyId, now);
  await meterCompanySafe(companyId, rows);
  return true;
}

export async function meterCompanySafe(
  companyId: string,
  rows?: DeploymentRow[],
): Promise<void> {
  try {
    await meterCompany(companyId, rows);
  } catch (err) {
    console.log(
      `[AUDIT] metering skipped company=${companyId} reason=${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
}
