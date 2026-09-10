import "server-only";

import { readAuth } from "./atbash-auth";

type SdkModule = typeof import("@atbash/sdk");
let sdkPromise: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import("@atbash/sdk");
  return sdkPromise;
}

export type Decision = {
  toolCallId: string;
  agent: string | null;
  toolName: string;
  command: string;
  args: string;
  context: string;
  actionType: string | null;
  resultStatus: string | null;
  verdict: {
    color: string | null;
    reason: string | null;
    source: string | null;
    responseMs: number | null;
  };
  createdAt: string | null;
  found: boolean;
};

function pubHex(sdk: SdkModule, v: unknown): string | null {
  try {
    const h = (sdk as { toPubkeyHex?: (x: unknown) => string }).toPubkeyHex?.(v);
    if (typeof h === "string" && h.length > 0) return `${h.slice(0, 6)}…${h.slice(-4)}`;
  } catch {
    /* fall through */
  }
  const data = (v as { data?: number[] })?.data;
  if (Array.isArray(data)) {
    const h = Buffer.from(data).toString("hex");
    return `${h.slice(0, 6)}…${h.slice(-4)}`;
  }
  return null;
}

// command_text is the raw tool args JSON; pull a readable form if possible.
function prettyArgs(commandText: string): string {
  try {
    return JSON.stringify(JSON.parse(commandText));
  } catch {
    return commandText;
  }
}

export async function fetchDecision(toolCallId: string): Promise<Decision> {
  const sdk = await loadSdk();
  const empty: Decision = {
    toolCallId,
    agent: null,
    toolName: "",
    command: "",
    args: "",
    context: "",
    actionType: null,
    resultStatus: null,
    verdict: { color: null, reason: null, source: null, responseMs: null },
    createdAt: null,
    found: false,
  };

  let full:
    | {
        agent_pubkey?: unknown;
        tool_name?: string;
        command_text?: string;
        context_text?: string;
        action_type?: string;
        result_status?: string;
        verdict_color?: string;
        verdict_reason?: string;
        verdict_source?: string;
        verdict_response_time_ms?: number;
        created_at?: number;
      }
    | null;
  // Signed-bearer auth for the gated Atbash read API. No bearer ⇒ the read only
  // 401s (Atbash caps auth failures at 12/min per IP), so skip it.
  const auth = await readAuth();
  if (!auth) return empty;
  try {
    full = (await sdk.getToolCallFull(toolCallId, { auth })) as typeof full;
  } catch {
    return empty;
  }
  if (!full) return empty;

  const cmd = String(full.command_text ?? "");
  return {
    toolCallId,
    agent: pubHex(sdk, full.agent_pubkey),
    toolName: String(full.tool_name ?? ""),
    command: cmd,
    args: prettyArgs(cmd),
    context: String(full.context_text ?? ""),
    actionType: full.action_type ? String(full.action_type) : null,
    resultStatus: full.result_status ? String(full.result_status) : null,
    verdict: {
      color: full.verdict_color ? String(full.verdict_color) : null,
      reason: full.verdict_reason ? String(full.verdict_reason) : null,
      source: full.verdict_source ? String(full.verdict_source) : null,
      responseMs:
        typeof full.verdict_response_time_ms === "number" &&
        full.verdict_response_time_ms > 0
          ? full.verdict_response_time_ms
          : null,
    },
    createdAt:
      typeof full.created_at === "number"
        ? new Date(full.created_at).toISOString()
        : null,
    found: true,
  };
}
