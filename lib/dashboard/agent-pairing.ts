import "server-only";

import type { DeploymentRow } from "@/lib/dashboard/deployments";
import { DASHBOARD_USERNAME, dashboardPassword, dashboardUrl } from "@/lib/dashboard/agent-dashboard";

/**
 * Read and approve Hermes pairing requests on a deployed agent.
 *
 * Hermes gates unknown senders and answers them with a one-time code plus
 * "ask the bot owner to run `hermes pairing approve <platform> <code>`". On
 * Render the tenant has no shell, so that instruction is impossible to follow
 * and a second person could never reach the agent. The console approves on
 * their behalf through the agent's own dashboard API.
 *
 * Two auth layers sit in front of that API and BOTH are needed:
 *  1. decenchro-proxy owns the public port and demands basic auth
 *     (docker/agent/proxy.mjs) — the per-deployment `operator` credentials.
 *  2. Hermes itself binds loopback, so its gate is off and instead it injects
 *     an ephemeral session token into the SPA HTML which the client echoes on
 *     every `/api/` call. There is no endpoint that mints it, so it has to be
 *     scraped from the page — a bare basic-auth'd `GET /api/pairing` 401s.
 *
 * Credentials never leave the server: callers get the pairing data only.
 */

/**
 * `window.__HERMES_SESSION_TOKEN__="…"`, with the dunders optional so a rename
 * to a bare key still matches. Exported for scripts/check-pairing.mjs.
 */
export const SESSION_TOKEN_RE =
  /(?:__)?HERMES_SESSION_TOKEN(?:__)?\s*[:=]\s*"([A-Za-z0-9._-]{16,200})"/;

const TIMEOUT_MS = 8_000;
/** The agent is a small python server on someone else's network: cap the read. */
const MAX_HTML_BYTES = 512 * 1024;

export type PairingRequest = {
  platform: string;
  requestId: string;
  userId: string;
  userName: string;
  ageMinutes: number;
};

export class PairingUnavailable extends Error {}

function basic(row: DeploymentRow): string {
  const raw = `${DASHBOARD_USERNAME}:${dashboardPassword(row.id)}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function base(row: DeploymentRow): string {
  const url = dashboardUrl(row);
  if (!url) throw new PairingUnavailable("this agent has no console endpoint");
  return url;
}

async function call(row: DeploymentRow, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base(row)}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: basic(row) },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * The dashboard's own session token, read out of the SPA shell.
 *
 * Injected as `window.__HERMES_SESSION_TOKEN__="…"` in a <script> in the SPA
 * shell. The dunder wrapping is upstream's and is exactly what a looser match
 * gets wrong, so the pattern tolerates it being present or absent
 * (scripts/check-pairing.mjs pins both shapes against the real page).
 */
async function sessionToken(row: DeploymentRow): Promise<string> {
  const res = await call(row, "/");
  if (!res.ok) {
    throw new PairingUnavailable(
      res.status === 401 ? "console credentials rejected" : `console returned ${res.status}`,
    );
  }
  const html = (await res.text()).slice(0, MAX_HTML_BYTES);
  const m = SESSION_TOKEN_RE.exec(html);
  if (!m) throw new PairingUnavailable("console did not hand out a session token");
  return m[1];
}

async function api(row: DeploymentRow, path: string, init?: RequestInit): Promise<unknown> {
  const token = await sessionToken(row);
  const res = await call(row, path, {
    ...init,
    headers: { ...(init?.headers ?? {}), "x-hermes-session-token": token },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : null;
    throw new PairingUnavailable(detail ?? `console returned ${res.status}`);
  }
  return body;
}

function toRequest(raw: unknown): PairingRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const requestId = typeof r.request_id === "string" ? r.request_id : "";
  const platform = typeof r.platform === "string" ? r.platform : "";
  if (!requestId || !platform) return null;
  const userId = typeof r.user_id === "string" ? r.user_id : "";
  return {
    platform,
    requestId,
    userId,
    // Hermes falls back to the raw id when a platform gives no display name.
    userName: typeof r.user_name === "string" && r.user_name ? r.user_name : userId,
    ageMinutes: typeof r.age_minutes === "number" ? r.age_minutes : 0,
  };
}

/** Senders waiting for approval, oldest first. Never throws for "none". */
export async function listPairing(row: DeploymentRow): Promise<PairingRequest[]> {
  const body = await api(row, "/api/pairing");
  const pending = body && typeof body === "object" ? (body as { pending?: unknown }).pending : null;
  if (!Array.isArray(pending)) return [];
  return pending
    .map(toRequest)
    .filter((r): r is PairingRequest => r !== null)
    .sort((a, b) => b.ageMinutes - a.ageMinutes);
}

/**
 * Approve one waiting sender.
 *
 * Always by request id, never by the code the sender was shown: the code is
 * rate-limited and locks the platform out after a few failures, and the id is
 * what an admin surface already has from `listPairing`.
 */
export async function approvePairing(
  row: DeploymentRow,
  platform: string,
  requestId: string,
): Promise<{ userId: string; userName: string }> {
  const body = await api(row, "/api/pairing/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform, request_id: requestId }),
  });
  const user = body && typeof body === "object" ? (body as { user?: unknown }).user : null;
  const u = (user ?? {}) as Record<string, unknown>;
  const userId = typeof u.user_id === "string" ? u.user_id : "";
  return { userId, userName: typeof u.user_name === "string" && u.user_name ? u.user_name : userId };
}
