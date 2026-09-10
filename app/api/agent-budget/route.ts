import { NextResponse } from "next/server";

import { getOwner, isRequestAdmin } from "@/lib/dashboard/auth";
import {
  getDeploymentRow,
  updateDeployment,
} from "@/lib/dashboard/deployments";

export const dynamic = "force-dynamic";

// POST /api/agent-budget — set or clear an agent's monthly USD budget.
// Body: { deploymentId, budgetUsd }  (budgetUsd null/0 clears it).
// Admin + ownership gated. Requires migration 0005 (monthly_budget_usd column).
export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ error: "no company profile" }, { status: 403 });

  let body: { deploymentId?: string; budgetUsd?: number | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { deploymentId } = body;
  if (!deploymentId)
    return NextResponse.json({ error: "deploymentId required" }, { status: 400 });

  const raw = body.budgetUsd;
  if (raw != null && (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0))
    return NextResponse.json({ error: "budgetUsd must be a non-negative number or null" }, { status: 400 });
  // Round to cents; 0 clears the budget.
  const budget = raw == null || raw === 0 ? null : Math.round(raw * 100) / 100;

  const row = await getDeploymentRow(deploymentId);
  if (!row || row.company_id !== owner.companyId)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await updateDeployment(deploymentId, { monthly_budget_usd: budget });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "update failed";
    // Most likely the migration hasn't been applied yet.
    return NextResponse.json(
      { error: `${msg} — is migration 0005 applied?` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, budgetUsd: budget });
}
