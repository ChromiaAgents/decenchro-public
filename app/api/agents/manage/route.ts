import { NextResponse } from "next/server";

import { getOwner, isRequestAdmin } from "@/lib/dashboard/auth";
import {
  getDeploymentRow,
  serviceId,
  updateDeployment,
  type DeploymentStatus,
} from "@/lib/dashboard/deployments";
import { teardownDeployment } from "@/lib/dashboard/deploy";
import {
  isManagedProvider,
  RETIRED_PROVIDER_REASON,
} from "@/lib/dashboard/deploy-types";
import { bscConfigured, registerAgentOnChain } from "@/lib/dashboard/bsc";
import { hostClient } from "@/lib/dashboard/host";
import { planSummary } from "@/lib/dashboard/plan";

export const dynamic = "force-dynamic";
// register() is three sequential BSC transactions with receipt waits. The
// default would time out mid-chain, which is the failure this action exists to
// recover from.
export const maxDuration = 120;

// There is no user-facing stop (user decision 2026-08-18): an agent is either
// running or removed, and remove destroys the service outright. A stopped
// service keeps its disk, and a disk bills whether or not the service runs, so a
// stopped agent is pure cost with no revenue against it. `start` survives only
// as the resume for an agent the platform paused at a zero balance, which is the
// one stopped state left in the system.
//
// `register` is not a power action: it mints the agent's ERC-8004 identity. It
// lives here rather than in its own route because the gating is identical (admin
// + ownership + the row) and because the console already has the plumbing for a
// manage action that returns its error to the card. It exists at all because the
// automatic retry lane cannot reach every environment: Vercel runs cron jobs on
// PRODUCTION deployments only, so a staging agent whose deploy-time registration
// was deferred would sit unregistered forever with no way to say why.
type Action = "start" | "restart" | "delete" | "register";
const ACTIONS: Action[] = ["start", "restart", "delete", "register"];

// Record the transient state (starting/stopping) so a page refresh mid-action
// still shows the transition; reconcile-on-read settles it once Render
// reports the target power state. Until migration 0003 is applied the DB
// check-constraint rejects transient states — fall back to the settled state
// so lifecycle control keeps working on an un-migrated database.
async function setStatus(
  id: string,
  wanted: DeploymentStatus,
  fallback: DeploymentStatus,
) {
  try {
    await updateDeployment(id, { status: wanted });
  } catch {
    await updateDeployment(id, { status: fallback });
  }
}

// POST /api/agents/manage — lifecycle control for a managed cloud agent via the
// deployment's host provider API (Render). Admin + ownership
// gated. No SSH: stop/start/restart/delete map to power actions on the server.
export async function POST(req: Request) {
  if (!(await isRequestAdmin()))
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  const owner = await getOwner();
  if (!owner)
    return NextResponse.json({ error: "no company profile" }, { status: 403 });

  let body: { deploymentId?: string; action?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { deploymentId } = body;
  const action = body.action as Action | undefined;
  if (!deploymentId || !action || !ACTIONS.includes(action))
    return NextResponse.json(
      { error: "deploymentId and a valid action are required" },
      { status: 400 },
    );

  const row = await getDeploymentRow(deploymentId);
  if (!row || row.company_id !== owner.companyId)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  const id = serviceId(row);
  if (action !== "delete" && action !== "register" && !id)
    return NextResponse.json({ error: "no server provisioned" }, { status: 400 });

  // On-chain identity. Before delete, because it needs no provider and no
  // credit gate: gas comes from the platform wallet, not the tenant's balance.
  // The error is RETURNED rather than logged, which is the whole point — the
  // deploy-time attempt could only write its reason to a server log.
  if (action === "register") {
    if (row.erc8004_agent_id != null)
      return NextResponse.json({ error: "already registered" }, { status: 409 });
    if (!bscConfigured())
      return NextResponse.json(
        { error: "on-chain registration is not configured (PLATFORM_BSC_PRIVKEY)" },
        { status: 409 },
      );
    try {
      // pendingTx adopts a mint an earlier attempt broadcast but never
      // confirmed, so a retry cannot leave a second identity behind.
      const reg = await registerAgentOnChain(row.id, {
        pendingTx: row.erc8004_tx,
        onTxHash: (hash) => updateDeployment(row.id, { erc8004_tx: hash }),
      });
      await updateDeployment(row.id, {
        erc8004_agent_id: reg.agentId,
        erc8004_tx: reg.txHash,
        bsc_address: reg.address,
        erc8004_chain_id: reg.chainId,
      });
      console.log(
        `[AUDIT] manage action=register deployment=${deploymentId} agentId=${reg.agentId} owner=${owner.email ?? owner.userId}`,
      );
      return NextResponse.json({ ok: true, action, agentId: reg.agentId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "registration failed";
      console.log(
        `[AUDIT] manage action=register FAILED deployment=${deploymentId} reason=${msg}`,
      );
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Delete is handled first because it is the one action a retired-provider row
  // can still take: teardownDeployment skips the cloud call for those and settles
  // the registry either way, so this route and the expiry/cron path cannot drift.
  // It is also the one action that stays available at a zero balance, so the
  // credit gate below must not sit in front of it.
  //
  // Everything after this point is a power action, so the provider is narrowed by
  // the guard below rather than asserted with a cast — a cast is exactly how a
  // retired row would quietly reach a provider module that no longer exists.
  if (action === "delete") {
    try {
      await teardownDeployment(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "action failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    console.log(
      `[AUDIT] manage action=delete deployment=${deploymentId} owner=${owner.email ?? owner.userId}`,
    );
    return NextResponse.json({ ok: true, action });
  }

  // Bringing an agent back up spends credits, so it is gated; stop is not.
  if (action === "start" || action === "restart") {
    const summary = await planSummary(owner.companyId);
    if (summary.needsCredits)
      return NextResponse.json({ error: "credits_required" }, { status: 402 });
  }

  const provider = row.provider;
  if (!isManagedProvider(provider))
    return NextResponse.json({ error: RETIRED_PROVIDER_REASON }, { status: 409 });
  const host = hostClient(provider);

  try {
    switch (action) {
      case "start":
        await host.powerAction(id!, "poweron");
        await setStatus(deploymentId, "starting", "running");
        // Opening the cursor at now is only safe because stop settles: the
        // previous session is already closed, so this discards no unbilled tail,
        // and the time the agent spent off is correctly not charged.
        await updateDeployment(deploymentId, {
          fail_reason: null,
          metered_until: new Date().toISOString(),
          // A resume is a new session: the agent was off, and the time it spent
          // off is neither billed nor uptime.
          started_at: new Date().toISOString(),
        }).catch(() => {});
        break;
      case "restart":
        // Like EC2 reboot: the instance stays "running" through the cycle.
        await host.powerAction(id!, "reboot");
        await updateDeployment(deploymentId, { status: "running" });
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "action failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Audit trail for fleet control actions.
  console.log(
    `[AUDIT] manage action=${action} deployment=${deploymentId} owner=${owner.email ?? owner.userId}`,
  );
  return NextResponse.json({ ok: true, action });
}
