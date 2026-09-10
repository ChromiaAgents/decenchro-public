import { NextResponse } from "next/server";

import { getOwner } from "@/lib/dashboard/auth";
import { listLedger } from "@/lib/dashboard/credit-ledger";
import {
  PACKS,
  RUNTIME_BLOCK_MINUTES,
  RUNTIME_CREDITS_PER_HOUR,
  SETTLEMENT_ASSETS,
  SIGNUP_GRANT_CREDITS,
} from "@/lib/dashboard/credits";
import { planSummary } from "@/lib/dashboard/plan";

export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [summary, ledger] = await Promise.all([
    planSummary(owner.companyId),
    listLedger(owner.companyId),
  ]);

  return NextResponse.json({
    summary,
    ledger,
    packs: PACKS,
    assets: SETTLEMENT_ASSETS,
    runtimeCreditsPerHour: RUNTIME_CREDITS_PER_HOUR,
    runtimeBlockMinutes: RUNTIME_BLOCK_MINUTES,
    signupGrant: SIGNUP_GRANT_CREDITS,
  });
}
