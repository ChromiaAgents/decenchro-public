import "server-only";

import { createPublicClient, http, type PublicClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";

import {
  erc8004Registries,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
} from "@/lib/dashboard/erc8004-abi";

// Direct ERC-8004 registry reads over viem. Two jobs:
// 1. Fallback identity when 8004scan is down or hasn't indexed a fresh agent
//    yet (tokenURI/ownerOf + fetching the registration file ourselves).
// 2. The live trust read on the detail page: reputation straight from the
//    chain, not from an indexer.
//
// Everything returns null on failure. RPC endpoints are public infrastructure;
// a marketplace page must render without them.

const RPC_DEFAULTS: Record<number, string> = {
  56: "https://bsc-rpc.publicnode.com",
  97: "https://bsc-testnet-rpc.publicnode.com",
};

function rpcUrlFor(chainId: number): string {
  // Honor the platform's explicit RPC when it targets the same chain
  // (lib/dashboard/bsc.ts convention), otherwise use the public default.
  const configured = Number.parseInt(process.env.BSC_CHAIN_ID ?? "", 10);
  const explicit = (process.env.BSC_RPC_URL ?? "").trim();
  if (explicit && configured === chainId) return explicit;
  return RPC_DEFAULTS[chainId] ?? RPC_DEFAULTS[97];
}

const clients = new Map<number, PublicClient>();

function publicClientFor(chainId: number): PublicClient {
  let client = clients.get(chainId);
  if (!client) {
    client = createPublicClient({
      chain: chainId === 56 ? bsc : bscTestnet,
      transport: http(rpcUrlFor(chainId), { timeout: 5_000, retryCount: 1 }),
    });
    clients.set(chainId, client);
  }
  return client;
}

function toAgentId(tokenId: string): bigint | null {
  if (!/^\d{1,78}$/.test(tokenId)) return null;
  try {
    return BigInt(tokenId);
  } catch {
    return null;
  }
}

export type RegistryIdentity = {
  owner: `0x${string}`;
  tokenURI: string | null;
};

/** ownerOf + tokenURI from the IdentityRegistry. Null when the token does not
 * exist (ownerOf reverts) or the RPC is unreachable. */
export async function readAgentIdentity(
  chainId: number,
  tokenId: string,
): Promise<RegistryIdentity | null> {
  const agentId = toAgentId(tokenId);
  if (agentId == null) return null;
  const registry = erc8004Registries(chainId).identity;
  const client = publicClientFor(chainId);
  try {
    const owner = (await client.readContract({
      address: registry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    })) as `0x${string}`;
    let tokenURI: string | null = null;
    try {
      tokenURI = (await client.readContract({
        address: registry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "tokenURI",
        args: [agentId],
      })) as string;
    } catch {
      // A registered agent with a broken URI is still an agent.
    }
    return { owner, tokenURI };
  } catch {
    return null;
  }
}

export type LiveReputation = {
  /** Distinct feedback clients on-chain. */
  clients: number;
  /** Feedback count aggregated by getSummary (over the first ≤50 clients). */
  count: number;
  /** Average value, decimals applied; the deployed contracts use 0-100. */
  score: number | null;
};

/**
 * Live reputation from the ReputationRegistry. Live-contract gotcha (verified
 * on 97): getSummary REVERTS on an empty clientAddresses array, so resolve the
 * client list via getClients first and skip the summary read when it is empty.
 */
export async function readReputationSummary(
  chainId: number,
  tokenId: string,
): Promise<LiveReputation | null> {
  const agentId = toAgentId(tokenId);
  if (agentId == null) return null;
  const registry = erc8004Registries(chainId).reputation;
  const client = publicClientFor(chainId);
  try {
    const clientAddresses = (await client.readContract({
      address: registry,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getClients",
      args: [agentId],
    })) as readonly `0x${string}`[];
    if (!clientAddresses.length) return { clients: 0, count: 0, score: null };

    const [count, summaryValue, summaryValueDecimals] = (await client.readContract({
      address: registry,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getSummary",
      args: [agentId, [...clientAddresses.slice(0, 50)], "", ""],
    })) as readonly [bigint, bigint, number];

    const n = Number(count);
    const score =
      n > 0
        ? Number(summaryValue) / 10 ** Number(summaryValueDecimals)
        : null;
    return {
      clients: clientAddresses.length,
      count: n,
      score: score != null && Number.isFinite(score) ? score : null,
    };
  } catch {
    return null;
  }
}

const REGISTRATION_FILE_MAX_BYTES = 300_000;

/**
 * Fetch an agent's registration file from its agentURI. Handles https://,
 * ipfs:// (via a public gateway) and data:application/json (base64 or
 * URI-encoded). 5s timeout, size-capped, null on anything unexpected.
 */
export async function fetchRegistrationFile(uri: string): Promise<unknown | null> {
  const trimmed = (uri ?? "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("data:")) {
    try {
      const comma = trimmed.indexOf(",");
      if (comma < 0) return null;
      const meta = trimmed.slice(5, comma);
      const payload = trimmed.slice(comma + 1);
      const text = /;base64/i.test(meta)
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
      if (text.length > REGISTRATION_FILE_MAX_BYTES) return null;
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  const url = trimmed.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${trimmed.slice("ipfs://".length)}`
    : trimmed;
  if (!/^https:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > REGISTRATION_FILE_MAX_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
