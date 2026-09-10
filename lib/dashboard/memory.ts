import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// The on-chain memory client is a separate ESM package (chain/client) with its
// own .env, node_modules and native-ish deps (postchain-client, @chromia/ft4).
// Rather than bundle that into the Next server, we shell out to its CLI — which
// already emits JSON for every command — using its own tsx + working dir.
const execFileP = promisify(execFile);

const CLIENT_DIR = path.join(process.cwd(), "chain", "client");
const TSX = path.join(CLIENT_DIR, "node_modules", ".bin", "tsx");
const CLI = path.join(CLIENT_DIR, "src", "cli.ts");
const CLIENT_ENV = path.join(CLIENT_DIR, ".env");

export type MemoryEntry = {
  entry_id: string;
  namespace_name: string;
  content: string;
  source: string;
  tags: string;
  confidence: number;
  created_at: number;
  updated_at: number;
};

export type AuditEntry = {
  actor: string; // hex pubkey
  action: string;
  entry_id: string;
  detail: string;
  created_at: number;
};

export type ChainConfig = {
  nodeUrl: string;
  brid: string;
  namespace: string;
  semanticEnabled: boolean;
};

export type MemoryOverview = {
  ok: boolean;
  reason?: string;
  config: ChainConfig;
  count: number;
  owner: string | null; // namespace owner fingerprint
  readPolicy: string | null;
  entries: MemoryEntry[];
  audit: AuditEntry[];
};

// A Chromia query buffer (pubkey) survives JSON.stringify as
// {type:"Buffer",data:[...]}. Normalise anything pubkey-shaped to hex.
function toHex(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const data = (v as { data?: unknown }).data;
    if (Array.isArray(data)) return Buffer.from(data).toString("hex");
  }
  return null;
}

export function fingerprint(hex: string | null): string | null {
  if (!hex || hex.length < 10) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

async function readClientConfig(): Promise<ChainConfig> {
  const cfg: ChainConfig = {
    nodeUrl: "http://localhost:7740",
    brid: "",
    namespace: "default",
    semanticEnabled: false,
  };
  try {
    const raw = await fs.readFile(CLIENT_ENV, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line);
      if (!m) continue;
      const val = m[2].trim();
      if (m[1] === "CHROMIA_NODE_URL" && val) cfg.nodeUrl = val;
      else if (m[1] === "CHROMIA_BRID") cfg.brid = val;
      else if (m[1] === "AGENT_NAMESPACE" && val) cfg.namespace = val;
      else if (m[1] === "OPENROUTER_API_KEY") cfg.semanticEnabled = val.length > 0;
    }
  } catch {
    // .env missing — fall back to defaults; node will simply be unreachable.
  }
  return cfg;
}

async function runCli<T>(args: string[], timeoutMs = 15_000): Promise<T> {
  const { stdout } = await execFileP(TSX, [CLI, ...args], {
    cwd: CLIENT_DIR,
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

// Full snapshot for the Memory tab: config (always, even offline), then the
// live on-chain reads. Any chain failure degrades to ok:false with the reason
// so the UI can show an honest "node unreachable" state instead of crashing.
// Resolve a fleet agent (by its owner pubkey) to the namespace it owns. Returns
// the first namespace name, or null if the agent owns none / the chain read
// fails. Lets the Memory tab load any agent's store by pubkey.
export async function resolveAgentNamespace(
  ownerHex: string,
): Promise<string | null> {
  try {
    const list = await runCli<{ name: string }[] | { error: string }>([
      "namespace",
      "by-owner",
      ownerHex,
    ]);
    if (Array.isArray(list) && list.length > 0) return list[0].name;
    return null;
  } catch {
    return null;
  }
}

export async function fetchMemoryOverview(
  namespaceOverride?: string,
): Promise<MemoryOverview> {
  const config = await readClientConfig();
  // When viewing another agent's store, reflect its namespace in the config the
  // UI renders (header, etc.) rather than the local default.
  const ns = namespaceOverride?.trim() || config.namespace;
  const effectiveConfig = { ...config, namespace: ns };
  const nsArgs = ["--namespace", ns];
  const base: MemoryOverview = {
    ok: false,
    config: effectiveConfig,
    count: 0,
    owner: null,
    readPolicy: null,
    entries: [],
    audit: [],
  };

  try {
    const [list, audit, nsInfo] = await Promise.all([
      runCli<MemoryEntry[]>(["list", "--limit", "100", ...nsArgs]),
      runCli<AuditEntry[] | { error: string }>([
        "audit",
        "--limit",
        "30",
        ...nsArgs,
      ]).catch(() => [] as AuditEntry[]),
      runCli<{ owner?: unknown; read_policy?: string }>([
        "namespace",
        "info",
        effectiveConfig.namespace,
      ]).catch(() => ({}) as { owner?: unknown; read_policy?: string }),
    ]);

    const auditList = Array.isArray(audit) ? audit : [];
    return {
      ...base,
      ok: true,
      count: list.length,
      owner: fingerprint(toHex(nsInfo.owner)),
      readPolicy: nsInfo.read_policy ?? null,
      entries: list,
      audit: auditList.map((a) => ({ ...a, actor: fingerprint(toHex(a.actor)) ?? "—" })),
    };
  } catch (err) {
    const reason =
      err instanceof Error
        ? /ECONN|fetch failed|7740|timed out|ETIMEDOUT/i.test(err.message)
          ? `Can't reach the Chromia server at ${config.nodeUrl}`
          : err.message.split("\n")[0]
        : "chain read failed";
    return { ...base, reason };
  }
}

// Semantic recall — embeds the query (OpenRouter) and cosine-ranks on-chain
// embeddings client-side. Returns results already ordered by similarity.
export async function searchMemory(
  query: string,
  limit = 6,
  namespace?: string,
): Promise<{ ok: boolean; reason?: string; results: MemoryEntry[] }> {
  const q = query.trim();
  if (!q) return { ok: true, results: [] };
  const nsArgs = namespace?.trim() ? ["--namespace", namespace.trim()] : [];
  try {
    const results = await runCli<MemoryEntry[] | { error: string }>(
      ["search", "--query", q, "--limit", String(limit), ...nsArgs],
      20_000,
    );
    if (!Array.isArray(results)) {
      return { ok: false, reason: results.error, results: [] };
    }
    return { ok: true, results };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message.split("\n")[0] : "search failed",
      results: [],
    };
  }
}
