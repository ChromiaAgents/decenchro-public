import { NextResponse } from "next/server";

import { fetchOrgToolCalls } from "@/lib/dashboard/atbash";
import { getOwner, isRequestAuthed } from "@/lib/dashboard/auth";
import { listDeploymentRows } from "@/lib/dashboard/deployments";

export const dynamic = "force-dynamic";

// GET /api/audits?limit= — the caller's agents' signed tool calls.
//
// SCOPED TO THE CALLER'S COMPANY, deliberately. The underlying Atbash read is
// org-wide and ATBASH_ORG_NAME is a single platform-wide value, so every
// company's agents share one org: returning the raw feed handed any signed-in
// user every other tenant's audit records. The view then filtered by pubkey in
// the browser, which is presentation, not access control.
//
// The company's own agents are its non-deleted deployment rows. An agent that
// signs on-chain but was never registered here is therefore not in this feed —
// accepted, because the alternative is showing rows we cannot attribute to the
// caller.
export async function GET(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ ok: true, records: [], agents: [] });

  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(1, Math.min(100, Number(limitRaw) || 20));

  const [result, rows] = await Promise.all([
    // Over-fetch: the org feed is shared, so the caller's slice of `limit` rows
    // can sit anywhere in it. Capped at the SDK's ceiling.
    fetchOrgToolCalls(Math.min(100, limit * 2)),
    listDeploymentRows(owner.companyId),
  ]);

  const mine = new Set(
    rows.map((r) => (r.atbash_pubkey ?? "").toLowerCase()).filter(Boolean),
  );
  const records = result.records
    .filter((r) => mine.has((r.agentPubkey ?? "").toLowerCase()))
    .slice(0, limit);
  // Rebuild the agent tags from what survived, so the filter dropdown cannot
  // advertise another tenant's agents.
  const agents = result.agents.filter((a) =>
    mine.has((a.pubkey ?? "").toLowerCase()),
  );

  return NextResponse.json({ ...result, records, agents });
}
