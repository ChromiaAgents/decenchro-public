import { NextResponse } from "next/server";

import { getOwner, isRequestAuthed } from "@/lib/dashboard/auth";
import { listAgentsWithSpend } from "@/lib/dashboard/deploy";

export const dynamic = "force-dynamic";

// GET /api/agents — the caller's company's managed cloud agents (registry view,
// no secrets), with transient states (provisioning/starting/stopping) settled
// against reality on every read. The dashboard joins these with the on-chain
// fleet by pubkey to show host + lifecycle controls alongside audit stats.
export async function GET() {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ agents: [] });
  try {
    // Spend is joined by listAgentsWithSpend rather than inside
    // listReconciledAgents: that function also runs from the crons, which have
    // no use for the aggregate and would pay for it on every sweep.
    return NextResponse.json({ agents: await listAgentsWithSpend(owner.companyId) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ agents: [], error: msg });
  }
}
