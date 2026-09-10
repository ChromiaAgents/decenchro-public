import { NextResponse } from "next/server";

import { getOwner } from "@/lib/dashboard/auth";
import { planSummary } from "@/lib/dashboard/plan";

export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await planSummary(owner.companyId));
}

export async function POST() {
  return NextResponse.json(
    { error: "plans are replaced by credits; use /api/credits/checkout" },
    { status: 410 },
  );
}
