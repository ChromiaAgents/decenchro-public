import { NextResponse } from "next/server";

import { agentLiveActivity } from "@/lib/marketplace/activity";

// GET /api/marketplace/live?chainId=&tokenId= — one-shot live read for the
// detail page's 15s poll: on-chain reputation, the newest feedback we can see,
// and (for Decenchro agents) status + guarded-action count. Public and
// unauthenticated: everything in the response is public chain/index data.
// The CDN shields the upstreams: s-maxage=15 means at most four origin hits a
// minute per agent no matter how many tabs are polling.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = Number.parseInt(url.searchParams.get("chainId") ?? "", 10);
  const tokenId = (url.searchParams.get("tokenId") ?? "").trim();

  if ((chainId !== 56 && chainId !== 97) || !/^\d{1,78}$/.test(tokenId)) {
    return NextResponse.json(
      { ok: false, error: "expected chainId 56|97 and a numeric tokenId" },
      { status: 400 },
    );
  }

  try {
    const activity = await agentLiveActivity(chainId, tokenId, { noStore: true });
    return NextResponse.json(
      { ok: true, ...activity },
      {
        headers: {
          "cache-control": "public, s-maxage=15, stale-while-revalidate=45",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "live read failed" },
      { status: 502 },
    );
  }
}
