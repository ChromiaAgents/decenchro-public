import { createHmac, timingSafeEqual } from "node:crypto";

// The documented API host (pay-docs.chromia.com). The old default,
// api.chromia-pay.com, has no DNS record, so it failed DNS three times per call
// and reported "chromia pay unreachable" — an outage-shaped error for a config
// mistake. CPAY_API_URL still overrides it; one host serves both stores and the
// key decides which one a request hits.
const DEFAULT_API_URL = "https://pay-api.chromia.com";
const SIGNATURE_WINDOW_S = 300;
const RETRY_STATUS = [429, 503];

export const PAYMENT_STATUSES = [
  "created",
  "pending",
  "confirmed",
  "overpaid",
  "underpaid",
  "expired",
  "canceled",
] as const;

export type PaymentStatus =
  | "created"
  | "pending"
  | "confirmed"
  | "overpaid"
  | "underpaid"
  | "expired"
  | "canceled";

export type Payment = {
  id: string;
  status: PaymentStatus;
  checkout_url?: string;
  amount?: string;
  // What the payer is told to send. Differs from `amount` when attribution dust
  // is added, and the docs are explicit that this, not `amount`, is the
  // settlement figure. Nothing here does arithmetic on it — fulfilment trusts
  // `status` — but a reader comparing the two should not be misled.
  amount_expected?: string;
  amount_paid?: string;
  currency?: string;
  settlement_asset?: string;
  livemode?: boolean;
  metadata?: Record<string, string>;
};

export type CpayEvent = {
  id: string;
  type: string;
  data: { payment: Payment };
};

export type CreatePaymentInput = {
  amount: string;
  currency?: "usd" | "chr";
  settlementAsset?: "chr" | "usdc" | "usdt";
  description?: string;
  metadata?: Record<string, string>;
  successUrl: string;
  cancelUrl?: string;
  expiresIn?: number;
  idempotencyKey?: string;
};

export function chromiaPayConfigured(): boolean {
  return Boolean(process.env.CPAY_SECRET_KEY && process.env.CPAY_WEBHOOK_SECRET);
}

function apiUrl(): string {
  return (process.env.CPAY_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}

function secretKey(): string {
  const key = process.env.CPAY_SECRET_KEY;
  if (!key) throw new Error("CPAY_SECRET_KEY is not set");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${secretKey()}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  let lastError = "chromia pay unreachable";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(300 * attempt * attempt);
    let res: Response;
    try {
      res = await fetch(`${apiUrl()}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      continue;
    }
    if (res.ok) return (await res.json()) as T;

    const text = await res.text();
    lastError = `chromia pay ${res.status}: ${text.slice(0, 300)}`;
    if (!RETRY_STATUS.includes(res.status)) throw new Error(lastError);
  }
  throw new Error(lastError);
}

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  return request<Payment>(
    "POST",
    "/v1/payments",
    {
      amount: input.amount,
      currency: input.currency,
      settlement_asset: input.settlementAsset,
      description: input.description,
      metadata: input.metadata,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_in: input.expiresIn,
    },
    input.idempotencyKey,
  );
}

export async function getPayment(id: string): Promise<Payment> {
  return request<Payment>("GET", `/v1/payments/${id}`);
}

export async function cancelPayment(id: string): Promise<Payment> {
  return request<Payment>("POST", `/v1/payments/${id}/cancel`);
}

export async function simulatePayment(
  id: string,
  options: { outcome: "confirmed" | "overpaid" | "underpaid" | "expired"; chain?: "chromia" | "bsc" | "base" },
): Promise<Payment> {
  return request<Payment>("POST", `/v1/test/payments/${id}/simulate_payment`, {
    outcome: options.outcome,
    chain: options.chain ?? "chromia",
  });
}

export function signPayload(rawBody: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs = Date.now(),
): CpayEvent | null {
  if (!header || !secret) return null;

  const parts = new Map(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k?.trim() ?? "", v?.trim() ?? ""] as [string, string];
    }),
  );
  const timestamp = Number(parts.get("t"));
  const given = parts.get("v1") ?? "";
  if (!Number.isFinite(timestamp) || !given) return null;
  if (Math.abs(nowMs / 1000 - timestamp) > SIGNATURE_WINDOW_S) return null;

  const expected = signPayload(rawBody, timestamp, secret);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;

  try {
    const event = JSON.parse(rawBody) as CpayEvent;
    if (!event?.id || !event?.data?.payment?.id) return null;
    return event;
  } catch {
    return null;
  }
}

// How far through its life a payment is. Webhook deliveries can arrive out of
// order, so a status is only written when it does not move the payment
// backwards: a late payment.pending must not walk a settled row back to
// pending, and a late payment.expired must not bury a confirmation.
//
// Paid outranks the other terminal states deliberately. If a link expires and
// the money then lands, the money is the more authoritative fact, so confirmed
// is allowed to overtake expired but never the other way round.
export function statusRank(status: PaymentStatus): number {
  switch (status) {
    case "created":
      return 0;
    case "pending":
      return 1;
    case "expired":
    case "canceled":
    case "underpaid":
      return 2;
    case "confirmed":
    case "overpaid":
      return 3;
  }
}

/** True when `next` is at least as far along as `current`. */
export function advances(current: string, next: PaymentStatus): boolean {
  const from = (PAYMENT_STATUSES as readonly string[]).includes(current)
    ? statusRank(current as PaymentStatus)
    : -1; // unrecognised stored value: let the fresh one win
  return statusRank(next) >= from;
}

export function isPaid(payment: Payment): boolean {
  return payment.status === "confirmed" || payment.status === "overpaid";
}

export function demo(): void {
  const a = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`chromia-pay self-check failed: ${msg}`);
  };

  const secret = "whsec_test_secret";
  const now = 1_786_710_545_000;
  const body = JSON.stringify({
    id: "evt_1",
    type: "payment.confirmed",
    data: { payment: { id: "pay_1", status: "confirmed" } },
  });
  const header = `t=${now / 1000},v1=${signPayload(body, now / 1000, secret)}`;

  a(verifyWebhook(body, header, secret, now)?.id === "evt_1", "a good signature verifies");
  a(verifyWebhook(body, header, "other-secret", now) === null, "a wrong secret fails");
  a(verifyWebhook(`${body} `, header, secret, now) === null, "a changed body fails");
  a(verifyWebhook(body, header, secret, now + 600_000) === null, "a stale timestamp fails");
  a(verifyWebhook(body, "t=abc,v1=zz", secret, now) === null, "a malformed header fails");
  a(verifyWebhook(body, null, secret, now) === null, "a missing header fails");
  a(verifyWebhook("not json", `t=${now / 1000},v1=${signPayload("not json", now / 1000, secret)}`, secret, now) === null, "a non-event body fails");

  a(advances("pending", "confirmed"), "a confirmation lands on a pending row");
  a(!advances("confirmed", "pending"), "a late pending never walks a paid row back");
  a(!advances("overpaid", "pending"), "nor an overpaid one");
  a(advances("expired", "confirmed"), "money arriving beats an earlier expiry");
  a(!advances("confirmed", "expired"), "but an expiry never buries a confirmation");
  a(advances("confirmed", "overpaid"), "one paid state may refine another");
  a(advances("nonsense", "pending"), "an unrecognised stored status yields to a fresh one");

  a(isPaid({ id: "p", status: "confirmed" }), "confirmed is paid");
  a(isPaid({ id: "p", status: "overpaid" }), "overpaid is paid");
  a(!isPaid({ id: "p", status: "underpaid" }), "underpaid is not paid");
  a(!isPaid({ id: "p", status: "pending" }), "pending is not paid");

  console.log("chromia-pay self-check: OK");
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
