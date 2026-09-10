import { NextResponse } from "next/server";

import { advances, isPaid, verifyWebhook } from "@/lib/chromia-pay";
import {
  applyCredit,
  getPaymentRowByCpayId,
  recordEvent,
  updatePaymentRow,
} from "@/lib/dashboard/credit-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CPAY_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });

  const rawBody = await req.text();
  const event = verifyWebhook(rawBody, req.headers.get("chromia-pay-signature"), secret);
  if (!event)
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  const payment = event.data.payment;

  const fresh = await recordEvent(event.id, event.type, payment.id);
  if (!fresh) return NextResponse.json({ ok: true, duplicate: true });

  const row = await getPaymentRowByCpayId(payment.id);
  if (!row) return NextResponse.json({ ok: true, unknown: true });

  // The endpoint is subscribed to every event type, so pending, expired and
  // canceled all arrive here too, and the docs are explicit that deliveries can
  // come out of order. Writing the status unconditionally let a late pending
  // walk a settled row backwards, which showed a paid top-up as still waiting.
  if (advances(row.status, payment.status))
    await updatePaymentRow(row.id, { status: payment.status });

  // Fulfilment is guarded separately, on the status as it was read. event.id
  // dedup already stops a repeat of the same delivery; this stops a second,
  // different paid event crediting the same pack twice.
  if (isPaid(payment) && row.status !== "confirmed" && row.status !== "overpaid") {
    await applyCredit({
      companyId: row.company_id,
      delta: row.credits,
      kind: "topup",
      ref: payment.id,
      note: `${row.pack_id} pack, ${row.settlement_asset.toUpperCase()}`,
    });
    console.log(
      `[AUDIT] credits topup company=${row.company_id} credits=${row.credits} payment=${payment.id}`,
    );
  }

  return NextResponse.json({ ok: true });
}
