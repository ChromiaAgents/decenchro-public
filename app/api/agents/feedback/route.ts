import { NextResponse } from "next/server";

import { getOwner, isRequestAuthed } from "@/lib/dashboard/auth";
import { bscConfigured, giveAgentFeedback } from "@/lib/dashboard/bsc";
import { getDeploymentRow } from "@/lib/dashboard/deployments";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/agents/feedback { deploymentId, value } — operator rates their own
// agent 0-100; the platform wallet signs an ERC-8004 giveFeedback on the
// ReputationRegistry (tag1 "operator-review", tag2 = the agent's category).
// POST-only for the same reason as /api/agents/dashboard: it costs gas and
// must never ride a poll or a prefetch. Ownership gated like every agent route;
// the same 404 covers "no such agent" and "not yours".
export async function POST(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ error: "no company profile" }, { status: 403 });
  if (!bscConfigured())
    return NextResponse.json({ error: "bsc not configured" }, { status: 503 });

  let deploymentId: unknown;
  let value: unknown;
  try {
    ({ deploymentId, value } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof deploymentId !== "string" || !deploymentId)
    return NextResponse.json({ error: "deploymentId required" }, { status: 400 });
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100)
    return NextResponse.json({ error: "value must be 0-100" }, { status: 400 });

  const row = await getDeploymentRow(deploymentId);
  if (!row || row.company_id !== owner.companyId)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.erc8004_agent_id == null)
    return NextResponse.json(
      { error: "agent has no on-chain identity yet" },
      { status: 409 },
    );

  try {
    const { txHash } = await giveAgentFeedback(
      row.erc8004_agent_id,
      score,
      row.category_id ?? "general",
    );
    return NextResponse.json({ ok: true, txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "feedback failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
