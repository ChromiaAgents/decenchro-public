import { NextResponse } from "next/server";

import { IDLE_DESTROY_MS, IDLE_REMOVED_REASON } from "@/lib/dashboard/credits";
import { teardownDeployment } from "@/lib/dashboard/deploy";
import {
  listLiveDeployments,
  listIdleDeployments,
} from "@/lib/dashboard/deployments";
import { meterCompanySafe } from "@/lib/dashboard/metering";
import { fetchCredits } from "@/lib/dashboard/openrouter";

export const dynamic = "force-dynamic";

const DRIFT_TOLERANCE = 0.15;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret
    ? req.headers.get("authorization") === `Bearer ${secret}`
    : req.headers.get("x-vercel-cron") != null;
  if (!authed)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const live = await listLiveDeployments();
  const companies = [...new Set(live.map((r) => r.company_id))];
  for (const companyId of companies) {
    await meterCompanySafe(
      companyId,
      live.filter((r) => r.company_id === companyId),
    );
  }

  // Reclaim anything sitting stopped past the idle window. The disk bills while
  // it exists, so a stopped agent is pure cost, and keeping its own fail_reason
  // means the operator still sees why it went down rather than a generic note.
  const idle = await listIdleDeployments();
  const cutoff = Date.now() - IDLE_DESTROY_MS;
  let destroyed = 0;
  for (const row of idle) {
    if (new Date(row.updated_at).getTime() > cutoff) continue;
    try {
      await teardownDeployment(row, row.fail_reason ?? IDLE_REMOVED_REASON);
      destroyed++;
    } catch {
      continue;
    }
  }

  const reported = live.reduce((sum, r) => sum + Number(r.llm_cost_billed ?? 0), 0);
  const account = await fetchCredits();
  if (account.ok && typeof account.totalUsage === "number" && account.totalUsage > 0) {
    const drift = (account.totalUsage - reported) / account.totalUsage;
    if (drift > DRIFT_TOLERANCE)
      console.log(
        `[AUDIT] llm spend drift reported=${reported.toFixed(4)} account=${account.totalUsage.toFixed(4)}`,
      );
  }

  return NextResponse.json({
    ok: true,
    companies: companies.length,
    metered: live.length,
    destroyed,
  });
}
