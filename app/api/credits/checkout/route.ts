import { NextResponse } from "next/server";

import { chromiaPayConfigured, createPayment } from "@/lib/chromia-pay";
import { getOwner, isRequestAdmin } from "@/lib/dashboard/auth";
import { createPaymentRow, updatePaymentRow } from "@/lib/dashboard/credit-ledger";
import { isSettlementAsset, packById, usdAmountString } from "@/lib/dashboard/credits";

export const dynamic = "force-dynamic";

function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!chromiaPayConfigured())
    return NextResponse.json(
      { error: "payments are not configured: set CPAY_SECRET_KEY and CPAY_WEBHOOK_SECRET" },
      { status: 503 },
    );

  let body: { packId?: string; asset?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const pack = packById((body.packId ?? "").trim());
  if (!pack) return NextResponse.json({ error: "unknown pack" }, { status: 400 });

  const asset = (body.asset ?? "").trim().toLowerCase();
  if (!isSettlementAsset(asset))
    return NextResponse.json({ error: "unknown settlement asset" }, { status: 400 });

  const row = await createPaymentRow({
    companyId: owner.companyId,
    packId: pack.id,
    credits: pack.credits,
    amountUsd: pack.usd,
    asset,
  });

  const base = appBaseUrl();
  try {
    const payment = await createPayment({
      amount: usdAmountString(pack.usd),
      currency: "usd",
      settlementAsset: asset,
      description: `Decenchro ${pack.label}: ${pack.credits.toLocaleString()} credits`,
      metadata: { company_id: owner.companyId, payment_id: row.id, pack_id: pack.id },
      // Sections are real routes now, and the ?tab= redirect forwards only
      // `reason` — pointing at the legacy URL would drop `topup` and leave the
      // Credits view with no payment to confirm.
      successUrl: `${base}/dashboard/billing?topup=${row.id}`,
      cancelUrl: `${base}/dashboard/billing`,
      idempotencyKey: row.id,
    });

    await updatePaymentRow(row.id, {
      cpay_payment_id: payment.id,
      status: payment.status ?? "created",
    });

    return NextResponse.json({ paymentId: row.id, checkoutUrl: payment.checkout_url });
  } catch (err) {
    await updatePaymentRow(row.id, { status: "canceled" }).catch(() => {});
    const message = err instanceof Error ? err.message : "could not start checkout";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
