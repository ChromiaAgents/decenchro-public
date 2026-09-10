import "server-only";

import {
  classifyAgent,
  CURATED_CATEGORY_OVERRIDES,
  curatedForCategory,
  isCuratedExcluded,
  MARKETPLACE_CATEGORIES,
  type MarketplaceCategory,
} from "./categories";
import { listDecenchroAgents, type DecenchroPublicAgent } from "./decenchro";
import {
  scanAgentDetail,
  scanListAgents,
  scanStats,
  type ScanAgentSummary,
} from "./scan8004";
import {
  listingKey,
  timeAgo,
  type MarketplaceCategoryId,
  type MarketplaceListing,
  type MarketplaceStats,
  type NetworkFilter,
} from "./types";

// Merge layer: 8004scan externals + our registered deployments → the four
// category sections the /agents page renders. Ours are pinned first; externals
// rank by 8004scan's composite total_score; dedupe by chainId:tokenId keeps
// the Decenchro row when 8004scan has indexed the same NFT.

export type CategorySection = {
  category: MarketplaceCategory;
  listings: MarketplaceListing[];
  /** 8004scan's total match count for the section's search (approximate). */
  externalTotal: number | null;
};

function chainsFor(network: NetworkFilter): number[] {
  if (network === "56") return [56];
  if (network === "97") return [97];
  return [56, 97];
}

function fromScan(
  a: ScanAgentSummary,
  categoryId: MarketplaceCategoryId,
  nowMs: number,
): MarketplaceListing {
  const lastActive = a.updated_at ?? a.created_at ?? null;
  return {
    source: "external",
    chainId: a.chain_id,
    tokenId: String(a.token_id),
    name: a.name?.trim() || `Agent #${a.token_id}`,
    description: (a.description ?? "").trim(),
    imageUrl: a.image_url || null,
    categoryId,
    protocols: a.supported_protocols ?? [],
    averageScore: a.total_feedbacks > 0 ? a.average_score : null,
    totalFeedbacks: a.total_feedbacks ?? 0,
    totalScore: a.total_score ?? 0,
    isTestnet: Boolean(a.is_testnet),
    lastActive,
    lastActiveLabel: timeAgo(lastActive, nowMs),
    createdAt: a.created_at ?? null,
    live: false,
  };
}

function fromDecenchro(a: DecenchroPublicAgent, nowMs: number): MarketplaceListing {
  const lastActive = a.lastSeen ?? a.createdAt;
  return {
    source: "decenchro",
    chainId: a.chainId,
    tokenId: String(a.erc8004AgentId),
    name: a.name,
    description:
      `${a.categoryLabel} deployed on Decenchro. Every action is checked ` +
      `before it runs and kept on a tamper-proof record.`,
    imageUrl: null,
    categoryId: a.categoryId,
    protocols: ["Web"],
    averageScore: null,
    totalFeedbacks: 0,
    totalScore: Number.MAX_SAFE_INTEGER, // pinned first; never shown as a number
    isTestnet: a.chainId !== 56,
    lastActive,
    lastActiveLabel: timeAgo(lastActive, nowMs),
    createdAt: a.createdAt,
    live: a.live,
  };
}

async function externalsForCategory(
  category: MarketplaceCategory,
  chains: number[],
): Promise<{ listings: ScanAgentSummary[]; total: number | null }> {
  const results = await Promise.all(
    chains.map((chainId) =>
      scanListAgents({
        chainId,
        search: category.searchTerm,
        sortBy: "total_score",
        sortOrder: "desc",
        limit: 50,
      }),
    ),
  );
  const listings: ScanAgentSummary[] = [];
  let total: number | null = null;
  for (const r of results) {
    if (!r) continue;
    listings.push(...r.agents);
    if (r.total != null) total = (total ?? 0) + r.total;
  }
  return { listings, total };
}

/**
 * The four category sections. `only` narrows to one section (the ?category=
 * view) with a higher cap; the default view caps each section at `cap`.
 */
export async function marketplaceSections(
  network: NetworkFilter,
  opts: { only?: MarketplaceCategoryId | null; cap?: number } = {},
): Promise<CategorySection[]> {
  const chains = chainsFor(network);
  const cap = opts.cap ?? (opts.only ? 24 : 8);
  const categories = opts.only
    ? MARKETPLACE_CATEGORIES.filter((c) => c.id === opts.only)
    : MARKETPLACE_CATEGORIES;
  const nowMs = Date.now();

  const ours = (await listDecenchroAgents()).filter((a) =>
    chains.includes(a.chainId),
  );

  return Promise.all(
    categories.map(async (category) => {
      const { listings: external, total } = await externalsForCategory(
        category,
        chains,
      );

      const pinned = ours
        .filter((a) => a.categoryId === category.id)
        .map((a) => fromDecenchro(a, nowMs));
      const seen = new Set(pinned.map(listingKey));

      const rest: MarketplaceListing[] = [];
      for (const a of external) {
        // Hand-excluded noise never lists, whatever the search matched.
        if (isCuratedExcluded(a.chain_id, String(a.token_id))) continue;
        // The list endpoint has no tags/categories, so classification runs on
        // name + description (plus curated overrides). An agent whose text
        // clearly belongs to a different category is left for that section's
        // own search; a null classification keeps the search-term match.
        const classified = classifyAgent({
          chainId: a.chain_id,
          tokenId: String(a.token_id),
          name: a.name,
          description: a.description,
        });
        if (classified && classified !== category.id) continue;
        const listing = fromScan(a, category.id, nowMs);
        const key = listingKey(listing);
        if (seen.has(key)) continue;
        seen.add(key);
        rest.push(listing);
      }
      rest.sort((a, b) => b.totalScore - a.totalScore);

      // Curated picks the section search missed (verified live: some curated
      // agents match no search term) are fetched directly so curation actually
      // controls what lists, not only the detail-page badge. Cached like every
      // other scan fetch; a miss (indexer hiccup) just drops that pick.
      const missingCurated = curatedForCategory(category.id, chains).filter(
        (p) => !seen.has(`${p.chainId}:${p.tokenId}`),
      );
      const fetched = await Promise.all(
        missingCurated.map((p) => scanAgentDetail(p.chainId, p.tokenId)),
      );
      const curatedExtra: MarketplaceListing[] = [];
      for (const d of fetched) {
        if (!d) continue;
        const listing = fromScan(d, category.id, nowMs);
        const key = listingKey(listing);
        if (seen.has(key)) continue;
        seen.add(key);
        curatedExtra.push(listing);
      }

      // Order: ours pinned, then every curated external (in-search curated
      // already lead `rest` via total_score; the fetched ones join them), then
      // the heuristic matches.
      const curatedKeys = new Set(
        Object.keys(CURATED_CATEGORY_OVERRIDES).filter(
          (k) => CURATED_CATEGORY_OVERRIDES[k] === category.id,
        ),
      );
      const curatedInSearch = rest.filter((l) => curatedKeys.has(listingKey(l)));
      const uncurated = rest.filter((l) => !curatedKeys.has(listingKey(l)));
      const curated = [...curatedInSearch, ...curatedExtra].sort(
        (a, b) => b.totalScore - a.totalScore,
      );

      return {
        category,
        listings: [...pinned, ...curated, ...uncurated].slice(0, cap),
        externalTotal: total,
      };
    }),
  );
}

/** Header strip numbers: registry-wide counts + our live agents. */
export async function marketplaceStats(): Promise<MarketplaceStats> {
  const [stats, ours] = await Promise.all([scanStats(), listDecenchroAgents()]);
  return {
    totalAgents: stats?.total_agents ?? null,
    totalFeedbacks: stats?.total_feedbacks ?? null,
    decenchroLive: ours.filter((a) => a.live).length,
  };
}
