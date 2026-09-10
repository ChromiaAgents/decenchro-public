import "server-only";

import { createAgentIdentity, deriveAgent } from "./agents";
import { appBaseUrl } from "./app-url";
import {
  DEFAULT_AGENT_CATEGORY,
  type AgentCategoryId,
} from "./agent-categories";
import {
  DASHBOARD_USERNAME,
  dashboardPassword,
  dashboardSessionSecret,
} from "./agent-dashboard";
import { agentImage } from "./agent-image";
import { bscAgentKey, bscChainId, bscConfigured, bscRpcUrl, registerAgentOnChain } from "./bsc";
import { categorySoulMd } from "./category-soul";
import { deployWebhookToken } from "./deploy-token";
import { METRICS_PORT, metricsToken } from "./agent-metrics";
import { encrypt, encryptionConfigured } from "./crypto";
import {
  findActiveByName,
  findActiveByPubkey,
  getDeploymentRow,
  insertDeployment,
  listDeploymentRows,
  rowToDeployment,
  serviceId,
  toManagedAgent,
  updateDeployment,
  type DeploymentRow,
  type ManagedAgent} from "./deployments";
import {
  isManagedProvider,
  RETIRED_PROVIDER_REASON,
  type CloudProvider,
  type Deployment,
} from "./deploy-types";
import { isExpired } from "./plan-gate";
import {
  meterCompanyThrottled,
  pauseForCredits,
  settleDeploymentSafe,
} from "./metering";
import { spendByDeployment } from "./credit-ledger";
import { CREDITS_EXHAUSTED_REASON } from "./credits";
import { getSavedValues } from "./env-rw";
import { telegramReuse, telegramTokenHolder } from "./telegram-token";
import { hostClient } from "./host";
import { dbConfigured } from "@/lib/db/client";
import type { Owner } from "./auth";

export type { Deployment } from "./deploy-types";

// Real cloud-deploy orchestrator. Mints an Atbash identity, persists the agent to
// the registry (secrets encrypted), then creates a Render service running the
// prebuilt agent image, which reports progress back through /api/deploy/webhook.
//
// One provisioning shape since the VM providers were retired: an image-backed
// service whose per-deployment config arrives as service environment variables.
// Rows created on DigitalOcean or Hetzner still read, but nothing here can drive
// them — see isManagedProvider().

export type ProvisionInput = {
  agentName: string;
  provider: CloudProvider; // host the deploy route resolves (server-authoritative)
  atbashKey: string; // operator-supplied Atbash private key (from the console)
  telegramBotToken: string;
  telegramAllowedUsers?: string;
  soulMd?: string;
  // Curated category picked in the wizard. Supplies the agent's SOUL.md unless
  // soulMd overrides it. Validated against the catalog by the deploy route.
  category?: AgentCategoryId;
  // When this agent should be auto-torn-down (Pro's run limit). null = never
  // (enterprise). The deploy route computes it from the company's plan.
  expiresAt?: string | null;
};

// Platform-provided LLM access. The operator no longer supplies an OpenRouter
// key or picks a model at deploy time (those fields were removed from the form);
// every agent runs on the platform's shared key and default model. Set
// PLATFORM_OPENROUTER_API_KEY server-side; PLATFORM_MODEL_ID is optional.
const DEFAULT_MODEL_ID = "openai/gpt-5.4-mini";

function platformOpenrouterKey(): string {
  return (
    process.env.PLATFORM_OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    ""
  ).trim();
}

function platformModelId(): string {
  return (process.env.PLATFORM_MODEL_ID || DEFAULT_MODEL_ID).trim();
}

function slug(s: string, max: number): string {
  return (
    (s || "agent")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "agent"
  );
}

/** Read a deployment for the live progress UI (no secrets). */
export async function getDeployment(id: string): Promise<Deployment | null> {
  const row = await getDeploymentRow(id);
  return row ? rowToDeployment(row) : null;
}

// ─── Reconcile-on-read ────────────────────────────────────────────────────────

// Provisioning that reports no webhook progress for this long is declared dead.
// Measured on Render `standard` 2026-08-27, service create to `live`: 109s on the
// old 985 MB image, 75s on the slimmed 271 MB one (docker/agent/slim.sh). The
// ceiling stays far above either figure on purpose, because Render caches no
// images and re-pulls the whole thing on every create, so a slow registry day is
// minutes of legitimate silence and must not be mistaken for a failure.
const PROVISION_TIMEOUT_MS = 25 * 60 * 1000;

export const BOOT_BACKSTOP_MS = 30 * 60 * 1000;
const BOOT_TIMEOUT_REASON = "provisioning timed out, server removed";

// How stale a settled row (running/stopped) may be before we re-check the
// server against the provider. Bounds provider API calls so a fast dashboard
// poll doesn't hit the Render API once per agent per few seconds.
const SETTLED_SYNC_INTERVAL_MS = 20 * 1000;

// A provider API error that means the server is definitively gone (404), as
// opposed to a transient network/5xx failure we should retry.
function serverGone(err: unknown): boolean {
  return /not.?found/i.test(err instanceof Error ? err.message : "");
}

/**
 * Tear a deployment's service down and mark the row deleted. Reused by the
 * Fleet's manual delete, reconcile-on-read expiry, and the expire cron. The
 * delete is best-effort (already-gone is fine). `reason` is recorded so the
 * operator sees why it went away.
 *
 * A retired-provider row is marked deleted WITHOUT any provider call, because
 * there is no client left to make one. That only settles our registry: the VM
 * itself has to be destroyed in DigitalOcean's or Hetzner's console, so the row
 * records that rather than implying the machine is gone.
 */
export async function teardownDeployment(
  row: DeploymentRow,
  reason?: string,
): Promise<void> {
  // Deleting a live agent ends its session, same as stopping one. Without this
  // the tail since the last tick is destroyed along with the service. No-ops for
  // rows that were never live, which is most of what reaches teardown.
  await settleDeploymentSafe(row);

  if (!isManagedProvider(row.provider)) {
    await updateDeployment(row.id, {
      status: "deleted",
      fail_reason: reason ?? RETIRED_PROVIDER_REASON,
    });
    return;
  }
  const id = serviceId(row);
  if (id) {
    try {
      await hostClient(row.provider).deleteServer(id);
    } catch (e) {
      if (!serverGone(e)) throw e;
    }
  }
  await updateDeployment(row.id, {
    status: "deleted",
    ...(reason ? { fail_reason: reason } : {}),
  });
}

/**
 * Settle one row against reality (the EC2 DescribeInstances model — never trust
 * the last write). Transient states (starting/stopping) settle via the actual
 * server state; provisioning is webhook-driven and only checked for timeout;
 * settled states (running/stopped) are re-checked on a throttle so out-of-band
 * changes in the provider console — server deleted, powered off/on — sync back.
 * A server deleted outside the app becomes `deleted` and drops off the fleet.
 * Best-effort: a provider hiccup leaves the row as-is for the next read.
 */
async function reconcileRow(row: DeploymentRow): Promise<DeploymentRow> {
  const patch: Partial<DeploymentRow> = {};

  // Retired provider (DigitalOcean/Hetzner): there is no client to ask, so the
  // row is reported exactly as stored. Without this the fleet read would throw
  // for every historical row and take the whole roster down with it.
  if (!isManagedProvider(row.provider)) return row;

  // expires_at now carries one of two deadlines, and which one it is depends on
  // the status: a boot backstop while the row is still coming up, otherwise the
  // projected credit-exhaustion time. Settle both on read so the fleet
  // self-heals with no cron.
  if (row.status !== "deleted" && isExpired(row.expires_at, Date.now())) {
    if (
      row.status === "pending" ||
      row.status === "provisioning" ||
      row.status === "failed"
    ) {
      // Boot backstop: the server may well be up and only the callback lost, so
      // tear it down rather than leave an orphan billing and holding its keys.
      const reason = row.fail_reason ?? BOOT_TIMEOUT_REASON;
      try {
        await teardownDeployment(row, reason);
        return { ...row, status: "deleted", fail_reason: reason };
      } catch {
        // Provider hiccup — leave the row; the next read (or the cron) retries.
        return row;
      }
    }
    // Out of credits: power off and keep the data. The idle server is destroyed
    // later by the teardown engine, not here.
    if (await pauseForCredits(row)) {
      return {
        ...row,
        status: "stopping",
        fail_reason: CREDITS_EXHAUSTED_REASON,
        expires_at: null,
      };
    }
  }

  if (row.status === "pending" || row.status === "provisioning") {
    const idleMs = Date.now() - new Date(row.updated_at).getTime();
    if (idleMs > PROVISION_TIMEOUT_MS) {
      patch.status = "failed";
      patch.fail_reason = "provisioning timed out (no progress for 25 minutes)";
    }
  } else if (
    (row.status === "starting" || row.status === "stopping") &&
    serviceId(row)
  ) {
    try {
      const server = await hostClient(row.provider).getServer(serviceId(row)!);
      if (row.status === "starting" && server.status === "running")
        patch.status = "running";
      if (row.status === "stopping" && server.status === "off")
        patch.status = "stopped";
    } catch (err) {
      // Server deleted out-of-band — the transition can never complete.
      if (serverGone(err)) patch.status = "deleted";
      // Anything else (timeout, 5xx): leave the row for the next read.
    }
  } else if (
    (row.status === "running" || row.status === "stopped") &&
    serviceId(row)
  ) {
    const lastCheck = new Date(row.last_seen ?? row.updated_at).getTime();
    if (Date.now() - lastCheck > SETTLED_SYNC_INTERVAL_MS) {
      try {
        const server = await hostClient(row.provider).getServer(serviceId(row)!);
        if (row.status === "running" && server.status === "off")
          patch.status = "stopped";
        else if (row.status === "stopped" && server.status === "running")
          patch.status = "running";
        // Backfill the metrics base URL for rows written before migration 0009.
        if (!row.agent_endpoint && server.endpoint)
          patch.agent_endpoint = server.endpoint;
        // Confirmed alive — stamp the check so the throttle holds.
        patch.last_seen = new Date().toISOString();
      } catch (err) {
        // Deleted in the provider console → drop it from the fleet.
        if (serverGone(err)) patch.status = "deleted";
        // Transient errors: leave as-is, retry next poll.
      }
    }
  }

  if (!Object.keys(patch).length) return row;
  try {
    await updateDeployment(row.id, patch);
  } catch {
    // e.g. status constraint not yet migrated — serve the stale row.
    return row;
  }
  return { ...row, ...patch };
}

/**
 * The company's managed agents with transient states settled against reality.
 * This is what /api/agents serves, so every dashboard poll self-heals the
 * registry — no background workers needed on Vercel.
 */
export async function listReconciledAgents(
  companyId: string,
): Promise<ManagedAgent[]> {
  // One read, not two. This used to list the rows, meter them, then list them
  // again to pick up whatever metering wrote. The second read only earns its
  // place when metering actually ran, and metering is now throttled, so on most
  // polls it does not.
  let rows = await listDeploymentRows(companyId);
  if (await meterCompanyThrottled(companyId, rows))
    rows = await listDeploymentRows(companyId);
  const settled = await Promise.all(rows.map(reconcileRow));
  return settled.map(toManagedAgent);
}

/**
 * The roster with per-agent spend joined in — what every console surface that
 * shows a "Spent" column wants.
 *
 * Exists because /api/agents joined the ledger and the server-rendered Fleet
 * page did not, so the first frame showed "—" for every agent and the number
 * only appeared once the client poll came back. Same read for both now.
 *
 * Not folded into listReconciledAgents: the crons call that one and have no use
 * for the aggregate.
 */
export async function listAgentsWithSpend(
  companyId: string,
): Promise<ManagedAgent[]> {
  const [agents, spend] = await Promise.all([
    listReconciledAgents(companyId),
    spendByDeployment(companyId),
  ]);
  // 0, not null, for an agent with no debits — null means the ledger did not
  // answer, and the card renders that as "—".
  return agents.map((a) => ({
    ...a,
    creditsSpent: spend === null ? null : (spend[a.id]?.total ?? 0),
    creditsSpentSplit:
      spend === null ? null : (spend[a.id] ?? { total: 0, runtime: 0, model: 0 }),
  }));
}

/**
 * Provision a new cloud agent for `owner` using an Atbash key the operator
 * supplies. The key is validated via the SDK (pubkey derivation) and checked
 * for a duplicate active deployment before any VPS is created.
 */
export async function provisionAgent(
  input: ProvisionInput,
  owner: Owner,
): Promise<{ deployment: Deployment }> {
  // Which host to provision on (resolved server-side by the deploy route) → the
  // matching API client.
  const provider: CloudProvider = "render";
  const host = hostClient(provider);

  // Report every missing server-side var at once — and note when a value is
  // present but invalid (ENCRYPTION_KEY too short) rather than just "not set".
  const missing: string[] = [];
  if (!encryptionConfigured())
    missing.push(
      process.env.ENCRYPTION_KEY
        ? "ENCRYPTION_KEY (must be ≥32 chars)"
        : "ENCRYPTION_KEY",
    );
  if (!host.configured()) missing.push(host.tokenEnv);
  // One connection string now, injected by the Vercel Neon store, instead of
  // the public URL plus a separate service-role key.
  if (!dbConfigured()) missing.push("DATABASE_URL");
  if (!process.env.DEPLOY_WEBHOOK_SECRET) missing.push("DEPLOY_WEBHOOK_SECRET");
  // The container calls this URL back with its progress phases. A loopback base
  // URL (local `npm run dev`, no APP_BASE_URL) is unreachable from Render, so
  // every phase is lost, the row sits at 0 and fails 25 minutes later — with a
  // perfectly healthy, billing service behind it. Fail before creating it.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(appBaseUrl()))
    missing.push(`APP_BASE_URL (is ${appBaseUrl()}, which the agent cannot call back)`);
  // The platform now supplies the LLM (the operator no longer enters a key or
  // picks a model), so a platform OpenRouter key is a hard requirement.
  const openrouterKey = platformOpenrouterKey();
  if (!openrouterKey) missing.push("PLATFORM_OPENROUTER_API_KEY");
  if (missing.length)
    throw new Error(
      `Server not configured for cloud deploy — set: ${missing.join(", ")}`,
    );

  // The operator supplies only the Atbash key and the Telegram token now (model
  // + OpenRouter are platform-provided). Fill either from what's already saved
  // on this host (~/.hermes/.env) so the self-hosted flow can reuse keys entered
  // earlier; on the hosted console there's no saved env, so blanks error below.
  const saved = await getSavedValues([
    "ATBASH_AGENT_KEY",
    "TELEGRAM_BOT_TOKEN",
  ]);
  // Atbash registration isn't live yet, so the console no longer asks for a
  // key. Mint the identity here when none is supplied; a self-hosted operator
  // can still pass their own and it is used unchanged.
  let atbashKey = input.atbashKey.trim() || saved.ATBASH_AGENT_KEY || "";
  if (!atbashKey) atbashKey = (await createAgentIdentity()).privKey;
  // Third fallback: a token this company already used. getSavedValues only ever
  // finds anything self-hosted, so without this the hosted console — every real
  // tenant — had to re-type the token on every single deploy.
  let telegramBotToken =
    input.telegramBotToken.trim() || saved.TELEGRAM_BOT_TOKEN || "";
  if (!telegramBotToken) {
    const reuse = await telegramReuse(owner.companyId);
    if (reuse.token && reuse.heldBy) {
      throw new Error(
        `your saved Telegram bot is already driving "${reuse.heldBy}" — one bot can only run one agent, so create a second bot with @BotFather and paste its token`,
      );
    }
    if (reuse.token) telegramBotToken = reuse.token;
  } else {
    // An explicitly pasted token gets the same check: two agents sharing a bot
    // both call getUpdates, and Telegram hands each update to whichever polled
    // last, so the pair silently swallows half of each other's messages.
    const heldBy = await telegramTokenHolder(owner.companyId, telegramBotToken);
    if (heldBy)
      throw new Error(
        `that Telegram bot is already driving "${heldBy}" — one bot can only run one agent, so create a second bot with @BotFather`,
      );
  }
  const modelId = platformModelId();
  const resolvedMissing = [!telegramBotToken && "Telegram bot token"].filter(
    Boolean,
  );
  if (resolvedMissing.length)
    throw new Error(`missing required keys: ${resolvedMissing.join(", ")}`);

  // A required, unique name keeps the fleet (and the server names) readable at
  // scale — otherwise 100 agents all read "agent" and only their hash differs.
  const agentName = (input.agentName || "").trim();
  if (!agentName) throw new Error("agent name is required");
  const nameClash = await findActiveByName(owner.companyId, agentName);
  if (nameClash)
    throw new Error(`an agent named "${agentName}" already exists — pick a different name`);

  // Validate the supplied key through the SDK and derive its on-chain pubkey
  // (the fleet/registry join key).
  const derived = await deriveAgent(atbashKey);
  if (!derived.valid || !derived.pubKey)
    throw new Error("invalid Atbash key");
  const pubKey = derived.pubKey;

  // One identity → one running VPS. Refuse a second deploy of the same key.
  const existing = await findActiveByPubkey(owner.companyId, pubKey);
  if (existing)
    throw new Error("an agent with this Atbash key is already deployed");

  // Single tier per provider; the server-type env override is ops-only, not
  // exposed in the UI (cpx11 for Hetzner, s-1vcpu-2gb for DigitalOcean).
  const serverType = host.defaultServerType;

  // Fixed at deploy: written to the row once and never updated, so the category
  // can't drift from the SOUL.md this box actually booted with.
  const category: AgentCategoryId = input.category ?? DEFAULT_AGENT_CATEGORY;

  // Persist first so a row exists even if provisioning fails (re-provisionable).
  const row = await insertDeployment({
    company_id: owner.companyId,
    owner_id: owner.userId,
    agent_name: agentName,
    atbash_pubkey: pubKey,
    model_id: modelId,
    provider,
    server_type: serverType,
    atbash_privkey_enc: encrypt(atbashKey),
    openrouter_key_enc: encrypt(openrouterKey),
    telegram_token_enc: encrypt(telegramBotToken),
    telegram_allowed_users: input.telegramAllowedUsers ?? "",
    soul_md: input.soulMd ?? "",
    category_id: category,
    ssh_privkey_enc: null,
    status: "provisioning",
    provision_phase: 0,
    last_seen: null,
    fail_reason: null,
    // Pro's teardown clock (null = enterprise, never expires).
    expires_at: input.expiresAt ?? null,
  });

  try {
    // One config set, two delivery mechanisms. The agent image reads exactly
    // these names (docker/agent/cont-init.d/00-decenchro-config), so a VM gets
    // them via cloud-init's env-file and Render gets them as service env vars.
    const config = {
      AGENT_IMAGE: agentImage(),
      ATBASH_AGENT_KEY: atbashKey,
      OPENROUTER_API_KEY: openrouterKey,
      TELEGRAM_BOT_TOKEN: telegramBotToken,
      TELEGRAM_ALLOWED_USERS: input.telegramAllowedUsers ?? "",
      AGENT_NAME: agentName,
      // Falling through to Hermes' own default would have the agent introduce
      // itself as "Hermes Agent by Nous Research". The category decides which
      // persona it gets; an explicit soulMd still wins over the catalog.
      SOUL_MD: (input.soulMd ?? "").trim() || categorySoulMd(category, agentName),
      MODEL_ID: modelId,
      DEPLOY_WEBHOOK_URL: `${appBaseUrl()}/api/deploy/webhook`,
      // Per-deployment, NOT the raw DEPLOY_WEBHOOK_SECRET: the tenant controls
      // this box and can read its own config, so the token it gets must only
      // authorise its own deployment.
      DEPLOY_WEBHOOK_SECRET: deployWebhookToken(row.id),
      DEPLOYMENT_ID: row.id,
      // Derived from ENCRYPTION_KEY + id; the console recomputes it to read the
      // agent's metrics endpoint, so it's never stored separately.
      METRICS_TOKEN: metricsToken(row.id),
      // The agent's own BSC wallet (per-deployment derived, like METRICS_TOKEN)
      // plus chain selection for the bsc-defi CLI. Testnet by default; the
      // mainnet flip is BSC_CHAIN_ID=56 server-side, never a code change.
      BSC_AGENT_KEY: bscAgentKey(row.id),
      BSC_CHAIN_ID: String(bscChainId()),
      BSC_RPC_URL: bscRpcUrl(),
      // WhatsApp is pairing-gated by Hermes: an unknown sender gets a code and
      // "ask the bot owner to run `hermes pairing approve …`", which no tenant
      // can do on Render (no shell). The console's Fleet card can approve
      // (/api/agents/pairing), and this flag is the operator's alternative:
      // every WhatsApp sender is authorised. It is check #1 in the gateway's
      // authz (gateway/authz_mixin.py platform_allow_all_map), so it opens
      // WhatsApp ONLY and leaves Telegram gated.
      // Accepted trade-off (user decision 2026-08-27): anyone who knows the
      // paired number can drive the agent and spend the tenant's credits.
      WHATSAPP_ALLOW_ALL_USERS: "true",
      // decenchro-guard fails closed by default, and Atbash refuses every
      // action from an identity it has not onboarded:
      //   "Agent not registered. Onboard the agent at the dashboard before
      //    submitting actions."
      // We mint agent keys ourselves (createAgentIdentity) and Atbash exposes
      // no onboarding API, so until a real Atbash org onboards these pubkeys
      // EVERY guarded call (terminal, write_file, patch, web_search, …) is
      // blocked with "Atbash judge unavailable, blocking for safety" — a gate
      // that protects nothing and breaks everything. Fail open only covers the
      // ERROR verdict: once onboarding works, real BLOCK/HOLD verdicts are
      // still enforced, so this needs no revert to become safe again.
      ATBASH_FAIL_OPEN: "1",
      // Operator-only resource monitoring. Unset => the box skips the install.
    };

    // Human-readable server name for the provider console: what created it
    // (decenchro), which agent, when, and a short id so names never collide
    // (the provider requires unique names). e.g. decenchro-support-bot-20260705-c9aba1
    const datePart = row.created_at.slice(0, 10).replace(/-/g, "");
    const name = `decenchro-${slug(agentName, 24)}-${datePart}-${row.id.slice(0, 8)}`;

    const { serverId, endpoint } = await host.createServer({
      name,
      serverType,
      image: config.AGENT_IMAGE,
      // The image's cont-init hook reads these. DEPLOY_WEBHOOK_TOKEN is the name
      // it expects.
      envVars: {
        ATBASH_AGENT_KEY: config.ATBASH_AGENT_KEY,
        OPENROUTER_API_KEY: config.OPENROUTER_API_KEY,
        TELEGRAM_BOT_TOKEN: config.TELEGRAM_BOT_TOKEN,
        TELEGRAM_ALLOWED_USERS: config.TELEGRAM_ALLOWED_USERS,
        AGENT_NAME: config.AGENT_NAME,
        MODEL_ID: config.MODEL_ID,
        SOUL_MD: config.SOUL_MD,
        METRICS_TOKEN: config.METRICS_TOKEN,
        DEPLOYMENT_ID: config.DEPLOYMENT_ID,
        DEPLOY_WEBHOOK_URL: config.DEPLOY_WEBHOOK_URL,
        DEPLOY_WEBHOOK_TOKEN: config.DEPLOY_WEBHOOK_SECRET,
        // Hermes dashboard, exposed through decenchro-proxy on the single public
        // port Render routes. Setting HERMES_DASHBOARD is what moves metrics to
        // an internal port and starts that proxy — see
        // docker/agent/s6-rc.d/decenchro-{proxy,metrics}/run. HOST and PORT stay
        // at their defaults (0.0.0.0 and 9119); the non-loopback bind is
        // required, or the dashboard's auth gate never engages.
        HERMES_DASHBOARD: "1",
        HERMES_DASHBOARD_BASIC_AUTH_USERNAME: DASHBOARD_USERNAME,
        HERMES_DASHBOARD_BASIC_AUTH_PASSWORD: dashboardPassword(row.id),
        HERMES_DASHBOARD_BASIC_AUTH_SECRET: dashboardSessionSecret(row.id),
        BSC_AGENT_KEY: config.BSC_AGENT_KEY,
        BSC_CHAIN_ID: config.BSC_CHAIN_ID,
        BSC_RPC_URL: config.BSC_RPC_URL,
        WHATSAPP_ALLOW_ALL_USERS: config.WHATSAPP_ALLOW_ALL_USERS,
        ATBASH_FAIL_OPEN: config.ATBASH_FAIL_OPEN,
      },
    });

    await updateDeployment(row.id, {
      // The hetzner_server_id / hetzner_server_ip columns are deliberately left
      // untouched: a Render id is not numeric and a Render service has no IP.
      // They stay in the schema only so historical rows keep resolving through
      // serviceId() / metricsBase().
      provider_service_id: serverId,
      agent_endpoint: endpoint ?? null,
    });

    // ERC-8004 identity on BSC — best-effort with a hard time budget. Sits
    // after createServer so a failed provider create never burns gas, and in
    // its own try/catch so a chain problem can never fail the deploy: the
    // attest cron backfills any row left unregistered.
    if (bscConfigured()) {
      try {
        const reg = await Promise.race([
          // The hash lands in the row before the receipt wait, so if the race
          // below is lost the mint is still recoverable: the attest cron passes
          // it back as `pendingTx` and adopts it instead of minting again.
          registerAgentOnChain(row.id, {
            onTxHash: (hash) => updateDeployment(row.id, { erc8004_tx: hash }),
          }),
          new Promise<never>((_, reject) =>
            // 40s inside a 60s route (maxDuration in app/api/deploy/route.ts).
            // 20s could not fit the chain this does — fund tx + receipt, then
            // register tx + receipt — so registration was deferred on nearly
            // every deploy and the console showed no identity until the daily
            // cron ran.
            setTimeout(() => reject(new Error("timed out after 40s")), 40_000),
          ),
        ]);
        await updateDeployment(row.id, {
          erc8004_agent_id: reg.agentId,
          erc8004_tx: reg.txHash,
          bsc_address: reg.address,
          erc8004_chain_id: reg.chainId,
        });
      } catch (err) {
        console.log(
          `[AUDIT] erc8004 registration deferred deployment=${row.id} reason=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const finalRow = (await getDeploymentRow(row.id)) ?? row;
    return { deployment: rowToDeployment(finalRow) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "provisioning failed";
    await updateDeployment(row.id, { status: "failed", fail_reason: reason });
    const failedRow = (await getDeploymentRow(row.id)) ?? row;
    // Return the failed deployment so the operator can see which step broke,
    // rather than swallowing the partial provision.
    return { deployment: rowToDeployment(failedRow) };
  }
}
