import "server-only";

import { readAuth } from "./atbash-auth";
import { resolveOrgName } from "./atbash-org";

type SdkModule = typeof import("@atbash/sdk");

let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

export type ToolCallRecord = {
  id: string | undefined;
  toolCallId: string | undefined;
  toolName: string;
  command: string;
  context: string;
  verdict: string;
  reason: string;
  createdAt: string | undefined;
  // populated by org-wide queries so the feed can attribute each action
  agent?: string;
  agentPubkey?: string;
};

// agent_pubkey comes back as a Buffer / PubkeyValue, not a hex string.
function pubHex(sdk: SdkModule, v: unknown): string {
  try {
    const h = (sdk as { toPubkeyHex?: (x: unknown) => string }).toPubkeyHex?.(v);
    if (typeof h === "string" && h.length > 0) return h;
  } catch {
    /* fall through */
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

// tool_call_id looks like `tc-1779979934424-7ec7f730` — the middle field is the
// epoch-ms the call was recorded. The on-chain records carry no explicit
// timestamp, so we recover it from the id when one isn't otherwise present.
function timestampFromId(toolCallId: string | undefined): string | undefined {
  if (!toolCallId) return undefined;
  const m = /^tc-(\d{13})-/.exec(toolCallId);
  if (!m) return undefined;
  return new Date(Number(m[1])).toISOString();
}

export type AgentTag = { pubkey: string; fingerprint: string; count: number };

// One agent's recent actions — the attest cron's input for anchoring an audit
// summary on BSC (ERC-8004 ValidationRegistry). Same read path as the org feed,
// scoped by pubkey.
export async function fetchAgentToolCalls(
  agentPubkey: string,
  limit = 200,
): Promise<{ ok: boolean; reason?: string; records: ToolCallRecord[] }> {
  try {
    const sdk = await loadSdk();
    const auth = await readAuth();
    if (!auth) return { ok: true, records: [] };
    const recent = (await sdk.getAgentToolCalls(agentPubkey, limit, {
      auth,
    })) as unknown as Array<Record<string, unknown>>;
    const records: ToolCallRecord[] = recent.map((r) => {
      const vd = (r.verdict_details ?? {}) as { verdict?: string; reason?: string };
      const toolCallId = r.tool_call_id == null ? undefined : String(r.tool_call_id);
      return {
        id: undefined,
        toolCallId,
        toolName: String(r.tool_name ?? "unknown"),
        command: String(r.command_text ?? ""),
        context: String(r.context_text ?? ""),
        verdict: vd.verdict ?? "",
        reason: vd.reason ?? "",
        createdAt:
          (r.created_at as string | undefined) ?? timestampFromId(toolCallId),
        agentPubkey,
      };
    });
    return { ok: true, records };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (/Resource not found/i.test(reason)) return { ok: true, records: [] };
    return { ok: false, reason, records: [] };
  }
}

// Org-wide feed: every action across every agent signing to the org, each
// record attributed to its agent. This is what the fleet-scale audit shows.
export async function fetchOrgToolCalls(limit = 60): Promise<{
  ok: boolean;
  reason?: string;
  records: ToolCallRecord[];
  agents: AgentTag[];
}> {
  try {
    const sdk = await loadSdk();
    // Org-wide read: any identity the operator owns may sign it.
    const auth = await readAuth();
    // No bearer ⇒ the read only 401s, and Atbash caps auth failures at 12/min
    // per IP; the feed polls every 5s, so skip the call and report an empty
    // feed rather than burning the rate limit into a 429.
    if (!auth) return { ok: true, records: [], agents: [] };
    const ORG_NAME = await resolveOrgName(auth);
    const recent = (await sdk.getOrgToolCalls(ORG_NAME, limit, { auth })) as unknown as Array<
      Record<string, unknown>
    >;
    const agentsMap = new Map<string, { fingerprint: string; count: number }>();
    const records: ToolCallRecord[] = recent.map((r) => {
      const cmd = String(r.command_text ?? "");
      const ctx = String(r.context_text ?? "");
      const vd = (r.verdict_details ?? {}) as { verdict?: string; reason?: string };
      const toolCallId =
        r.tool_call_id == null ? undefined : String(r.tool_call_id);
      const pk = pubHex(sdk, r.agent_pubkey);
      const fp = fingerprintOf(pk);
      const tag = agentsMap.get(pk) ?? { fingerprint: fp, count: 0 };
      tag.count++;
      agentsMap.set(pk, tag);
      return {
        id: undefined,
        toolCallId,
        toolName: String(r.tool_name ?? "unknown"),
        command: cmd.length > 240 ? cmd.slice(0, 240) + "…" : cmd,
        context: ctx.length > 240 ? ctx.slice(0, 240) + "…" : ctx,
        verdict: vd.verdict ?? "",
        reason: vd.reason ?? "",
        createdAt:
          (r.created_at as string | undefined) ?? timestampFromId(toolCallId),
        agent: fp,
        agentPubkey: pk,
      };
    });
    const agents: AgentTag[] = [...agentsMap.entries()]
      .map(([pubkey, v]) => ({ pubkey, fingerprint: v.fingerprint, count: v.count }))
      .sort((a, b) => b.count - a.count);
    return { ok: true, records, agents };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (/Resource not found/i.test(reason)) return { ok: true, records: [], agents: [] };
    return { ok: false, reason, records: [], agents: [] };
  }
}
