import { NextResponse } from "next/server";

import { deployWebhookTokenValid } from "@/lib/dashboard/deploy-token";
import { getDeploymentRow, updateDeployment } from "@/lib/dashboard/deployments";
import { getBalance } from "@/lib/dashboard/credit-ledger";
import { projectedExpiry } from "@/lib/dashboard/credits";
import { countLiveAgents, getCompanyPlan } from "@/lib/dashboard/plan";

export const dynamic = "force-dynamic";

// Callback target for the cloud-init script running on the VPS. Token-auth (not
// session auth — the caller is the VPS, not a user), and the token is bound to
// the deployment id it names, so a token lifted off one droplet cannot drive
// another tenant's deployment. Two shapes:
//   ?id=&phase=N&token=     — intermediate progress (provision_phase)
//   ?id=&status=ready|...&token=  — terminal (running | failed)

export async function POST(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const phase = url.searchParams.get("phase");
  const status = url.searchParams.get("status");
  const token = url.searchParams.get("token");

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!deployWebhookTokenValid(id, token))
    return NextResponse.json({ error: "invalid token" }, { status: 403 });

  const row = await getDeploymentRow(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Don't resurrect a deleted/stopped agent from a late callback.
  if (row.status === "deleted" || row.status === "stopped")
    return NextResponse.json({ ok: true, ignored: true });

  const now = new Date().toISOString();

  // Intermediate phase update.
  if (phase && !status) {
    const n = parseInt(phase, 10);
    if (!Number.isNaN(n))
      await updateDeployment(id, { provision_phase: n, last_seen: now });
    return NextResponse.json({ ok: true });
  }

  // Terminal status.
  const ready = status === "ready";

  const startMeter = ready && row.status !== "running";
  let meterPatch = {};
  if (startMeter) {
    const [plan, balance, liveAgents] = await Promise.all([
      getCompanyPlan(row.company_id),
      getBalance(row.company_id),
      countLiveAgents(row.company_id),
    ]);
    meterPatch = {
      metered_until: now,
      // Same gate as the metering cursor, and for the same reason: this is the
      // moment the agent went live. created_at would include provisioning.
      started_at: now,
      expires_at:
        plan === "enterprise"
          ? null
          : projectedExpiry(balance, liveAgents + 1, Date.now()),
    };
  }

  await updateDeployment(id, {
    status: ready ? "running" : "failed",
    provision_phase: ready ? 7 : row.provision_phase,
    last_seen: now,
    ...meterPatch,
    ...(ready ? {} : { fail_reason: "cloud-init reported failure" }),
  });
  return NextResponse.json({ ok: true });
}
