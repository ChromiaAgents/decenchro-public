import { NextResponse } from "next/server";

import {
  budgetInfo,
  enforceAgentBudget,
  fetchAgentMetrics,
} from "@/lib/dashboard/agent-metrics";
import { getOwner, isRequestAuthed } from "@/lib/dashboard/auth";
import { listDeploymentRows, metricsBase } from "@/lib/dashboard/deployments";
import { meterCompanyThrottled } from "@/lib/dashboard/metering";

export const dynamic = "force-dynamic";

// GET /api/agent-metrics?pubkey=<atbashPubkey>|?id=<deploymentId> — live activity
// for one of the caller's deployed agents, read from the VPS metrics endpoint.
// Ownership is enforced by scoping the lookup to the caller's company; a target
// outside it simply isn't found. With no selector, returns the company's first
// deployment that has a server address.
export async function GET(request: Request) {
  if (!(await isRequestAuthed()))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const owner = await getOwner();
  if (!owner) return NextResponse.json({ ok: false, reason: "no workspace" });

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const pubkey = params.get("pubkey")?.toLowerCase();
  try {
    const rows = await listDeploymentRows(owner.companyId);
    const row = pubkey
      ? rows.find((r) => r.atbash_pubkey.toLowerCase() === pubkey)
      : id
        ? rows.find((r) => r.id === id)
        : // No id or pubkey given: fall back to any agent we can actually reach.
          rows.find((r) => metricsBase(r));
    if (!row) return NextResponse.json({ ok: false, reason: "agent not found" });

    const result = await fetchAgentMetrics(row);
    if (!result.ok) {
      // Still surface a budget shell (from the stored cap) so the UI can show
      // the configured budget even when the host is briefly unreachable.
      const budget = budgetInfo(row.monthly_budget_usd, 0);
      return NextResponse.json({
        ok: false,
        agentId: row.id,
        reason: result.reason,
        budget,
      });
    }

    const spent = result.metrics.spendMonth || result.metrics.tokens.costUsd;
    await meterCompanyThrottled(owner.companyId, rows);
    const paused = await enforceAgentBudget(row, spent);
    const budget = { ...budgetInfo(row.monthly_budget_usd, spent), paused };
    return NextResponse.json({
      ok: true,
      agentId: row.id,
      metrics: result.metrics,
      budget,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "failed";
    return NextResponse.json({ ok: false, reason });
  }
}
