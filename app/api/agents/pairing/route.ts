import { NextResponse } from "next/server";

import { getOwner, isRequestAdmin, isRequestAuthed } from "@/lib/dashboard/auth";
import { PairingUnavailable, approvePairing, listPairing } from "@/lib/dashboard/agent-pairing";
import { type DeploymentRow, getDeploymentRow } from "@/lib/dashboard/deployments";

export const dynamic = "force-dynamic";

// Pairing requests waiting on a deployed agent, and approval for them.
//
// Hermes answers an unknown sender with a one-time code and "ask the bot owner
// to run `hermes pairing approve …`". On Render the tenant has no shell, so
// before this route a second person on WhatsApp or Telegram simply could not be
// let in. This is the approval surface; lib/dashboard/agent-pairing.ts does the
// talking and keeps the console credentials server-side.
//
// GET reads (any authed member), POST approves (admin only) — the same split
// /api/agents/manage uses, because approving a sender grants them the agent's
// tools and the company's credits.
//
// Not folded into the /api/agents roster: reaching every agent's own HTTP
// endpoint on a 3-60s fleet poll would turn one slow container into a slow
// console for everyone. The Fleet card asks per agent, when it is expanded.

/** 401/403/404 gate shared by both verbs. Returns the row or a response. */
async function authorize(
  deploymentId: unknown,
  admin: boolean,
): Promise<{ row: DeploymentRow } | { res: NextResponse }> {
  if (admin) {
    if (!(await isRequestAdmin()))
      return { res: NextResponse.json({ error: "admin role required" }, { status: 403 }) };
  } else if (!(await isRequestAuthed())) {
    return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const owner = await getOwner();
  if (!owner) return { res: NextResponse.json({ error: "no company profile" }, { status: 403 }) };

  if (typeof deploymentId !== "string" || !deploymentId)
    return { res: NextResponse.json({ error: "deploymentId required" }, { status: 400 }) };

  const row = await getDeploymentRow(deploymentId);
  // Same 404 for "no such agent" and "not yours" — the distinction is itself
  // information about another tenant's fleet.
  if (!row || row.company_id !== owner.companyId)
    return { res: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { row };
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const gate = await authorize(id, false);
  if ("res" in gate) return gate.res;

  try {
    return NextResponse.json({ pending: await listPairing(gate.row) });
  } catch (e) {
    // A sleeping or crashed agent is the common case, not an incident: report
    // it as an empty list plus a reason so the card can stay quiet about it.
    const reason = e instanceof PairingUnavailable ? e.message : "could not reach the agent";
    return NextResponse.json({ pending: [], reason });
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const gate = await authorize(body.deploymentId, true);
  if ("res" in gate) return gate.res;

  const { platform, requestId } = body;
  if (typeof platform !== "string" || !platform || typeof requestId !== "string" || !requestId)
    return NextResponse.json({ error: "platform and requestId required" }, { status: 400 });

  try {
    const user = await approvePairing(gate.row, platform, requestId);
    console.log(
      `[AUDIT] pairing approve platform=${platform} deployment=${gate.row.id} user=${user.userId}`,
    );
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    const reason = e instanceof PairingUnavailable ? e.message : "could not reach the agent";
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}
