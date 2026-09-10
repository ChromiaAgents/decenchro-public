import "server-only";

// Typed client for the 8004scan public API (live-verified 2026-08-19).
//
// Base: https://8004scan.io/api/v1/public, optional X-API-Key (SCAN8004_API_KEY;
// anonymous works at 10 req/min, which the revalidate windows below respect).
// Every fetcher returns null on ANY failure — network, non-200, success:false,
// unexpected shape — so the marketplace renders with whatever it has rather
// than 500ing on a third-party outage.
//
// Field-name notes from probing the live API (they differ from early docs):
// - average_score is 0-100, not 0-5.
// - list rows carry image_url (not image) and have NO tags/categories/
//   total_validations — those exist only on the detail endpoint.
// - /feedbacks ignores its tokenId filter and just returns the chain's newest
//   feedbacks, so per-agent activity filters by row.agent.token_id here.

const SCAN_BASE = "https://8004scan.io/api/v1/public";

/** Row shape of GET /agents (list). */
export type ScanAgentSummary = {
  agent_id: string; // "56:0x8004a169…:49637"
  token_id: string;
  chain_id: number;
  contract_address: string;
  is_testnet: boolean;
  name: string | null;
  description: string | null;
  image_url: string | null;
  supported_protocols: string[] | null;
  x402_supported: boolean;
  total_score: number;
  health_score: number | null;
  total_feedbacks: number;
  average_score: number;
  created_at: string;
  updated_at: string;
};

/** GET /agents/{chainId}/{tokenId} — the fields the detail page renders. */
export type ScanAgentDetail = ScanAgentSummary & {
  owner_address: string | null;
  agent_wallet: string | null;
  tags: string[] | null;
  categories: string[] | null;
  services: Record<string, { endpoint?: string } & Record<string, unknown>> | null;
  mcp_server: string | null;
  a2a_endpoint: string | null;
  agent_url: string | null;
  is_endpoint_verified: boolean;
  is_active: boolean | null;
  total_validations: number;
  successful_validations: number;
  created_tx_hash: string | null;
  created_block_number: number | null;
  supported_trust_models: string[] | null;
  raw_metadata: {
    onchain?: unknown;
    offchain_uri?: string | null;
    offchain_content?: unknown;
  } | null;
};

/** Row shape of GET /feedbacks. */
export type ScanFeedback = {
  score: number | null;
  comment: string | null;
  tag1: string | null;
  tag2: string | null;
  endpoint: string | null;
  transaction_hash: string | null;
  user_address: string | null;
  submitted_at: string | null;
  agent: { token_id: string; chain_id: number; name: string | null } | null;
};

export type ScanStats = {
  total_agents: number;
  total_feedbacks: number;
  total_validations: number;
  daily_new_agents: number;
  average_feedback_score: number | null;
};

type Envelope<T> = {
  success?: boolean;
  data?: T;
  meta?: { pagination?: { total?: number; hasMore?: boolean } };
};

function headers(): Record<string, string> {
  const key = (process.env.SCAN8004_API_KEY ?? "").trim();
  return key ? { "X-API-Key": key } : {};
}

/**
 * One guarded GET. `revalidate` drives Next's fetch cache (shared across
 * requests, so the anonymous 10 req/min budget is spent once per window, not
 * once per visitor); pass `noStore` for the live endpoints instead.
 */
async function scanGet<T>(
  path: string,
  opts: { revalidate?: number; noStore?: boolean; timeoutMs?: number } = {},
): Promise<Envelope<T> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
  try {
    const res = await fetch(`${SCAN_BASE}${path}`, {
      headers: headers(),
      signal: controller.signal,
      ...(opts.noStore
        ? { cache: "no-store" as const }
        : { next: { revalidate: opts.revalidate ?? 60 } }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Envelope<T>;
    if (body?.success === false) return null;
    return body ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function scanStats(): Promise<ScanStats | null> {
  const body = await scanGet<ScanStats>("/stats", { revalidate: 120 });
  return body?.data ?? null;
}

export async function scanListAgents(params: {
  chainId?: number;
  search?: string;
  protocol?: string;
  sortBy?: "created_at" | "stars" | "name" | "token_id" | "total_score";
  sortOrder?: "asc" | "desc";
  limit?: number;
  page?: number;
  revalidate?: number;
}): Promise<{ agents: ScanAgentSummary[]; total: number | null } | null> {
  const q = new URLSearchParams();
  if (params.chainId) q.set("chainId", String(params.chainId));
  if (params.search) q.set("search", params.search);
  if (params.protocol) q.set("protocol", params.protocol);
  q.set("sortBy", params.sortBy ?? "total_score");
  q.set("sortOrder", params.sortOrder ?? "desc");
  q.set("limit", String(Math.min(params.limit ?? 50, 100)));
  if (params.page) q.set("page", String(params.page));
  const body = await scanGet<ScanAgentSummary[]>(`/agents?${q.toString()}`, {
    revalidate: params.revalidate ?? 60,
  });
  if (!body || !Array.isArray(body.data)) return null;
  return { agents: body.data, total: body.meta?.pagination?.total ?? null };
}

export async function scanAgentDetail(
  chainId: number,
  tokenId: string,
): Promise<ScanAgentDetail | null> {
  if (!/^\d{1,78}$/.test(tokenId)) return null;
  const body = await scanGet<ScanAgentDetail>(`/agents/${chainId}/${tokenId}`, {
    revalidate: 120,
  });
  const d = body?.data;
  return d && typeof d === "object" && d.token_id ? d : null;
}

/**
 * Newest feedbacks on a chain. The public endpoint has no working per-agent
 * filter (verified live), so callers filter by `agent.token_id` themselves.
 */
export async function scanRecentFeedbacks(
  chainId: number,
  opts: { limit?: number; noStore?: boolean } = {},
): Promise<ScanFeedback[] | null> {
  const q = new URLSearchParams({
    chainId: String(chainId),
    limit: String(Math.min(opts.limit ?? 100, 100)),
  });
  const body = await scanGet<ScanFeedback[]>(`/feedbacks?${q.toString()}`, {
    revalidate: 30,
    noStore: opts.noStore,
  });
  return Array.isArray(body?.data) ? body.data : null;
}

/**
 * Semantic search (progressive enhancement only: 500s anonymously, so callers
 * must keep the keyword /agents?search= path as the fallback).
 */
export async function scanSemanticSearch(
  q: string,
  chainId?: number,
): Promise<ScanAgentSummary[] | null> {
  const params = new URLSearchParams({ q });
  if (chainId) params.set("chainId", String(chainId));
  const body = await scanGet<ScanAgentSummary[]>(
    `/agents/search?${params.toString()}`,
    { revalidate: 60, timeoutMs: 4_000 },
  );
  return Array.isArray(body?.data) ? body.data : null;
}
