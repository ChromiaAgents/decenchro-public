import { NextResponse } from "next/server";

import {
  scanListAgents,
  scanSemanticSearch,
  type ScanAgentSummary,
} from "@/lib/marketplace/scan8004";

// GET /api/marketplace/search?q=&chainId= — public search proxy so the
// SCAN8004_API_KEY never reaches a browser. Semantic search first (it 500s
// anonymously, so it is strictly a progressive enhancement), then the keyword
// /agents?search= endpoint as the dependable fallback.

export const dynamic = "force-dynamic";

function slim(a: ScanAgentSummary) {
  return {
    chainId: a.chain_id,
    tokenId: String(a.token_id),
    name: a.name?.trim() || `Agent #${a.token_id}`,
    description: (a.description ?? "").slice(0, 280),
    imageUrl: a.image_url || null,
    protocols: a.supported_protocols ?? [],
    averageScore: a.total_feedbacks > 0 ? a.average_score : null,
    totalFeedbacks: a.total_feedbacks ?? 0,
    isTestnet: Boolean(a.is_testnet),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const chainRaw = url.searchParams.get("chainId");
  const chainId = chainRaw ? Number.parseInt(chainRaw, 10) : undefined;

  if (q.length < 2 || q.length > 80) {
    return NextResponse.json(
      { ok: false, error: "q must be 2-80 characters" },
      { status: 400 },
    );
  }
  if (chainId !== undefined && chainId !== 56 && chainId !== 97) {
    return NextResponse.json(
      { ok: false, error: "chainId must be 56 or 97" },
      { status: 400 },
    );
  }

  let mode: "semantic" | "keyword" = "semantic";
  let rows = await scanSemanticSearch(q, chainId);
  if (!rows) {
    mode = "keyword";
    const listed = await scanListAgents({
      chainId,
      search: q,
      sortBy: "total_score",
      sortOrder: "desc",
      limit: 20,
    });
    rows = listed?.agents ?? null;
  }

  if (!rows) {
    return NextResponse.json(
      { ok: false, error: "search upstream unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, mode, results: rows.slice(0, 20).map(slim) },
    {
      headers: {
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
