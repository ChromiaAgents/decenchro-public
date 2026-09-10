import { NextResponse } from "next/server";

import { getOwner } from "@/lib/dashboard/auth";
import { getPaymentRow } from "@/lib/dashboard/credit-ledger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const row = await getPaymentRow(id);
  if (!row || row.company_id !== owner.companyId)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    status: row.status,
    credits: row.credits,
    packId: row.pack_id,
    asset: row.settlement_asset,
  });
}
