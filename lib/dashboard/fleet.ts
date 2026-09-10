import "server-only";

import { readAuth } from "./atbash-auth";
import { resolveOrgName } from "./atbash-org";

type SdkModule = typeof import("@atbash/sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

export type FleetAgent = {
  pubkey: string;
  fingerprint: string;
  actions: number;
  lastActive: string | null;
  topTools: { name: string; count: number }[];
  heldPending: number;
  verdicts: { green: number; yellow: number; red: number };
};

export type Fleet = {
  org: string;
  tier: string | null;
  enforcementEnabled: boolean;
  verdictEnabled: boolean;
  agents: FleetAgent[];
  totals: { agents: number; actions: number; heldPending: number };
  // org-level risk posture (getSafetyStats has no per-agent breakdown)
  posture: {
    green: number;
    yellow: number;
    red: number;
    totalJudgments: number;
  } | null;
  sampleSize: number;
  errors: string[];
};

// agent_pubkey comes back as a Buffer / PubkeyValue, not a hex string.
function pubHex(sdk: SdkModule, v: unknown): string {
  try {
    const h = (sdk as { toPubkeyHex?: (x: unknown) => string }).toPubkeyHex?.(v);
    if (typeof h === "string" && h.length > 0) return h;
  } catch {
    /* fall through to manual */
  }
  const data = (v as { data?: number[] })?.data ?? v;
  if (Array.isArray(data)) return Buffer.from(data).toString("hex");
  if (typeof v === "string") return v;
  return String(v);
}

function fingerprintOf(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}

// A brand-new agent with no recorded tool calls makes the records endpoint
// answer "Resource not found" — that's an empty feed, not a failure.
function isNoRecords(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /Resource not found/i.test(m);
}

// tool_call_id is `tc-<epoch_ms>-<hex>`; on-chain records carry no timestamp.
function timestampFromId(toolCallId: unknown): number | null {
  if (typeof toolCallId !== "string") return null;
  const m = /^tc-(\d{13})-/.exec(toolCallId);
  return m ? Number(m[1]) : null;
}

function bumpVerdict(
  v: { green: number; yellow: number; red: number },
  verdict: unknown,
) {
  const s = String(verdict ?? "").toUpperCase();
  if (s === "BLOCK" || s === "RED") v.red++;
  else if (s === "HOLD" || s === "YELLOW") v.yellow++;
  else if (s === "ALLOW" || s === "GREEN") v.green++;
}

type Agg = {
  actions: number;
  lastMs: number | null;
  tools: Map<string, number>;
  verdicts: { green: number; yellow: number; red: number };
};

export async function fetchFleet(): Promise<Fleet> {
  const errors: string[] = [];
  const out: Fleet = {
    org: "",
    tier: null,
    enforcementEnabled: false,
    verdictEnabled: false,
    agents: [],
    totals: { agents: 0, actions: 0, heldPending: 0 },
    posture: null,
    sampleSize: 0,
    errors,
  };

  const sdk = await loadSdk();
  // Atbash gates the read API behind a signed bearer; without auth every read
  // returns 401. Signed with one of the company's own deployed agent identities.
  const auth = await readAuth();
  const ORG_NAME = await resolveOrgName(auth);
  out.org = ORG_NAME;

  // No bearer ⇒ every read below 401s, and Atbash caps auth failures at 12/min
  // per IP; with the fleet polling on a timer that quickly becomes a 429. Return
  // the empty roster instead of generating failures.
  if (!auth) {
    errors.push("no Atbash agent identity available");
    return out;
  }

  type Rec = {
    agent_pubkey?: unknown;
    tool_name?: unknown;
    tool_call_id?: unknown;
    verdict_details?: { verdict?: unknown };
  };
  type Held = { agent_pubkey?: unknown };

  const [recsR, heldR, safetyR, subR] = await Promise.allSettled([
    sdk.getOrgToolCalls(ORG_NAME, 300, { auth }) as Promise<Rec[]>,
    sdk.getPendingHeldActions(ORG_NAME, 200, { auth }) as Promise<Held[]>,
    sdk.getSafetyStats({ auth }) as Promise<Record<string, number>>,
    sdk.getOrgSubscription(ORG_NAME, { auth }) as Promise<{
      subscription_name?: string;
      is_active?: boolean;
    } | null>,
  ]);

  if (subR.status === "fulfilled") {
    const sub = subR.value;
    out.tier = sub?.subscription_name ?? null;
    // The subscription model no longer exposes verdict/enforcement flags; an
    // active subscription is the best available proxy for governance being live.
    out.verdictEnabled = Boolean(sub?.is_active);
    out.enforcementEnabled = Boolean(sub?.is_active);
  } else {
    errors.push("tier lookup failed");
  }

  if (safetyR.status === "fulfilled" && safetyR.value) {
    const s = safetyR.value;
    out.posture = {
      green: s.green_count ?? 0,
      yellow: s.yellow_count ?? 0,
      red: s.red_count ?? 0,
      totalJudgments: s.total_judgments ?? 0,
    };
  } else {
    errors.push("safety stats failed");
  }

  const heldByAgent = new Map<string, number>();
  if (heldR.status === "fulfilled") {
    for (const h of heldR.value) {
      const pk = pubHex(sdk, h.agent_pubkey);
      heldByAgent.set(pk, (heldByAgent.get(pk) ?? 0) + 1);
      out.totals.heldPending++;
    }
  }

  if (recsR.status === "fulfilled") {
    out.sampleSize = recsR.value.length;
    const byAgent = new Map<string, Agg>();
    for (const r of recsR.value) {
      const pk = pubHex(sdk, r.agent_pubkey);
      let a = byAgent.get(pk);
      if (!a) {
        a = { actions: 0, lastMs: null, tools: new Map(), verdicts: { green: 0, yellow: 0, red: 0 } };
        byAgent.set(pk, a);
      }
      a.actions++;
      out.totals.actions++;
      const name = String(r.tool_name ?? "unknown");
      a.tools.set(name, (a.tools.get(name) ?? 0) + 1);
      const ts = timestampFromId(r.tool_call_id);
      if (ts != null && (a.lastMs == null || ts > a.lastMs)) a.lastMs = ts;
      bumpVerdict(a.verdicts, r.verdict_details?.verdict);
    }

    out.agents = [...byAgent.entries()]
      .map(([pubkey, a]) => ({
        pubkey,
        fingerprint: fingerprintOf(pubkey),
        actions: a.actions,
        lastActive: a.lastMs != null ? new Date(a.lastMs).toISOString() : null,
        topTools: [...a.tools.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((x, y) => y.count - x.count)
          .slice(0, 4),
        heldPending: heldByAgent.get(pubkey) ?? 0,
        verdicts: a.verdicts,
      }))
      .sort((x, y) => (y.lastActive ?? "").localeCompare(x.lastActive ?? ""));
  } else if (!isNoRecords(recsR.reason)) {
    errors.push("org tool calls failed");
  }

  out.totals.agents = out.agents.length;
  return out;
}
