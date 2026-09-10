import "server-only";

import { unstable_cache } from "next/cache";

import { agentCategory } from "@/lib/dashboard/agent-categories";
import { fetchFleet, type FleetAgent } from "@/lib/dashboard/fleet";
import { and, desc, isNotNull, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { deployments } from "@/db/schema";

import { marketplaceCategoryForAgentCategory } from "./categories";
import type { MarketplaceCategoryId } from "./types";

// Decenchro-deployed agents on the PUBLIC marketplace. This is the one module
// that touches the deployments table from a public, unauthenticated surface,
// so it exposes exactly the fields the user approved for public listing (name,
// category, status, on-chain ids, created) and nothing else: no owner ids, no
// company ids, no Telegram data, no endpoints. The deployment id itself is
// public already — it is the agentURI minted on-chain.

/** Public projection of one registered deployment. */
export type DecenchroPublicAgent = {
  deploymentId: string;
  name: string;
  /** Deploy-time category id (defi-* for the DeFi agents). */
  agentCategoryId: string;
  categoryId: MarketplaceCategoryId | null;
  categoryLabel: string;
  status: string;
  live: boolean;
  erc8004AgentId: number;
  chainId: number;
  bscAddress: string | null;
  registrationTx: string | null;
  attestedAt: string | null;
  lastSeen: string | null;
  createdAt: string;
};

type PublicRow = {
  id: string;
  agent_name: string;
  category_id: string | null;
  status: string;
  erc8004_agent_id: number | null;
  erc8004_tx: string | null;
  bsc_address: string | null;
  erc8004_chain_id: number | null;
  erc8004_attested_at: string | null;
  atbash_pubkey: string | null;
  last_seen: string | null;
  created_at: string;
};

// Only the public columns are selected — the service-role client can read the
// secret ones, so never `select("*")` from here.
// Explicit projection, never select(). This module serves a PUBLIC page and the
// connection it uses can read the encrypted secret columns.
const PUBLIC_COLUMNS = {
  id: deployments.id,
  agent_name: deployments.agent_name,
  category_id: deployments.category_id,
  status: deployments.status,
  erc8004_agent_id: deployments.erc8004_agent_id,
  erc8004_tx: deployments.erc8004_tx,
  bsc_address: deployments.bsc_address,
  erc8004_chain_id: deployments.erc8004_chain_id,
  erc8004_attested_at: deployments.erc8004_attested_at,
  atbash_pubkey: deployments.atbash_pubkey,
  last_seen: deployments.last_seen,
  created_at: deployments.created_at,
} as const;

function toPublicAgent(r: PublicRow): DecenchroPublicAgent | null {
  if (r.erc8004_agent_id == null) return null;
  const category = agentCategory(r.category_id);
  return {
    deploymentId: r.id,
    name: r.agent_name,
    agentCategoryId: category.id,
    categoryId: marketplaceCategoryForAgentCategory(category.id),
    categoryLabel: category.label,
    status: r.status,
    live: r.status === "running" || r.status === "starting",
    erc8004AgentId: r.erc8004_agent_id,
    // Rows registered before the chain column existed default to testnet, the
    // chain the platform launched on.
    chainId: r.erc8004_chain_id ?? 97,
    bscAddress: r.bsc_address ?? null,
    registrationTx: r.erc8004_tx ?? null,
    attestedAt: r.erc8004_attested_at ?? null,
    lastSeen: r.last_seen,
    createdAt: r.created_at,
  };
}

async function listRegisteredRows(): Promise<PublicRow[]> {
  try {
    const rows = await db()
      .select(PUBLIC_COLUMNS)
      .from(deployments)
      .where(and(isNotNull(deployments.erc8004_agent_id), ne(deployments.status, "deleted")))
      .orderBy(desc(deployments.created_at))
      .limit(100);
    return rows as unknown as PublicRow[];
  } catch {
    // No database configured: the marketplace simply has no Decenchro listings.
    return [];
  }
}

/** All publicly-listed Decenchro agents, cached for 60s. */
export const listDecenchroAgents = unstable_cache(
  async (): Promise<DecenchroPublicAgent[]> => {
    const rows = await listRegisteredRows();
    return rows
      .map(toPublicAgent)
      .filter((a): a is DecenchroPublicAgent => a != null);
  },
  ["marketplace-decenchro-agents"],
  { revalidate: 60 },
);

/** The Decenchro deployment behind an on-chain identity, or null when the
 * token was not minted by us. */
export async function decenchroAgentByToken(
  chainId: number,
  tokenId: string,
): Promise<DecenchroPublicAgent | null> {
  // Our agent ids are small sequential mints; anything beyond Number range is
  // by definition not ours.
  if (!/^\d{1,15}$/.test(tokenId)) return null;
  const agents = await listDecenchroAgents();
  return (
    agents.find(
      (a) => a.chainId === chainId && a.erc8004AgentId === Number(tokenId),
    ) ?? null
  );
}

export type DecenchroAuditSummary = {
  /** Guarded tool calls on the Atbash/Chromia record (recent-sample count). */
  actions: number;
  verdicts: { green: number; yellow: number; red: number };
  lastActive: string | null;
};

// The fleet read needs platform Atbash creds and hits an external API; cache
// the whole roster for 60s and never let a failure surface (null = "no audit
// feed right now", which the UI states honestly).
const cachedFleetAgents = unstable_cache(
  async (): Promise<FleetAgent[] | null> => {
    try {
      const fleet = await fetchFleet();
      return fleet.agents;
    } catch {
      return null;
    }
  },
  ["marketplace-fleet-agents"],
  { revalidate: 60 },
);

/** Guarded-action counts for one deployment (matched by Atbash pubkey). */
export async function decenchroAuditSummary(
  deploymentId: string,
): Promise<DecenchroAuditSummary | null> {
  try {
    const [rows, fleetAgents] = await Promise.all([
      listRegisteredRows(),
      cachedFleetAgents(),
    ]);
    if (!fleetAgents) return null;
    const pubkey = rows.find((r) => r.id === deploymentId)?.atbash_pubkey;
    if (!pubkey) return null;
    const agent = fleetAgents.find(
      (a) => a.pubkey.toLowerCase() === pubkey.toLowerCase(),
    );
    if (!agent) return { actions: 0, verdicts: { green: 0, yellow: 0, red: 0 }, lastActive: null };
    return {
      actions: agent.actions,
      verdicts: agent.verdicts,
      lastActive: agent.lastActive,
    };
  } catch {
    return null;
  }
}
