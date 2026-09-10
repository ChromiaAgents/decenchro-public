import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

import { fetchCredits, fetchModelPricing } from "./openrouter";
import { HERMES_DIR } from "./paths";

// Transcripts carry no token usage, so we estimate at ~4 chars/token — the
// usual rough rule for English+code. Split prompt vs completion by role so the
// cost estimate can apply OpenRouter's differing input/output rates.
const CHARS_PER_TOKEN = 4;

const SESSIONS_DIR = path.join(HERMES_DIR, "sessions");

/**
 * LLM analytics derived from Hermes session transcripts on disk
 * (~/.hermes/sessions/session_*.json). These files are the raw record of
 * every conversation the agent has had — model, messages, tool calls,
 * reasoning. We aggregate them into something the dashboard can chart.
 *
 * Token counts are estimated from content length (~4 chars/token), since the
 * transcript files don't carry per-message usage. Everything else (message
 * counts, tool calls, model/platform splits) is exact.
 */
export type LlmAnalytics = {
  generatedAt: string;
  totals: {
    conversations: number;
    messages: number;
    toolCalls: number;
    estTokens: number;
    promptTokens: number;
    completionTokens: number;
    estCost: number | null;
    reasoningMessages: number;
    avgMessagesPerConversation: number;
  };
  // Exact account-level spend from OpenRouter (ground truth). Per-model cost
  // below is an estimate over only the transcripts on this host (a sample), so
  // it is not expected to equal the account total — it attributes, not reconcile.
  cost: {
    accountOk: boolean;
    usdUsed: number | null;
    usdRemaining: number | null;
    pricingOk: boolean;
  };
  byRole: { user: number; assistant: number; tool: number };
  models: {
    name: string;
    conversations: number;
    messages: number;
    promptTokens: number;
    completionTokens: number;
    estCost: number | null;
  }[];
  platforms: { name: string; conversations: number }[];
  tools: { name: string; count: number }[];
  activity: {
    date: string;
    conversations: number;
    messages: number;
    toolCalls: number;
  }[];
  conversations: {
    id: string;
    platform: string;
    model: string;
    messages: number;
    toolCalls: number;
    startedAt: string | null;
    lastActive: string | null;
    title: string;
  }[];
  errors: string[];
};

type RawMessage = {
  role?: string;
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  tool_calls?: unknown;
};

type RawSession = {
  session_id?: string;
  model?: string;
  platform?: string;
  session_start?: string;
  last_updated?: string;
  message_count?: number;
  messages?: RawMessage[];
};

// tool_calls follow the OpenAI shape: an array of
//   { type: 'function', function: { name: 'terminal', arguments: '…' } }
// Some older transcripts may serialise it as a string; we handle both, falling
// back to a tolerant regex on the `"function":{"name":"…"` marker.
const TOOL_NAME_RE =
  /["']function["']\s*:\s*\{\s*["']name["']\s*:\s*["']([^"']+)["']/g;

function toolNamesOf(toolCalls: unknown): string[] {
  const names: string[] = [];
  if (Array.isArray(toolCalls)) {
    for (const c of toolCalls) {
      const fn = c as { function?: { name?: unknown }; name?: unknown };
      const n = fn?.function?.name ?? fn?.name;
      if (typeof n === "string" && n.length > 0) names.push(n);
    }
    return names;
  }
  if (typeof toolCalls === "string" && toolCalls.length > 0) {
    for (const m of toolCalls.matchAll(TOOL_NAME_RE)) names.push(m[1]);
  }
  return names;
}

function textLen(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value == null) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function firstUserMessage(messages: RawMessage[]): string {
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      const t = m.content.trim().replace(/\s+/g, " ");
      if (t.length > 0) return t.length > 72 ? t.slice(0, 72) + "…" : t;
    }
  }
  return "—";
}

function dayOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export async function fetchLlmAnalytics(): Promise<LlmAnalytics> {
  // Build a fully fresh object every call — no shared module-level state, or
  // the mutable totals/byRole counters would accumulate across requests.
  const out: LlmAnalytics = {
    generatedAt: new Date().toISOString(),
    totals: {
      conversations: 0,
      messages: 0,
      toolCalls: 0,
      estTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      estCost: null,
      reasoningMessages: 0,
      avgMessagesPerConversation: 0,
    },
    cost: { accountOk: false, usdUsed: null, usdRemaining: null, pricingOk: false },
    byRole: { user: 0, assistant: 0, tool: 0 },
    models: [],
    platforms: [],
    tools: [],
    activity: [],
    conversations: [],
    errors: [],
  };

  let files: string[];
  try {
    const entries = await fs.readdir(SESSIONS_DIR);
    files = entries.filter(
      (f) => f.startsWith("session_") && f.endsWith(".json"),
    );
  } catch {
    out.errors.push("sessions directory not found — has the agent run yet?");
    return out;
  }

  const modelMap = new Map<
    string,
    { conversations: number; messages: number; promptTokens: number; completionTokens: number }
  >();
  const platformMap = new Map<string, number>();
  const toolMap = new Map<string, number>();
  const activityMap = new Map<
    string,
    { conversations: number; messages: number; toolCalls: number }
  >();

  const raw = await Promise.all(
    files.map(async (file) => {
      try {
        const text = await fs.readFile(path.join(SESSIONS_DIR, file), "utf8");
        return JSON.parse(text) as RawSession;
      } catch {
        out.errors.push(`unreadable: ${file}`);
        return null;
      }
    }),
  );

  for (const s of raw) {
    if (!s) continue;
    const messages = Array.isArray(s.messages) ? s.messages : [];
    const model = s.model ?? "unknown";
    const platform = s.platform ?? "unknown";
    const day = dayOf(s.session_start) ?? dayOf(s.last_updated);

    let convToolCalls = 0;
    // Prompt = what's fed to the model (user + tool results). Completion = what
    // the model produced (assistant content, reasoning, tool-call arguments).
    let promptChars = 0;
    let completionChars = 0;

    for (const m of messages) {
      out.totals.messages += 1;
      if (m.role === "user") out.byRole.user += 1;
      else if (m.role === "assistant") out.byRole.assistant += 1;
      else if (m.role === "tool") out.byRole.tool += 1;

      if (m.reasoning || m.reasoning_content) out.totals.reasoningMessages += 1;

      if (m.role === "assistant") {
        completionChars +=
          textLen(m.content) + textLen(m.reasoning) + textLen(m.tool_calls);
      } else {
        promptChars += textLen(m.content);
      }

      const names = toolNamesOf(m.tool_calls);
      for (const name of names) {
        toolMap.set(name, (toolMap.get(name) ?? 0) + 1);
      }
      convToolCalls += names.length;
    }

    const promptTokens = Math.round(promptChars / CHARS_PER_TOKEN);
    const completionTokens = Math.round(completionChars / CHARS_PER_TOKEN);
    out.totals.toolCalls += convToolCalls;
    out.totals.promptTokens += promptTokens;
    out.totals.completionTokens += completionTokens;
    out.totals.estTokens += promptTokens + completionTokens;

    const mm =
      modelMap.get(model) ??
      { conversations: 0, messages: 0, promptTokens: 0, completionTokens: 0 };
    mm.conversations += 1;
    mm.messages += messages.length;
    mm.promptTokens += promptTokens;
    mm.completionTokens += completionTokens;
    modelMap.set(model, mm);

    platformMap.set(platform, (platformMap.get(platform) ?? 0) + 1);

    if (day) {
      const a = activityMap.get(day) ?? {
        conversations: 0,
        messages: 0,
        toolCalls: 0,
      };
      a.conversations += 1;
      a.messages += messages.length;
      a.toolCalls += convToolCalls;
      activityMap.set(day, a);
    }

    out.conversations.push({
      id: s.session_id ?? "unknown",
      platform,
      model,
      messages: messages.length,
      toolCalls: convToolCalls,
      startedAt: s.session_start ?? null,
      lastActive: s.last_updated ?? null,
      title: firstUserMessage(messages),
    });
  }

  out.totals.conversations = out.conversations.length;
  out.totals.avgMessagesPerConversation =
    out.totals.conversations > 0
      ? Math.round(out.totals.messages / out.totals.conversations)
      : 0;

  // Real account spend (exact) + live per-token pricing (to estimate per-model
  // cost). Both are best-effort — failure leaves cost fields null, not broken.
  const [credits, pricing] = await Promise.all([
    fetchCredits(),
    fetchModelPricing(),
  ]);
  out.cost.accountOk = credits.ok;
  out.cost.usdUsed = credits.ok ? credits.totalUsage ?? null : null;
  out.cost.usdRemaining =
    credits.ok && credits.totalCredits != null && credits.totalUsage != null
      ? credits.totalCredits - credits.totalUsage
      : null;
  out.cost.pricingOk = pricing.ok && Object.keys(pricing.prices).length > 0;

  const costOf = (
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number | null => {
    const p = pricing.prices[model];
    if (!p) return null;
    return promptTokens * p.prompt + completionTokens * p.completion;
  };

  out.models = [...modelMap.entries()]
    .map(([name, v]) => ({
      name,
      conversations: v.conversations,
      messages: v.messages,
      promptTokens: v.promptTokens,
      completionTokens: v.completionTokens,
      estCost: costOf(name, v.promptTokens, v.completionTokens),
    }))
    .sort((a, b) => b.messages - a.messages);

  if (out.cost.pricingOk) {
    let sum = 0;
    let any = false;
    for (const m of out.models) {
      if (m.estCost != null) {
        sum += m.estCost;
        any = true;
      }
    }
    out.totals.estCost = any ? sum : null;
  }

  out.platforms = [...platformMap.entries()]
    .map(([name, conversations]) => ({ name, conversations }))
    .sort((a, b) => b.conversations - a.conversations);

  out.tools = [...toolMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  out.activity = [...activityMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  out.conversations.sort((a, b) =>
    (b.lastActive ?? "").localeCompare(a.lastActive ?? ""),
  );

  return out;
}

// ─── Step-by-step replay ─────────────────────────────────────

export type SessionMeta = {
  file: string;
  sessionId: string;
  title: string;
  platform: string;
  model: string;
  messages: number;
  toolCalls: number;
  startedAt: string | null;
  lastActive: string | null;
};

export type ReplayStep =
  | { kind: "user"; text: string }
  | { kind: "action"; reasoning: string; tools: { name: string; args: string }[] }
  | { kind: "reply"; reasoning: string; text: string }
  | { kind: "result"; text: string };

function reasoningOf(m: RawMessage): string {
  const r = m.reasoning ?? m.reasoning_content;
  return typeof r === "string" ? r.trim() : "";
}

function asText(value: unknown, max = 600): string {
  let s: string;
  if (typeof value === "string") s = value;
  else if (value == null) s = "";
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  s = s.trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// tool_calls is the OpenAI array shape; pull the name + a readable args string.
function toolDetails(toolCalls: unknown): { name: string; args: string }[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((c) => {
    const fn = (c as { function?: { name?: unknown; arguments?: unknown } })
      .function;
    const name =
      typeof fn?.name === "string"
        ? fn.name
        : String(
            (c as { name?: unknown }).name ?? "tool",
          );
    let args = "";
    const raw = fn?.arguments;
    if (typeof raw === "string") {
      try {
        args = asText(JSON.parse(raw), 240);
      } catch {
        args = asText(raw, 240);
      }
    } else if (raw != null) {
      args = asText(raw, 240);
    }
    return { name, args };
  });
}

function metaOf(file: string, s: RawSession): SessionMeta {
  const messages = Array.isArray(s.messages) ? s.messages : [];
  let toolCalls = 0;
  for (const m of messages) toolCalls += toolNamesOf(m.tool_calls).length;
  return {
    file,
    sessionId: s.session_id ?? file.replace(/\.json$/, ""),
    title: firstUserMessage(messages),
    platform: s.platform ?? "unknown",
    model: s.model ?? "unknown",
    messages: messages.length,
    toolCalls,
    startedAt: s.session_start ?? null,
    lastActive: s.last_updated ?? null,
  };
}

export async function listSessions(): Promise<SessionMeta[]> {
  let files: string[];
  try {
    files = (await fs.readdir(SESSIONS_DIR)).filter(
      (f) => f.startsWith("session_") && f.endsWith(".json"),
    );
  } catch {
    return [];
  }
  const metas = await Promise.all(
    files.map(async (file) => {
      try {
        const raw = await fs.readFile(path.join(SESSIONS_DIR, file), "utf8");
        return metaOf(file, JSON.parse(raw) as RawSession);
      } catch {
        return null;
      }
    }),
  );
  return metas
    .filter((m): m is SessionMeta => m !== null)
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
}

export async function fetchReplay(
  fileParam: string,
): Promise<{ meta: SessionMeta | null; steps: ReplayStep[] }> {
  // Path-traversal guard: only allow a bare session_*.json basename.
  const file = path.basename(fileParam);
  if (!/^session_[\w.-]+\.json$/.test(file)) return { meta: null, steps: [] };

  let s: RawSession;
  try {
    const raw = await fs.readFile(path.join(SESSIONS_DIR, file), "utf8");
    s = JSON.parse(raw) as RawSession;
  } catch {
    return { meta: null, steps: [] };
  }

  const messages = Array.isArray(s.messages) ? s.messages : [];
  const steps: ReplayStep[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const t = asText(m.content);
      if (t) steps.push({ kind: "user", text: t });
    } else if (m.role === "tool") {
      steps.push({ kind: "result", text: asText(m.content) });
    } else if (m.role === "assistant") {
      const tools = toolDetails(m.tool_calls);
      if (tools.length > 0) {
        steps.push({ kind: "action", reasoning: reasoningOf(m), tools });
      } else {
        const t = asText(m.content);
        if (t || reasoningOf(m)) {
          steps.push({ kind: "reply", reasoning: reasoningOf(m), text: t });
        }
      }
    }
  }

  return { meta: metaOf(file, s), steps };
}
