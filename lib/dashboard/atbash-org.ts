import "server-only";

import type { AtbashAuth } from "./atbash-auth";

type SdkModule = typeof import("@atbash/sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

// Primary source of the org name: the SDK's own convention, ATBASH_ORG_NAME
// (env → ~/.config/atbash/config.json orgName). On this Atbash backend the org
// is NOT derivable from the agent — getAgentDetail returns 404 "not assigned to
// an org" and getAgentToolCalls 503s — so the name must be supplied here, then
// every org-scoped read (subscription, tool calls, held actions) works with the
// agent's auth.
function configuredOrg(): string {
  return (process.env.ATBASH_ORG_NAME ?? "").trim();
}

// Cache successful agent→org derivations keyed by signing pubkey — per-pubkey,
// never global, so two companies never share an entry.
const orgByPubkey = new Map<string, string>();

// Negative cache: when a derivation attempt finds nothing, remember briefly so
// the dashboard's 5s poll doesn't re-fire SDK reads every cycle and burn the
// 12/min auth cap. Short TTL so a key that later exposes its org recovers.
const NEGATIVE_TTL_MS = 60_000;
const negativeUntil = new Map<string, number>();

async function detailOrg(sdk: SdkModule, auth: AtbashAuth): Promise<string> {
  try {
    const d = (await sdk.getAgentDetail(auth.pubkey, { auth })) as {
      org_name?: unknown;
    } | null;
    return typeof d?.org_name === "string" ? d.org_name : "";
  } catch {
    return "";
  }
}

async function probeOrg(sdk: SdkModule, auth: AtbashAuth): Promise<string> {
  try {
    const calls = (await sdk.getAgentToolCalls(auth.pubkey, 1, {
      auth,
    })) as Array<{ org_name?: unknown }>;
    const o = calls[0]?.org_name;
    return typeof o === "string" ? o : "";
  } catch {
    return "";
  }
}

/**
 * Resolve the Atbash org name for the current identity.
 *
 * 1. ATBASH_ORG_NAME (env / SDK config) — the canonical, backend-agnostic source
 *    and the one this deployment relies on (the agent-detail endpoint doesn't
 *    expose org membership here).
 * 2. As a fallback for backends that DO tag records with the org, derive it from
 *    the agent's own records (getAgentDetail → getAgentToolCalls). Cached per
 *    pubkey, with a short negative-cache so failed derivation doesn't hammer the
 *    auth-failure cap.
 *
 * Returns "" when nothing is configured or derivable — callers then skip the
 * org-scoped reads and show an unconfigured state rather than a wrong org name.
 *
 * Pass the auth already obtained from readAuth() so this doesn't re-hit the DB.
 */
export async function resolveOrgName(
  auth: AtbashAuth | undefined,
): Promise<string> {
  const configured = configuredOrg();
  if (configured) return configured;

  if (!auth) return "";

  const cached = orgByPubkey.get(auth.pubkey);
  if (cached) return cached;

  const until = negativeUntil.get(auth.pubkey);
  if (until && until > Date.now()) return "";

  const sdk = await loadSdk().catch(() => null);
  if (!sdk) return "";

  const org = (await detailOrg(sdk, auth)) || (await probeOrg(sdk, auth));
  if (org) {
    orgByPubkey.set(auth.pubkey, org);
    negativeUntil.delete(auth.pubkey);
    return org;
  }
  negativeUntil.set(auth.pubkey, Date.now() + NEGATIVE_TTL_MS);
  return "";
}
