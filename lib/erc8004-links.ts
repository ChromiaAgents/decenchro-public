// Client-safe ERC-8004 link builders (no server-only import — the fleet card
// renders these in the browser). Registry addresses mirror
// lib/dashboard/erc8004-abi.ts; keep the two in sync if upstream redeploys.

export const ERC8004_IDENTITY_REGISTRY: Record<number, string> = {
  97: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  56: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
};

export function bscExplorerBase(chainId: number): string {
  return chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";
}

export function explorerAddressUrl(chainId: number, address: string): string {
  return `${bscExplorerBase(chainId)}/address/${address}`;
}

export function explorerTxUrl(chainId: number, tx: string): string {
  return `${bscExplorerBase(chainId)}/tx/${tx}`;
}

/** The identity NFT on the registry's token view. */
export function explorerAgentUrl(chainId: number, agentId: number): string {
  const registry = ERC8004_IDENTITY_REGISTRY[chainId] ?? ERC8004_IDENTITY_REGISTRY[97];
  return `${bscExplorerBase(chainId)}/nft/${registry}/${agentId}`;
}

/**
 * 8004scan's per-agent page.
 *
 * Two gotchas, both verified by rendering the pages (their app answers 200 for
 * every path and serves its own 404 body, so an HTTP status proves nothing):
 *   1. Testnets live on a separate host, testnet.8004scan.io.
 *   2. The path takes a chain SLUG, not the numeric chain id — /agents/bsc/…,
 *      not /agents/56/…. The numeric form 404s on both hosts.
 * Their REST API is the opposite: numeric chain id, and the mainnet host
 * answers for testnet agents too. Don't unify the two.
 */
const SCAN8004_CHAIN_SLUG: Record<number, { host: string; slug: string }> = {
  56: { host: "https://8004scan.io", slug: "bsc" },
  97: { host: "https://testnet.8004scan.io", slug: "bsc-testnet" },
};

export function scan8004AgentUrl(chainId: number, agentId: number): string {
  const c = SCAN8004_CHAIN_SLUG[chainId] ?? SCAN8004_CHAIN_SLUG[97];
  return `${c.host}/agents/${c.slug}/${agentId}`;
}

export function shortAddress(address: string): string {
  if (!address || address.length <= 12) return address || "—";
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}
