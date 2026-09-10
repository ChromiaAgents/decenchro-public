import { NextResponse } from "next/server";

import { fetchAgentToolCalls } from "@/lib/dashboard/atbash";
import {
  attestAgent,
  bscConfigured,
  registerAgentOnChain,
} from "@/lib/dashboard/bsc";
import {
  listAttestableDeployments,
  listUnregisteredRunning,
  updateDeployment,
  type DeploymentRow} from "@/lib/dashboard/deployments";
import {
  insertAttestation,
  patchAttestation,
} from "@/lib/dashboard/erc8004-attestations";
import { keccak256, toBytes } from "viem";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/agents/attest — background sweep (Vercel cron, daily) that
// (1) backfills ERC-8004 registrations deferred at deploy time, and
// (2) anchors each registered agent's Atbash/Chromia audit summary on the
//     ValidationRegistry (validationRequest + validationResponse), at most once
//     per 24h per agent.
//
// Auth mirrors /api/agents/expire: Bearer CRON_SECRET when set, else only
// Vercel's own cron header. Manual demo trigger:
//   curl -H "Authorization: Bearer $CRON_SECRET" <base>/api/agents/attest

function classifyVerdict(
  v: { green: number; yellow: number; red: number },
  verdict: string,
) {
  const s = verdict.toUpperCase();
  if (s === "BLOCK" || s === "RED") v.red++;
  else if (s === "HOLD" || s === "YELLOW") v.yellow++;
  else v.green++; // ALLOW / GREEN / Audit-tier "no verdict"
}

async function attestOne(row: DeploymentRow): Promise<"attested" | "skipped"> {
  const { ok, records } = await fetchAgentToolCalls(row.atbash_pubkey, 200);
  if (!ok || records.length === 0) return "skipped";

  const verdicts = { green: 0, yellow: 0, red: 0 };
  for (const r of records) classifyVerdict(verdicts, r.verdict);
  const total = verdicts.green + verdicts.yellow + verdicts.red;
  const score = Math.round((100 * (verdicts.green + 0.5 * verdicts.yellow)) / total);

  const times = records
    .map((r) => r.createdAt)
    .filter((t): t is string => Boolean(t))
    .sort();
  // The exact bytes served at the on-chain URIs. `window.to` (ms precision) plus
  // the sampled tc- ids make the keccak unique per run — the registry rejects a
  // duplicate requestHash.
  const summary = JSON.stringify({
    type: "decenchro-attestation-v1",
    deploymentId: row.id,
    agentId: row.erc8004_agent_id,
    chainId: row.erc8004_chain_id,
    atbashPubkey: row.atbash_pubkey,
    window: { from: times[0] ?? null, to: new Date().toISOString() },
    toolCalls: total,
    verdicts,
    sampleToolCallIds: records
      .map((r) => r.toolCallId)
      .filter(Boolean)
      .slice(0, 10),
    score,
  });

  const attestation = await insertAttestation({
    deployment_id: row.id,
    agent_id: row.erc8004_agent_id!,
    chain_id: row.erc8004_chain_id ?? 0,
    summary,
    request_hash: keccak256(toBytes(summary)),
  });
  const result = await attestAgent(
    row.id,
    row.erc8004_agent_id!,
    summary,
    attestation.id,
    score,
  );
  await patchAttestation(attestation.id, {
    request_tx: result.requestTx,
    response_tx: result.responseTx,
    response_value: score,
  });
  await updateDeployment(row.id, {
    erc8004_attested_at: new Date().toISOString(),
  });
  return "attested";
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret
    ? req.headers.get("authorization") === `Bearer ${secret}`
    : req.headers.get("x-vercel-cron") != null;
  if (!authed)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!bscConfigured())
    return NextResponse.json({ ok: true, skipped: "bsc not configured" });

  const errors: string[] = [];

  // 1. Registration backfill — the retry lane for deploys whose best-effort
  // registration was deferred.
  let registered = 0;
  for (const row of await listUnregisteredRunning(5)) {
    try {
      // pendingTx: a hash the deploy path broadcast but never confirmed. Adopt
      // it rather than minting a second identity for the same agent.
      const reg = await registerAgentOnChain(row.id, {
        pendingTx: row.erc8004_tx,
      });
      await updateDeployment(row.id, {
        erc8004_agent_id: reg.agentId,
        erc8004_tx: reg.txHash,
        bsc_address: reg.address,
        erc8004_chain_id: reg.chainId,
      });
      registered++;
    } catch (err) {
      errors.push(
        `register ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Audit-trail anchoring.
  let attested = 0;
  let skipped = 0;
  for (const row of await listAttestableDeployments(10)) {
    try {
      if ((await attestOne(row)) === "attested") attested++;
      else skipped++;
    } catch (err) {
      errors.push(
        `attest ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return NextResponse.json({ ok: true, registered, attested, skipped, errors });
}
