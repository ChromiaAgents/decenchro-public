// Shared marketplace types + tiny pure helpers. Client-safe on purpose: the
// /agents client island imports these, so keep this file free of `server-only`,
// env reads, and node imports.

export type MarketplaceSource = "decenchro" | "external";

/** The four hackathon categories. Marketplace-local ids; each maps 1:1 to a
 * deployable `defi-*` id in lib/dashboard/agent-categories.ts. */
export type MarketplaceCategoryId = "rebalancing" | "grid" | "yield" | "health";

export type NetworkFilter = "all" | "56" | "97";

/** One card on /agents. Normalised from 8004scan rows (external) or from our
 * deployments table (decenchro), so the grid renders both identically. */
export type MarketplaceListing = {
  source: MarketplaceSource;
  chainId: number;
  /** ERC-721 tokenId on the IdentityRegistry, as a decimal string (uint256). */
  tokenId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  categoryId: MarketplaceCategoryId | null;
  /** 8004scan supported_protocols (MCP | A2A | OASF | Web | Email). */
  protocols: string[];
  /** Average feedback score, 0-100 (8004scan scale). Null when no feedback. */
  averageScore: number | null;
  totalFeedbacks: number;
  /** 8004scan composite ranking score; 0 for rows the indexer has not scored. */
  totalScore: number;
  isTestnet: boolean;
  lastActive: string | null;
  /** Precomputed in the RSC so server and client render identical text. */
  lastActiveLabel: string | null;
  createdAt: string | null;
  /** Decenchro rows only: the deployment is currently running. */
  live: boolean;
};

export type MarketplaceStats = {
  totalAgents: number | null;
  totalFeedbacks: number | null;
  /** Running Decenchro agents with an on-chain identity. */
  decenchroLive: number;
};

/** Relative time for "last active" readouts. Deterministic given `nowMs`, so
 * RSC-computed labels never drift from a later client render. */
export function timeAgo(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const diff = nowMs - then;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function chainLabel(chainId: number): string {
  return chainId === 56 ? "BSC" : chainId === 97 ? "BSC testnet" : `chain ${chainId}`;
}

/** Key for dedupe between our listings and 8004scan's index of the same NFT. */
export function listingKey(l: Pick<MarketplaceListing, "chainId" | "tokenId">): string {
  return `${l.chainId}:${l.tokenId}`;
}
