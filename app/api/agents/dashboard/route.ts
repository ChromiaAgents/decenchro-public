import { NextResponse } from "next/server";

import {
  DASHBOARD_USERNAME,
  dashboardPassword,
  dashboardUrl,
} from "@/lib/dashboard/agent-dashboard";
import { getOwner, isRequestAuthed } from "@/lib/dashboard/auth";
import { getDeploymentRow } from "@/lib/dashboard/deployments";

export const dynamic = "force-dynamic";

// POST /api/agents/dashboard { deploymentId } — where to reach this agent's
// Hermes dashboard, and the credentials to get in. Auth + ownership gated.
//
// POST, not GET, and that is the whole point of this version. The route existed
// before as a GET the fleet card fired from an effect, so the password reached
// the browser on every card render whether or not anyone wanted it, and sat in
// any intermediary that caches GETs. It was deleted for that (3a18623). A POST
// is not prefetched, not cached and not repeated by a bfcache restore, so the
// password crosses the wire only when an operator clicks for it.
//
// Deliberately not fields on /api/agents: that roster is polled every 3-60s by
// every open console tab, and a login password has no business riding along on
// a poll.
//
// The password is derived (HMAC of the deployment id), so nothing is read from
// the database and there is no secret to leak for an agent that never had a
// dashboard — dashboardUrl() returns null and the caller gets nothing to log
// into.
export async function POST(req: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ error: "no company profile" }, { status: 403 });

  let deploymentId: unknown;
  try {
    ({ deploymentId } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof deploymentId !== "string" || !deploymentId)
    return NextResponse.json({ error: "deploymentId required" }, { status: 400 });

  const row = await getDeploymentRow(deploymentId);
  // Same 404 for "no such agent" and "not yours" — the distinction is itself
  // information about another tenant's fleet.
  if (!row || row.company_id !== owner.companyId)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = dashboardUrl(row);
  // No dashboard on this deployment (a retired-provider VM, or no endpoint
  // recorded yet). A null url rather than a 404, so the card can say so.
  if (!url) return NextResponse.json({ url: null });

  return NextResponse.json({
    url,
    username: DASHBOARD_USERNAME,
    password: dashboardPassword(row.id),
  });
}
