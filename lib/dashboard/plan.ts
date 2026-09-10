import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { companies, deployments } from "@/db/schema";

import { getBalance, lastTopupCredits } from "./credit-ledger";
import {
  balanceLevel,
  creditGate,
  runwayHours,
  type BalanceLevel,
} from "./credits";
import { type Plan } from "./plan-gate";

export type { Plan } from "./plan-gate";

const ACTIVE_STATUSES = [
  "pending",
  "provisioning",
  "running",
  "starting",
  "stopping",
  "stopped",
];

const LIVE_STATUSES = ["running", "starting"];

export type PlanSummary = {
  plan: Plan | null;
  agentCount: number;
  agentLimit: number | null;
  atLimit: boolean;
  canDeploy: boolean;
  needsCredits: boolean;
  balance: number;
  lastTopup: number;
  level: BalanceLevel;
  runwayHours: number | null;
};

export async function getCompanyPlan(companyId: string): Promise<Plan | null> {
  try {
    const [row] = await db()
      .select({ plan: companies.plan })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    return row?.plan === "enterprise" ? "enterprise" : null;
  } catch {
    return null;
  }
}

export async function setCompanyPlan(companyId: string, plan: Plan): Promise<void> {
  await db().update(companies).set({ plan }).where(eq(companies.id, companyId));
}

async function countAgents(companyId: string, statuses: string[]): Promise<number> {
  try {
    // count(*) in SQL, replacing PostgREST's head-request + Content-Range header.
    const [row] = await db()
      .select({ n: count() })
      .from(deployments)
      .where(and(eq(deployments.company_id, companyId), inArray(deployments.status, statuses)));
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function countActiveAgents(companyId: string): Promise<number> {
  return countAgents(companyId, ACTIVE_STATUSES);
}

export async function countLiveAgents(companyId: string): Promise<number> {
  return countAgents(companyId, LIVE_STATUSES);
}

export async function planSummary(companyId: string): Promise<PlanSummary> {
  const [plan, agentCount, liveCount, balance, lastTopup] = await Promise.all([
    getCompanyPlan(companyId),
    countActiveAgents(companyId),
    countLiveAgents(companyId),
    getBalance(companyId),
    lastTopupCredits(companyId),
  ]);
  const gate = creditGate(balance, plan === "enterprise", agentCount);
  return {
    plan,
    agentCount,
    agentLimit: gate.agentLimit,
    atLimit: gate.atLimit,
    canDeploy: gate.canDeploy,
    needsCredits: gate.needsCredits,
    balance,
    lastTopup,
    level: balanceLevel(balance, lastTopup),
    runwayHours: runwayHours(balance, liveCount),
  };
}

export function emptyPlanSummary(): PlanSummary {
  return {
    plan: null,
    agentCount: 0,
    agentLimit: 0,
    atLimit: false,
    canDeploy: false,
    needsCredits: true,
    balance: 0,
    lastTopup: 0,
    level: "empty",
    runwayHours: null,
  };
}
