import "server-only";

import { readAuth } from "./atbash-auth";
import { resolveOrgName } from "./atbash-org";

type SdkModule = typeof import("@atbash/sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

export type Governance = {
  identity: {
    pubkey: string | null;
    fingerprint: string | null;
    org: string;
    tier: string | null;
    enforcementEnabled: boolean;
    verdictEnabled: boolean;
  };
  posture: {
    green: number;
    yellow: number;
    red: number;
    totalJudgments: number;
    totalToolCalls: number;
    cacheHits: number;
    cacheMisses: number;
  } | null;
  policy: {
    name: string | null;
    risk: string | null;
    isCustom: boolean;
    isJailed: boolean;
    rules: { code: string; text: string }[];
    raw: string;
  } | null;
  held: {
    pending: number;
    reviewed: number;
    items: HeldItem[];
    reviews: HeldReviewItem[];
  };
  errors: string[];
};

export type HeldItem = {
  judgmentId: string;
  agent: string | null;
  actionText: string;
  actionContext: string;
  verdict: string;
  reason: string;
  createdAt: string | null;
};

export type HeldReviewItem = {
  judgmentId: string;
  actionText: string;
  status: string;
  reviewer: string | null;
  note: string;
  reviewedAt: string | null;
};

// The default policy comes back as a single block:
//   "VERDICTS: …\n1. FIN: …\n2. COM: …"
// Split it into the numbered category rules so the UI can render them cleanly.
function parseRules(raw: string): { code: string; text: string }[] {
  const rules: { code: string; text: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*\d+\.\s*([A-Z]+):\s*(.+)$/.exec(line.trim());
    if (m) rules.push({ code: m[1], text: m[2].trim() });
  }
  return rules;
}

function fingerprintOf(pubkey: string): string {
  // 0256ed6db4…c3a1 — first 6 + last 4, the usual key-fingerprint shape.
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}

// agent_pubkey / reviewed_by come back as Buffer / PubkeyValue, not hex.
function pubFingerprint(sdk: SdkModule, v: unknown): string | null {
  if (v == null) return null;
  let hex: string | null = null;
  try {
    const h = (sdk as { toPubkeyHex?: (x: unknown) => string }).toPubkeyHex?.(v);
    if (typeof h === "string" && h.length > 0) hex = h;
  } catch {
    /* fall through */
  }
  if (!hex) {
    const data = (v as { data?: number[] })?.data;
    if (Array.isArray(data)) hex = Buffer.from(data).toString("hex");
    else if (typeof v === "string") hex = v;
  }
  return hex ? fingerprintOf(hex) : null;
}

function msToIso(v: unknown): string | null {
  return typeof v === "number" && v > 0 ? new Date(v).toISOString() : null;
}

export type Identity = Governance["identity"];

/** Lightweight identity + tier for the dashboard header (no stats/policy). */
export async function getIdentity(): Promise<Identity> {
  const identity: Identity = {
    pubkey: null,
    fingerprint: null,
    org: "",
    tier: null,
    enforcementEnabled: false,
    verdictEnabled: false,
  };
  const sdk = await loadSdk();
  const auth = await readAuth();
  const ORG_NAME = await resolveOrgName(auth);
  identity.org = ORG_NAME;
  if (!auth) return identity; // no bearer ⇒ the read below only 401s (see fetchGovernance)
  identity.pubkey = auth.pubkey;
  identity.fingerprint = fingerprintOf(auth.pubkey);
  try {
    const sub = (await sdk.getOrgSubscription(ORG_NAME, { auth })) as {
      subscription_name?: string;
      is_active?: boolean;
    } | null;
    identity.tier = sub?.subscription_name ?? null;
    identity.verdictEnabled = Boolean(sub?.is_active);
    identity.enforcementEnabled = Boolean(sub?.is_active);
  } catch {
    /* leave defaults */
  }
  return identity;
}

export async function fetchGovernance(): Promise<Governance> {
  const errors: string[] = [];
  const out: Governance = {
    identity: {
      pubkey: null,
      fingerprint: null,
      org: "",
      tier: null,
      enforcementEnabled: false,
      verdictEnabled: false,
    },
    posture: null,
    policy: null,
    held: { pending: 0, reviewed: 0, items: [], reviews: [] },
    errors,
  };

  const sdk = await loadSdk();

  // Signed-bearer auth for the gated Atbash read API; undefined when the
  // operator owns no agent identity, in which case the reads below fail
  // gracefully. The identity shown is whichever one signs those reads.
  const auth = await readAuth();
  const ORG_NAME = await resolveOrgName(auth);
  out.identity.org = ORG_NAME;
  if (auth) {
    out.identity.pubkey = auth.pubkey;
    out.identity.fingerprint = fingerprintOf(auth.pubkey);
  } else {
    errors.push("no Atbash agent identity available");
  }

  // Every Atbash read below is gated behind a signed bearer; with no auth they
  // all return 401, and Atbash caps auth failures at 12/min per IP — so a
  // dashboard polling every 5s without an identity trips a 429. Skip the reads
  // entirely and return the degraded state when there's nothing to sign with.
  if (!auth) return out;

  await Promise.all([
    (async () => {
      try {
        const sub = (await sdk.getOrgSubscription(ORG_NAME, { auth })) as {
          subscription_name?: string;
          is_active?: boolean;
        } | null;
        out.identity.tier = sub?.subscription_name ?? null;
        out.identity.verdictEnabled = Boolean(sub?.is_active);
        out.identity.enforcementEnabled = Boolean(sub?.is_active);
      } catch (err) {
        errors.push(
          `tier: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    })(),
    (async () => {
      try {
        // safety-stats is an org/judge-level endpoint — no pubkey required.
        const s = (await sdk.getSafetyStats({ auth })) as Record<string, number>;
        out.posture = {
          green: s.green_count ?? 0,
          yellow: s.yellow_count ?? 0,
          red: s.red_count ?? 0,
          totalJudgments: s.total_judgments ?? 0,
          totalToolCalls: s.total_tool_calls ?? 0,
          cacheHits: s.cache_hits ?? 0,
          cacheMisses: s.cache_misses ?? 0,
        };
      } catch (err) {
        errors.push(
          `safety stats: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    })(),
    (async () => {
      if (!auth) return;
      try {
        // Policy is per-agent; read the one belonging to the signing identity.
        const p = (await sdk.getAgentPolicy(auth.pubkey, { auth })) as {
          policy?: string;
          default_policy?: string;
          is_custom?: boolean;
          is_jailed?: boolean;
        };
        const custom = (p.policy ?? "").trim();
        // The custom policy header carries Name/Risk; the rule grammar lives in
        // the default policy. Show identity from custom, rules from default.
        const nameMatch = /Name:\s*(.+)/.exec(custom);
        const riskMatch = /Risk:\s*(.+)/.exec(custom);
        const ruleSource = p.default_policy ?? custom;
        out.policy = {
          name: nameMatch ? nameMatch[1].trim() : null,
          risk: riskMatch ? riskMatch[1].trim() : null,
          isCustom: Boolean(p.is_custom),
          isJailed: Boolean(p.is_jailed),
          rules: parseRules(ruleSource),
          raw: ruleSource.trim(),
        };
      } catch (err) {
        errors.push(
          `policy: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    })(),
    (async () => {
      try {
        // Held actions are org-scoped: (orgName, maxCount).
        const [pending, reviews] = (await Promise.all([
          sdk.getPendingHeldActions(ORG_NAME, 50, { auth }),
          sdk.getHeldActionReviews(ORG_NAME, 50, { auth }).catch(() => []),
        ])) as unknown as [Record<string, unknown>[], Record<string, unknown>[]];

        const items: HeldItem[] = (pending ?? []).map((h) => ({
          judgmentId: String(h.judgment_id ?? ""),
          agent: pubFingerprint(sdk, h.agent_pubkey),
          actionText: String(h.action_text ?? ""),
          actionContext: String(h.action_context ?? ""),
          verdict: String(h.verdict ?? ""),
          reason: String(h.reason ?? ""),
          createdAt: msToIso(h.created_at),
        }));
        const reviewItems: HeldReviewItem[] = (reviews ?? []).map((r) => ({
          judgmentId: String(r.judgment_id ?? ""),
          actionText: String(r.action_text ?? ""),
          status: String(r.status ?? ""),
          reviewer: pubFingerprint(sdk, r.reviewed_by),
          note: String(r.review_note ?? ""),
          reviewedAt: msToIso(r.reviewed_at),
        }));
        out.held = {
          pending: items.length,
          reviewed: reviewItems.length,
          items,
          reviews: reviewItems,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed";
        // No held actions on record yet → "Resource not found"; leave the
        // default empty held state rather than surfacing it as an error.
        if (!/Resource not found/i.test(msg)) {
          errors.push(`held actions: ${msg}`);
        }
      }
    })(),
  ]);

  return out;
}
