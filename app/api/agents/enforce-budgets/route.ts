import { NextResponse } from "next/server";

import { enforceAgentBudget, fetchAgentMetrics } from "@/lib/dashboard/agent-metrics";
import {
  listBudgetedRunningDeployments,
  metricsBase,
} from "@/lib/dashboard/deployments";

export const dynamic = "force-dynamic";

// GET /api/agents/enforce-budgets — background sweep (Vercel cron) that pauses
// any running agent whose month-to-date spend has reached its budget, so
// auto-pause fires even with no dashboard open. Idempotent.
//
// Auth: when CRON_SECRET is set, Vercel sends `Authorization: Bearer <secret>`
// and we require it. Without CRON_SECRET the route only runs for Vercel's own
// cron header — never for arbitrary callers.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret
    ? req.headers.get("authorization") === `Bearer ${secret}`
    : req.headers.get("x-vercel-cron") != null;
  if (!authed)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await listBudgetedRunningDeployments();
  let checked = 0;
  let paused = 0;
  for (const row of rows) {
    // Skip agents with no reachable address yet. metricsBase covers both shapes:
    // a VM's IP and a container host's HTTPS endpoint.
    if (!metricsBase(row)) continue;
    checked++;
    const result = await fetchAgentMetrics(row);
    if (!result.ok) continue;
    const spent = result.metrics.spendMonth || result.metrics.tokens.costUsd;
    if (await enforceAgentBudget(row, spent)) paused++;
  }
  return NextResponse.json({ ok: true, checked, paused });
}
