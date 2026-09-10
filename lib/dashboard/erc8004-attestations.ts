import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { erc8004_attestations } from "@/db/schema";

// Attestation rows. `summary` is the exact string whose keccak256 went on-chain
// as request/response hash — it is written once and must never be rewritten, or
// the served URI stops matching the hash.

export type AttestationRow = {
  id: string;
  deployment_id: string;
  agent_id: number;
  chain_id: number;
  summary: string;
  request_hash: string;
  request_tx: string | null;
  response_tx: string | null;
  response_value: number | null;
  created_at: string;
};

export async function insertAttestation(row: {
  deployment_id: string;
  agent_id: number;
  chain_id: number;
  summary: string;
  request_hash: string;
}): Promise<AttestationRow> {
  const [inserted] = await db().insert(erc8004_attestations).values(row).returning();
  if (!inserted) throw new Error("attestation insert failed");
  return inserted;
}

export async function patchAttestation(
  id: string,
  patch: Partial<Pick<AttestationRow, "request_hash" | "request_tx" | "response_tx" | "response_value">>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db().update(erc8004_attestations).set(patch).where(eq(erc8004_attestations.id, id));
}

export async function getAttestation(id: string): Promise<AttestationRow | null> {
  const [row] = await db()
    .select()
    .from(erc8004_attestations)
    .where(eq(erc8004_attestations.id, id))
    .limit(1);
  return row ?? null;
}

/** Newest-first attestations for one deployment (console/marketplace display). */
export async function listAttestations(
  deploymentId: string,
  limit = 10,
): Promise<AttestationRow[]> {
  return db()
    .select()
    .from(erc8004_attestations)
    .where(eq(erc8004_attestations.deployment_id, deploymentId))
    .orderBy(desc(erc8004_attestations.created_at))
    .limit(limit);
}
