import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

import { readAuth } from "./atbash-auth";
import { resolveOrgName } from "./atbash-org";
import { fetchOrgToolCalls } from "./atbash";
import { getStatus } from "./hermes-control";
import { HERMES_DIR, HERMES_ENV } from "./paths";
import { fetchBotInfo } from "./telegram";

type SdkModule = typeof import("@atbash/sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

// No platform-wide spend field. This type used to carry the PLATFORM OpenRouter
// key's own totalUsage/totalCredits, which is every tenant's model spend added
// together — nothing rendered it, and rendering it would have shown one customer
// the whole fleet's bill. Per-agent cost comes from that agent's own metrics
// (AgentMetrics.spendMonth); what the tenant owes is the credit ledger.
export type Analytics = {
  toolCalls: { total: number | null; recent24h: number | null };
  blocked: { total: number | null };
  // Risk posture from Atbash getSafetyStats — the SAME source the Atbash tab
  // renders, so the headline KPIs can never disagree with the safety record.
  safety: {
    checked: number | null; // judged actions (green+yellow+red)
    allowed: number | null; // green
    flagged: number | null; // yellow — held for approval
    highRisk: number | null; // red
    total: number | null; // total tool calls Atbash has seen
  };
  sessions: {
    activeAgents: number | null;
    allowlisted: number | null;
    telegram: "connected" | "disconnected" | "unknown";
    gatewayRunning: boolean;
  };
  bot: { username: string | null; firstName: string | null };
  tier: { name: string | null; verdictsEnabled: boolean | null };
  errors: string[];
};

const GATEWAY_STATE = path.join(HERMES_DIR, "gateway_state.json");

type GatewayStateFile = {
  active_agents?: number;
  gateway_state?: string;
  platforms?: Record<
    string,
    { state?: string; error_code?: string | null }
  >;
};

async function readAllowlistCount(): Promise<number | null> {
  try {
    const raw = await fs.readFile(HERMES_ENV, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^TELEGRAM_ALLOWED_USERS=(.+)$/.exec(line);
      if (!m) continue;
      const ids = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s));
      return ids.length;
    }
    return 0;
  } catch {
    return null;
  }
}

async function readGatewayState(): Promise<GatewayStateFile | null> {
  try {
    const raw = await fs.readFile(GATEWAY_STATE, "utf8");
    return JSON.parse(raw) as GatewayStateFile;
  } catch {
    return null;
  }
}

export async function fetchAnalytics(): Promise<Analytics> {
  const errors: string[] = [];
  const out: Analytics = {
    toolCalls: { total: null, recent24h: null },
    blocked: { total: null },
    safety: { checked: null, allowed: null, flagged: null, highRisk: null, total: null },
    sessions: {
      activeAgents: null,
      allowlisted: null,
      telegram: "unknown",
      gatewayRunning: false,
    },
    bot: { username: null, firstName: null },
    tier: { name: null, verdictsEnabled: null },
    errors,
  };

  const sdk = await loadSdk();
  // Signed-bearer auth for the gated Atbash read API (undefined ⇒ reads 401 and
  // degrade to nulls).
  const auth = await readAuth();
  const ORG_NAME = await resolveOrgName(auth);

  // Atbash: total tool-call count + tier. Each read below needs the signed
  // bearer; with no auth they only 401, and Atbash caps auth failures at 12/min
  // per IP (the dashboard polls on a timer), so guard each to skip the call and
  // leave the null defaults rather than burning the limit into a 429.
  await Promise.all([
    (async () => {
      if (!auth) return;
      try {
        const cnt = await sdk.getToolCallCount({ auth });
        out.toolCalls.total = typeof cnt === "number" ? cnt : null;
      } catch (err) {
        errors.push(
          `atbash count: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    })(),
    (async () => {
      if (!auth) return;
      // Same call the Atbash/Governance tab uses — keeps the headline numbers
      // identical to the safety record there.
      try {
        const s = (await sdk.getSafetyStats({ auth })) as Record<string, number>;
        const green = s.green_count ?? 0;
        const yellow = s.yellow_count ?? 0;
        const red = s.red_count ?? 0;
        out.safety = {
          checked: s.total_judgments ?? green + yellow + red,
          allowed: green,
          flagged: yellow,
          highRisk: red,
          total: s.total_tool_calls ?? null,
        };
      } catch (err) {
        errors.push(
          `atbash safety: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    })(),
    (async () => {
      if (!auth) return;
      try {
        const sub = (await sdk.getOrgSubscription(ORG_NAME, { auth })) as {
          subscription_name?: string;
          is_active?: boolean;
        } | null;
        out.tier.name = sub?.subscription_name ?? null;
        out.tier.verdictsEnabled = Boolean(sub?.is_active);
      } catch (err) {
        errors.push(
          `atbash tier: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    })(),
    (async () => {
      try {
        // Every agent is remote, so "recent activity" is the org-wide feed, not
        // one host's. Most recent 100 records, filtered by 24h + blocks.
        const recent = await fetchOrgToolCalls(100);
        if (recent.ok) {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          let recent24h = 0;
          let blocked = 0;
          for (const r of recent.records) {
            const t = r.createdAt ? Date.parse(r.createdAt) : NaN;
            if (Number.isFinite(t) && t >= cutoff) recent24h++;
            if (r.verdict?.toUpperCase() === "BLOCK") blocked++;
          }
          out.toolCalls.recent24h = recent24h;
          out.blocked.total = blocked;
        }
      } catch (err) {
        errors.push(
          `atbash recent: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    })(),
    (async () => {
      const bot = await fetchBotInfo();
      if (bot.ok) {
        out.bot.username = bot.username;
        out.bot.firstName = bot.firstName;
      }
    })(),
    (async () => {
      const [gs, status, allow] = await Promise.all([
        readGatewayState(),
        getStatus(),
        readAllowlistCount(),
      ]);
      out.sessions.allowlisted = allow;
      out.sessions.gatewayRunning = status.state === "running";
      // gateway_state.json isn't cleared on dirty exits — only trust it when
      // a live `hermes gateway run` process actually exists.
      if (status.state !== "running") {
        out.sessions.activeAgents = 0;
        out.sessions.telegram = "unknown";
        return;
      }
      if (!gs) return;
      out.sessions.activeAgents = gs.active_agents ?? 0;
      const tg = gs.platforms?.telegram?.state;
      out.sessions.telegram =
        tg === "connected"
          ? "connected"
          : tg === "disconnected"
            ? "disconnected"
            : "unknown";
    })(),
  ]);

  return out;
}
