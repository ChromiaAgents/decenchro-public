import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { deployments } from "@/db/schema";

import { agentCategory } from "./agent-categories";
import type { DeploymentSpend } from "./credit-ledger";
import {
  PROVISION_STEPS,
  type Deployment,
  type DeploymentProvider,
  type DeployStep,
} from "./deploy-types";

// Registry data-access layer for the `deployments` table. Ownership (company_id)
// is enforced by the callers in the API routes — and since the move to Neon that
// is the ONLY thing enforcing it, because Postgres row-level security did not
// come along (the service-role client bypassed it for every query here anyway).
// Secret columns never leave this module; the public mapper below strips them.

export type DeploymentStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "starting" // power-on requested; settled to running by reconcile-on-read
  | "stopping" // power-off requested; settled to stopped by reconcile-on-read
  | "stopped"
  | "failed"
  | "deleted";

// The full row, including encrypted secrets. Internal use only.
export type DeploymentRow = {
  id: string;
  company_id: string;
  owner_id: string;
  agent_name: string;
  atbash_pubkey: string;
  model_id: string;
  provider: DeploymentProvider;
  server_type: string;
  atbash_privkey_enc: string;
  openrouter_key_enc: string;
  telegram_token_enc: string;
  telegram_allowed_users: string;
  soul_md: string;
  // Curated category chosen at deploy (lib/dashboard/agent-categories.ts). Added
  // in migration 0009; undefined on un-migrated databases, so read it through
  // agentCategory(), which falls back to the default.
  category_id: string;
  // Retired-provider columns. Nothing writes these since DigitalOcean and
  // Hetzner were dropped (2026-08-18); they stay so historical rows keep
  // resolving through serviceId() / metricsBase(), and are read-only from here on.
  hetzner_server_id: number | null;
  hetzner_server_ip: string | null;
  hetzner_ssh_key_id: number | null;
  // Provider-agnostic id + address, added in migration 0009 for Render (string
  // service ids, no public IP). Undefined on un-migrated databases, so always go
  // through serviceId()/metricsBase() below rather than reading them directly.
  provider_service_id: string | null;
  agent_endpoint: string | null;
  ssh_privkey_enc: string | null;
  // ERC-8004 identity on BNB Smart Chain, added in migration 0010. All written
  // post-insert (registration is best-effort at deploy, backfilled by the attest
  // cron) and undefined on un-migrated databases — treat undefined as null.
  erc8004_agent_id: number | null;
  erc8004_tx: string | null;
  bsc_address: string | null;
  erc8004_chain_id: number | null;
  erc8004_attested_at: string | null;
  status: DeploymentStatus;
  provision_phase: number;
  last_seen: string | null;
  fail_reason: string | null;
  // Monthly spend cap in USD; null = no budget. Added in migration 0005 —
  // absent on un-migrated databases, so treat undefined as null.
  monthly_budget_usd: number | null;
  // When a Pro agent should be auto-torn-down. Written at insert as a boot
  // backstop, then replaced with ready + PRO_TTL_MS once the agent reports in
  // (see proDeployExpiry / proReadyExpiry). null = never (enterprise). Added in
  // migration 0007; undefined on un-migrated databases.
  expires_at: string | null;
  // Metering watermark: how far runtime has already been billed to. Advanced by
  // the credits cron, never set at insert. null = never metered.
  metered_until: string | null;
  // When the agent last entered running state. NULL for rows predating
  // migration 0004, and for rows that never came up.
  started_at: string | null;
  // Cumulative model spend already charged, in USD. The cron bills the delta
  // against the agent's own report, so this must not be recomputed from scratch.
  llm_cost_billed: number;
  created_at: string;
  updated_at: string;
};

// What the dashboard sees about a managed agent — no secrets.
export type ManagedAgent = {
  id: string;
  agentName: string;
  pubkey: string;
  fingerprint: string;
  modelId: string;
  categoryId: string;
  provider: DeploymentProvider;
  serverType: string;
  serverIp: string | null;
  status: DeploymentStatus;
  provisionPhase: number;
  lastSeen: string | null;
  startedAt: string | null;
  failReason: string | null;
  monthlyBudgetUsd: number | null;
  // ERC-8004 identity (public on-chain data; null until registered).
  erc8004AgentId: number | null;
  bscAddress: string | null;
  /**
   * The chain the identity is (or will be) on. Falls back to the configured
   * chain when the row has none yet, so a mint that has been broadcast but not
   * confirmed can still be linked to an explorer — the agentId is what says
   * "registered", never this.
   */
  erc8004ChainId: number | null;
  /** register() hash. Set before the receipt is read, so it can be pending. */
  erc8004Tx: string | null;
  /**
   * Public URL of this agent's Hermes console, or null when it has none (a
   * retired-provider VM, or no endpoint recorded yet).
   *
   * Not a secret — it is the same host the metrics endpoint lives on, and the
   * console itself fails closed without its basic-auth login. Carrying it on the
   * roster is what lets the fleet card show an "open console" link without a
   * round trip; the PASSWORD still costs an explicit click (POST
   * /api/agents/dashboard) and never rides along on a poll.
   */
  dashboardUrl: string | null;
  createdAt: string;
  /**
   * Credits billed against this agent, joined in by /api/agents from the ledger
   * (which has always carried `deployment_id` and never been read by it). Null
   * rather than 0 when the ledger is unreachable, so a card shows "—" instead of
   * claiming an agent was free.
   */
  creditsSpent?: number | null;
  /**
   * The same figure split by what was billed. Joined alongside creditsSpent so
   * the card can say WHY its credit total does not match the usage strip's
   * model cost: that one is the provider's raw USD, this one is credits and
   * includes runtime plus a 1.2x markup.
   */
  creditsSpentSplit?: DeploymentSpend | null;
};

/**
 * Narrow a selected row to DeploymentRow.
 *
 * Drizzle types `status` and `provider` as plain text because they are text
 * columns; the union types are guaranteed by the CHECK constraints in
 * db/migrations/0001_init.sql rather than by the type system. One cast here
 * beats one at every call site.
 */
type SelectedRow = typeof deployments.$inferSelect;
const asRow = (r: SelectedRow) => r as DeploymentRow;

/**
 * The provider's id for this deployment's server or service. Prefers the
 * provider-agnostic column (migration 0009) and falls back to the original
 * numeric one, so rows written before that migration keep resolving.
 */
export function serviceId(
  r: Pick<DeploymentRow, "provider_service_id" | "hetzner_server_id">,
): string | null {
  if (r.provider_service_id) return r.provider_service_id;
  return r.hetzner_server_id != null ? String(r.hetzner_server_id) : null;
}

/**
 * Base URL of the agent's metrics endpoint. Render decides this at create time
 * (an HTTPS hostname); VM providers have only an IP, so the well-known port is
 * appended here rather than assembled at each call site.
 */
export function metricsBase(
  r: Pick<DeploymentRow, "agent_endpoint" | "hetzner_server_ip">,
  port = 9484,
): string | null {
  if (r.agent_endpoint) return r.agent_endpoint.replace(/\/$/, "");
  // Retired VM rows only: plaintext http to a raw IP. Kept so an old row still
  // reports metrics rather than reading as unreachable.
  return r.hetzner_server_ip ? `http://${r.hetzner_server_ip}:${port}` : null;
}

export function fingerprintOf(pubkey: string): string {
  if (!pubkey || pubkey.length <= 12) return pubkey || "—";
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}

export function toManagedAgent(r: DeploymentRow): ManagedAgent {
  return {
    id: r.id,
    agentName: r.agent_name,
    pubkey: r.atbash_pubkey,
    fingerprint: fingerprintOf(r.atbash_pubkey),
    modelId: r.model_id,
    // Un-migrated database (pre-0009) returns undefined; normalise so the
    // console never renders a blank category.
    categoryId: agentCategory(r.category_id).id,
    provider: r.provider,
    serverType: r.server_type,
    serverIp: r.hetzner_server_ip,
    status: r.status,
    provisionPhase: r.provision_phase,
    lastSeen: r.last_seen,
    startedAt: r.started_at ?? null,
    failReason: r.fail_reason,
    monthlyBudgetUsd: r.monthly_budget_usd ?? null,
    erc8004AgentId: r.erc8004_agent_id ?? null,
    bscAddress: r.bsc_address ?? null,
    erc8004ChainId:
      r.erc8004_chain_id ?? (Number(process.env.BSC_CHAIN_ID) || 97),
    erc8004Tx: r.erc8004_tx ?? null,
    // Inlined rather than imported from agent-dashboard.ts: that module imports
    // metricsBase from here, so calling dashboardUrl() would close an import
    // cycle for a one-line provider test.
    dashboardUrl: r.provider === "render" ? metricsBase(r) : null,
    createdAt: r.created_at,
  };
}

export async function insertDeployment(
  // monthly_budget_usd is set later via /api/agent-budget, and
  // provider_service_id / agent_endpoint are only known once the server exists.
  // All three are absent on un-migrated databases, so never send them at insert
  // time — let the (nullable) columns default to null.
  //
  // The hetzner_* columns are omitted for a different reason: they belong to the
  // retired VM providers and are read-only shims for historical rows now, so a
  // new deployment should not name them at all, not even to write null.
  row: Omit<
    DeploymentRow,
    | "id"
    | "created_at"
    | "updated_at"
    | "monthly_budget_usd"
    | "provider_service_id"
    | "agent_endpoint"
    | "hetzner_server_id"
    | "hetzner_server_ip"
    | "hetzner_ssh_key_id"
    // ERC-8004 columns are only known once registration lands.
    | "erc8004_agent_id"
    | "erc8004_tx"
    | "bsc_address"
    | "erc8004_chain_id"
    | "erc8004_attested_at"
    // Metering columns, advanced by the credits cron rather than set at insert.
    | "metered_until"
    | "llm_cost_billed"
    // Stamped when the agent reports ready, and again on a resume — never at
    // insert, which is the whole point of the column.
    | "started_at"
  >,
): Promise<DeploymentRow> {
  const [inserted] = await db().insert(deployments).values(row).returning();
  if (!inserted) throw new Error("insert failed");
  return asRow(inserted);
}

/** An existing non-deleted deployment for this company with the same on-chain
 * identity — used to refuse provisioning two VPSes that sign as one agent. */
export async function findActiveByPubkey(
  companyId: string,
  pubkey: string,
): Promise<DeploymentRow | null> {
  const [row] = await db()
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.company_id, companyId),
        eq(deployments.atbash_pubkey, pubkey),
        ne(deployments.status, "deleted"),
      ),
    )
    .limit(1);
  return row ? asRow(row) : null;
}

/** An existing non-deleted deployment for this company whose agent name matches
 * (case-insensitive) — used to keep agent/server names unique and readable. */
/**
 * This company's stored Telegram tokens, newest first — the input to reusing a
 * token across deploys. Deleted rows are included on purpose: replacing an
 * agent you just removed is the main reason to reuse, and the row that holds
 * the token is exactly the one that was deleted.
 *
 * Returns the ciphertext. Decryption belongs to ./telegram-token, so the
 * plaintext never enters a wider scope than the one comparison that needs it.
 */
export async function listCompanyTelegramTokens(
  companyId: string,
  limit = 25,
): Promise<
  { id: string; agent_name: string; status: string; telegram_token_enc: string }[]
> {
  return db()
    .select({
      id: deployments.id,
      agent_name: deployments.agent_name,
      status: deployments.status,
      telegram_token_enc: deployments.telegram_token_enc,
    })
    .from(deployments)
    .where(eq(deployments.company_id, companyId))
    .orderBy(desc(deployments.created_at))
    .limit(limit);
}

export async function findActiveByName(
  companyId: string,
  name: string,
): Promise<DeploymentRow | null> {
  // Matched in SQL rather than by pulling every row and comparing in JS, which
  // is what PostgREST forced (it has no case-insensitive equality operator).
  const target = name.trim().toLowerCase();
  const [row] = await db()
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.company_id, companyId),
        ne(deployments.status, "deleted"),
        eq(sql`lower(trim(${deployments.agent_name}))`, target),
      ),
    )
    .limit(1);
  return row ? asRow(row) : null;
}

export async function getDeploymentRow(id: string): Promise<DeploymentRow | null> {
  const [row] = await db().select().from(deployments).where(eq(deployments.id, id)).limit(1);
  return row ? asRow(row) : null;
}

export async function updateDeployment(
  id: string,
  patch: Partial<DeploymentRow>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db().update(deployments).set(patch).where(eq(deployments.id, id));
}

/** All non-deleted deployment rows owned by a company, newest first. */
export async function listDeploymentRows(
  companyId: string,
): Promise<DeploymentRow[]> {
  const rows = await db()
    .select()
    .from(deployments)
    .where(and(eq(deployments.company_id, companyId), ne(deployments.status, "deleted")))
    .orderBy(desc(deployments.created_at));
  return rows.map(asRow);
}

/**
 * Every running agent that has a spend budget, across all companies — the set
 * the budget-enforcement cron checks.
 */
export async function listBudgetedRunningDeployments(): Promise<DeploymentRow[]> {
  const rows = await db()
    .select()
    .from(deployments)
    .where(
      and(
        isNotNull(deployments.monthly_budget_usd),
        inArray(deployments.status, ["running", "starting"]),
      ),
    );
  return rows.map(asRow);
}

/**
 * Every running agent across all companies — the set /api/agents/enforce-budgets
 * and the credits metering cron walk.
 */
export async function listLiveDeployments(): Promise<DeploymentRow[]> {
  const rows = await db()
    .select()
    .from(deployments)
    .where(inArray(deployments.status, ["running", "starting"]));
  return rows.map(asRow);
}

/**
 * Every stopped-or-stopping agent across all companies — the set the credits
 * cron reclaims once it has been idle past IDLE_DESTROY_MS.
 */
export async function listIdleDeployments(): Promise<DeploymentRow[]> {
  const rows = await db()
    .select()
    .from(deployments)
    .where(inArray(deployments.status, ["stopped", "stopping"]));
  return rows.map(asRow);
}

/**
 * Running agents that never got an ERC-8004 identity (registration deferred at
 * deploy), across all companies — the attest cron's backfill set.
 */
export async function listUnregisteredRunning(limit = 5): Promise<DeploymentRow[]> {
  const rows = await db()
    .select()
    .from(deployments)
    .where(and(isNull(deployments.erc8004_agent_id), eq(deployments.status, "running")))
    .orderBy(asc(deployments.created_at))
    .limit(limit);
  return rows.map(asRow);
}

/**
 * Registered, running agents whose last on-chain attestation is older than
 * `staleMs` (or missing) — the attest cron's anchoring set.
 */
export async function listAttestableDeployments(
  limit = 10,
  staleMs = 24 * 60 * 60 * 1000,
): Promise<DeploymentRow[]> {
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const rows = await db()
    .select()
    .from(deployments)
    .where(
      and(
        isNotNull(deployments.erc8004_agent_id),
        eq(deployments.status, "running"),
        or(
          isNull(deployments.erc8004_attested_at),
          lt(deployments.erc8004_attested_at, cutoff),
        ),
      ),
    )
    // Never-attested agents first. Drizzle has no nullsFirst modifier on asc(),
    // so this is raw — and it matters: without it the agents that have never
    // been anchored sort last and a capped run never reaches them.
    .orderBy(sql`${deployments.erc8004_attested_at} asc nulls first`)
    .limit(limit);
  return rows.map(asRow);
}

/** All non-deleted agents owned by a company, newest first. */
export async function listManagedAgents(companyId: string): Promise<ManagedAgent[]> {
  return (await listDeploymentRows(companyId)).map(toManagedAgent);
}

// ─── Row → UI Deployment (the live progress surface) ─────────────────────────

const UI_STEPS = PROVISION_STEPS;

/**
 * Map a registry row to the Deployment shape the progress UI polls. Any state
 * past provisioning (running, or a later power state) surfaces as "succeeded";
 * `failed` as "failed"; everything mid-flight as "running". Steps are derived
 * from provision_phase so the UI animates as the cloud-init webhook reports
 * progress.
 */
export function rowToDeployment(r: DeploymentRow): Deployment {
  const failed = r.status === "failed";
  const inFlight = r.status === "pending" || r.status === "provisioning";
  const provisioned = !failed && !inFlight; // running / starting / stopping / stopped
  const phase = provisioned ? 7 : r.provision_phase;

  const steps: DeployStep[] = UI_STEPS.map((s, i) => {
    const next = UI_STEPS[i + 1];
    let state: DeployStep["state"];
    // Once the agent reported ready, every step is complete — the ladder below
    // would leave the last step (same phase, no successor) stuck on "active".
    if (provisioned) state = "done";
    else if (phase > s.phase || (next && phase >= next.phase)) state = "done";
    // A failure marks the step it died on, not every step from there down: the
    // ones after it were never attempted, so they read as pending.
    else if (phase >= s.phase) state = failed ? "failed" : "active";
    else state = "pending";
    return { id: s.id, label: s.label, state, detail: s.detail };
  });
  // Host detail on the provision step once we have an IP.
  if (r.hetzner_server_ip) {
    const p = steps.find((s) => s.id === "provision");
    if (p) p.detail = `${r.server_type} · ${r.hetzner_server_ip}`;
  }
  if (failed && r.fail_reason) {
    const f = steps.find((s) => s.state === "failed");
    if (f) f.detail = r.fail_reason;
  }

  return {
    id: r.id,
    provider: r.provider,
    status: provisioned ? "succeeded" : failed ? "failed" : "running",
    steps,
    createdAt: r.created_at,
  };
}
