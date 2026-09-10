import "server-only";
import { createHmac } from "node:crypto";

import {
  metricsBase,
  serviceId,
  updateDeployment,
  type DeploymentRow,
} from "./deployments";
import { isManagedProvider } from "./deploy-types";
import { hostClient } from "./host";

// Default port for the agent metrics endpoint (see cloud-init/agent-metrics.py).
// Used for VM providers, where it is opened in the firewall at provision time; a
// container host publishes it on the platform's own port instead, so the stored
// agent_endpoint wins whenever it is set.
export const METRICS_PORT = 9484;

// Per-deployment bearer for the metrics endpoint, DERIVED rather than stored: an
// HMAC of the deployment id under ENCRYPTION_KEY. The provisioner injects it
// into the VPS and the console recomputes it here, so both sides agree with no
// extra secret column. Stable for the life of the deployment.
export function metricsToken(deploymentId: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY must be at least 32 characters");
  }
  return createHmac("sha256", key).update(`decenchro-metrics:${deploymentId}`).digest("hex");
}

export type AgentSession = {
  source: string;
  model: string | null;
  messages: number;
  toolCalls: number;
  cost: number;
  startedAt: number | null;
  title: string | null;
};

export type AgentMetrics = {
  ok: boolean;
  collectedAt: number | null;
  totals: {
    sessions: number;
    activeSessions: number;
    messages: number;
    toolCalls: number;
    lastActive: number | null;
  };
  last24h: { messages: number; toolCalls: number; sessions: number };
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
  };
  spendMonth: number;
  /**
   * Whether an owner has been paired yet (the claim sentinel exists on the
   * agent's disk). null from an image built before the field existed.
   *
   * Load-bearing for the console, not decoration: Hermes gates unknown Telegram
   * users through its pairing files, so an unclaimed agent answers nobody and
   * looks identical to an agent nobody has used.
   */
  claimed: boolean | null;
  bySource: { source: string; sessions: number; messages: number }[];
  byModel: { model: string; sessions: number }[];
  daily: { date: string; messages: number; cost: number }[];
  sessions: AgentSession[];
  recent: { ts: number; role: string; tool: string | null; source: string }[];
  hermesVersion: string | null;
  gateway: {
    state: string | null;
    activeAgents: number | null;
    updatedAt: string | null;
    platforms: Record<string, { state: string | null; errorCode: string | null }>;
  } | null;
};

export type AgentMetricsResult =
  | { ok: true; metrics: AgentMetrics }
  | { ok: false; reason: string };

// Raw shape returned by cloud-init/agent-metrics.py (snake_case).
type RawMetrics = {
  ok?: boolean;
  collected_at?: number;
  totals?: Record<string, number>;
  last24h?: Record<string, number>;
  tokens?: Record<string, number>;
  spend_month?: number;
  by_source?: { source: string; sessions: number; messages: number }[];
  by_model?: { model: string; sessions: number }[];
  daily?: { date: string; messages: number; cost: number }[];
  sessions?: {
    source: string;
    model: string | null;
    messages: number;
    tool_calls: number;
    cost: number;
    started_at: number | null;
    title: string | null;
  }[];
  recent?: { ts: number; role: string; tool: string | null; source: string }[];
  hermes_version?: string | null;
  claimed?: boolean;
  gateway?: {
    state?: string;
    active_agents?: number;
    updated_at?: string;
    platforms?: Record<string, { state?: string; error_code?: string }>;
  } | null;
};

function normalize(raw: RawMetrics): AgentMetrics {
  const t = raw.totals ?? {};
  const d = raw.last24h ?? {};
  const k = raw.tokens ?? {};
  const g = raw.gateway;
  return {
    ok: raw.ok !== false,
    collectedAt: raw.collected_at ?? null,
    totals: {
      sessions: t.sessions ?? 0,
      activeSessions: t.active_sessions ?? 0,
      messages: t.messages ?? 0,
      toolCalls: t.tool_calls ?? 0,
      lastActive: t.last_active || null,
    },
    last24h: {
      messages: d.messages ?? 0,
      toolCalls: d.tool_calls ?? 0,
      sessions: d.sessions ?? 0,
    },
    tokens: {
      input: k.input ?? 0,
      output: k.output ?? 0,
      cacheRead: k.cache_read ?? 0,
      cacheWrite: k.cache_write ?? 0,
      costUsd: k.cost_usd ?? 0,
    },
    spendMonth: raw.spend_month ?? 0,
    // ?? null, not ?? false: an older image omits the key entirely, and
    // rendering "unclaimed" for an agent that has been happily paired for weeks
    // would be worse than saying nothing.
    claimed: raw.claimed ?? null,
    bySource: raw.by_source ?? [],
    byModel: raw.by_model ?? [],
    daily: raw.daily ?? [],
    sessions: (raw.sessions ?? []).map((s) => ({
      source: s.source,
      model: s.model,
      messages: s.messages,
      toolCalls: s.tool_calls,
      cost: s.cost,
      startedAt: s.started_at,
      title: s.title,
    })),
    recent: raw.recent ?? [],
    hermesVersion: raw.hermes_version ?? null,
    gateway: g
      ? {
          state: g.state ?? null,
          activeAgents: g.active_agents ?? null,
          updatedAt: g.updated_at ?? null,
          platforms: Object.fromEntries(
            Object.entries(g.platforms ?? {}).map(([n, p]) => [
              n,
              { state: p.state ?? null, errorCode: p.error_code ?? null },
            ]),
          ),
        }
      : null,
  };
}

// ─── Budget ──────────────────────────────────────────────────
// Warn at 80% of the monthly budget, auto-pause at 100% (user decision).
export const BUDGET_WARN_AT = 0.8;

export type BudgetLevel = "none" | "ok" | "warn" | "over";

export type BudgetInfo = {
  budgetUsd: number | null;
  spentUsd: number; // month-to-date
  pct: number | null; // spent / budget
  level: BudgetLevel;
  paused: boolean; // true when this read/enforcement just powered the agent off
};

export function budgetInfo(budgetUsd: number | null, spentUsd: number): BudgetInfo {
  if (!budgetUsd || budgetUsd <= 0)
    return { budgetUsd: budgetUsd ?? null, spentUsd, pct: null, level: "none", paused: false };
  const pct = spentUsd / budgetUsd;
  const level: BudgetLevel = pct >= 1 ? "over" : pct >= BUDGET_WARN_AT ? "warn" : "ok";
  return { budgetUsd, spentUsd, pct, level, paused: false };
}

/**
 * Auto-pause: when month-to-date spend reaches the budget and the agent is
 * running, power its server off to stop further spend. Returns true if it
 * triggered a pause. Safe to call on every read and from the cron — a no-op
 * unless a budget is set, exceeded, and the agent is up.
 */
export async function enforceAgentBudget(
  row: Pick<
    DeploymentRow,
    | "id"
    | "status"
    | "provider"
    | "hetzner_server_id"
    | "provider_service_id"
    | "monthly_budget_usd"
  >,
  spentUsd: number,
): Promise<boolean> {
  const budget = row.monthly_budget_usd ?? null;
  if (!budget || budget <= 0 || spentUsd < budget) return false;
  if (row.status !== "running" && row.status !== "starting") return false;
  const id = serviceId(row);
  if (!id) return false;
  // A retired-provider row cannot be paused: there is no client left to call. It
  // also cannot spend on the platform key any more than it already is, so this
  // reports "not paused" rather than throwing inside a read path.
  if (!isManagedProvider(row.provider)) return false;
  try {
    // "Power off" is suspend on a container host — same meaning: stop the spend,
    // keep the state.
    await hostClient(row.provider).powerAction(id, "poweroff");
    // Transient state; reconcile-on-read settles it. Fall back if the DB's
    // status check-constraint predates the transient states (migration 0003).
    await updateDeployment(row.id, { status: "stopping" }).catch(() =>
      updateDeployment(row.id, { status: "stopped" }),
    );
    console.log(
      `[AUDIT] budget auto-pause deployment=${row.id} spent=${spentUsd} budget=${budget}`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pull live activity from a deployed agent's metrics endpoint. Degrades to
 * ok:false with a reason (no IP yet, unreachable, timeout, auth) so the UI can
 * show an honest "can't reach the agent" state instead of throwing.
 */
export async function fetchAgentMetrics(
  row: Pick<DeploymentRow, "id" | "hetzner_server_ip" | "agent_endpoint">,
): Promise<AgentMetricsResult> {
  // Base URL rather than an IP: a VM answers on http://<ip>:9484, a Render
  // service on its own HTTPS hostname with no port.
  const base = metricsBase(row, METRICS_PORT);
  if (!base) return { ok: false, reason: "no server address yet" };

  let token: string;
  try {
    token = metricsToken(row.id);
  } catch {
    return { ok: false, reason: "ENCRYPTION_KEY not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/metrics`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        reason:
          res.status === 401 ? "metrics auth rejected" : `metrics HTTP ${res.status}`,
      };
    }
    const raw = (await res.json()) as RawMetrics;
    return { ok: true, metrics: normalize(raw) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: /abort/i.test(msg) ? "metrics timeout" : "agent unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
