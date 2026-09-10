import "server-only";

import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";

import { db, rawSql } from "@/lib/db/client";
import { companies, cpay_events, credit_ledger, credit_payments } from "@/db/schema";

import { SIGNUP_GRANT_CREDITS, type SettlementAsset } from "./credits";

export type LedgerKind = "grant" | "topup" | "runtime" | "llm" | "adjustment";

export type LedgerEntry = {
  id: string;
  delta: number;
  balanceAfter: number;
  kind: LedgerKind;
  note: string | null;
  createdAt: string;
};

export type PaymentRow = {
  id: string;
  company_id: string;
  cpay_payment_id: string | null;
  pack_id: string;
  credits: number;
  amount_usd: number;
  settlement_asset: SettlementAsset;
  status: string;
  created_at: string;
};

export async function getBalance(companyId: string): Promise<number> {
  try {
    const [row] = await db()
      .select({ balance: companies.credit_balance })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    return Number(row?.balance ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Move the balance and write the ledger entry in one statement.
 *
 * Still a database function rather than two queries here: it has to be atomic,
 * or a crash between the two leaves a balance nobody can account for. It is also
 * idempotent on (kind, ref) — a retried top-up hits the unique index, the
 * function swallows it and returns the balance already recorded.
 *
 * Called through rawSql() because Drizzle has no typed surface for a stored
 * function. Returns bigint over the wire (the pool sets types.bigint), so the
 * Number() below is doing real work, not defensive noise.
 */
export async function applyCredit(params: {
  companyId: string;
  delta: number;
  kind: LedgerKind;
  ref?: string | null;
  deploymentId?: string | null;
  note?: string | null;
}): Promise<number> {
  const [row] = await rawSql()`
    select public.credit_apply(
      ${params.companyId}::uuid,
      ${params.delta}::bigint,
      ${params.kind}::text,
      ${params.ref ?? null}::text,
      ${params.deploymentId ?? null}::uuid,
      ${params.note ?? null}::text
    ) as balance
  `;
  return Number(row?.balance ?? 0);
}

export async function grantSignupCredits(companyId: string): Promise<number> {
  return applyCredit({
    companyId,
    delta: SIGNUP_GRANT_CREDITS,
    kind: "grant",
    ref: companyId,
    note: "Welcome credits",
  });
}

/**
 * Credits spent per deployment, keyed by deployment id.
 *
 * The ledger has carried `deployment_id` since it was written, but nothing read
 * it, so the console could show a company balance and never what an individual
 * agent had cost. Debits only: a topup is not attributable to an agent, and
 * `delta` is negative for spend, so the sum is negated once here rather than at
 * every call site. Deleted agents keep their rows — the FK is `set null` on
 * delete and a deployment is only ever soft-deleted, so history survives.
 */
export type DeploymentSpend = {
  /** Credits billed against this agent, all kinds. */
  total: number;
  /** Runtime blocks — 6 credits an hour while the service is up. */
  runtime: number;
  /** Model usage, already marked up (cost x LLM_MARKUP). */
  model: number;
};

export async function spendByDeployment(
  companyId: string,
): Promise<Record<string, DeploymentSpend> | null> {
  try {
    // Split by kind, not just summed. The console shows this number next to the
    // Fleet card's model cost, which is the provider's raw USD and cannot
    // match a credit total that also contains runtime and a 1.2x markup. Naming
    // the two halves is what lets an operator reconcile them.
    const rows = await db()
      .select({
        deployment_id: credit_ledger.deployment_id,
        kind: credit_ledger.kind,
        spent: sql<string>`sum(-${credit_ledger.delta})`,
      })
      .from(credit_ledger)
      .where(
        and(
          eq(credit_ledger.company_id, companyId),
          isNotNull(credit_ledger.deployment_id),
          lt(credit_ledger.delta, 0),
        ),
      )
      .groupBy(credit_ledger.deployment_id, credit_ledger.kind);
    const out: Record<string, DeploymentSpend> = {};
    for (const r of rows) {
      if (!r.deployment_id) continue;
      const e = (out[r.deployment_id] ??= { total: 0, runtime: 0, model: 0 });
      const n = Number(r.spent);
      e.total += n;
      // 'adjustment' lands in the total and in neither half, which is right —
      // a manual correction is not runtime and not model usage.
      if (r.kind === "runtime") e.runtime += n;
      else if (r.kind === "llm") e.model += n;
    }
    return out;
  } catch {
    // Null, not {} — an agent with no debits yet and an unreadable ledger are
    // different facts, and {} collapsed them into the same "—". A fresh agent
    // has spent 0 and should say so.
    return null;
  }
}

export async function lastTopupCredits(companyId: string): Promise<number> {
  try {
    const [row] = await db()
      .select({ delta: credit_ledger.delta })
      .from(credit_ledger)
      .where(and(eq(credit_ledger.company_id, companyId), eq(credit_ledger.kind, "topup")))
      .orderBy(desc(credit_ledger.created_at))
      .limit(1);
    return Number(row?.delta ?? 0);
  } catch {
    return 0;
  }
}

export async function listLedger(
  companyId: string,
  limit = 20,
): Promise<LedgerEntry[]> {
  try {
    const rows = await db()
      .select({
        id: credit_ledger.id,
        delta: credit_ledger.delta,
        balance_after: credit_ledger.balance_after,
        kind: credit_ledger.kind,
        note: credit_ledger.note,
        created_at: credit_ledger.created_at,
      })
      .from(credit_ledger)
      .where(eq(credit_ledger.company_id, companyId))
      .orderBy(desc(credit_ledger.created_at))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      delta: Number(r.delta),
      balanceAfter: Number(r.balance_after),
      kind: r.kind as LedgerKind,
      note: r.note,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function createPaymentRow(params: {
  companyId: string;
  packId: string;
  credits: number;
  amountUsd: number;
  asset: SettlementAsset;
}): Promise<PaymentRow> {
  const [inserted] = await db()
    .insert(credit_payments)
    .values({
      company_id: params.companyId,
      pack_id: params.packId,
      credits: params.credits,
      amount_usd: params.amountUsd,
      settlement_asset: params.asset,
    })
    .returning();
  if (!inserted) throw new Error("could not create payment");
  return inserted as PaymentRow;
}

export async function updatePaymentRow(
  id: string,
  patch: { cpay_payment_id?: string; status?: string },
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db().update(credit_payments).set(patch).where(eq(credit_payments.id, id));
}

export async function getPaymentRow(id: string): Promise<PaymentRow | null> {
  const [row] = await db()
    .select()
    .from(credit_payments)
    .where(eq(credit_payments.id, id))
    .limit(1);
  return (row as PaymentRow) ?? null;
}

export async function getPaymentRowByCpayId(
  cpayPaymentId: string,
): Promise<PaymentRow | null> {
  const [row] = await db()
    .select()
    .from(credit_payments)
    .where(eq(credit_payments.cpay_payment_id, cpayPaymentId))
    .limit(1);
  return (row as PaymentRow) ?? null;
}

/**
 * Record a webhook delivery, returning false if this id was already seen.
 *
 * De-duplication is the primary key: a redelivery collides and must be ignored,
 * not processed twice. Expressed as `on conflict do nothing` and a test on
 * whether a row came back, rather than by catching the unique-violation code —
 * the previous version compared against SQLSTATE by hand, and a wrong constant
 * there fails open, double-crediting a payment.
 */
export async function recordEvent(
  id: string,
  type: string,
  cpayPaymentId: string,
): Promise<boolean> {
  const inserted = await db()
    .insert(cpay_events)
    .values({ id, type, cpay_payment_id: cpayPaymentId })
    .onConflictDoNothing({ target: cpay_events.id })
    .returning({ id: cpay_events.id });
  return inserted.length > 0;
}
