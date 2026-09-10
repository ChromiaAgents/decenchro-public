// The four marketplace categories (the BNB hackathon taxonomy) and how an
// arbitrary ERC-8004 agent gets classified into one.
//
// Client-safe on purpose: the /agents tab bar and hire CTAs import this. The
// classification order is: curated overrides (hand-picked, authoritative) →
// 8004scan categories/tags → keyword heuristics over name + description.

import type { AgentCategoryId } from "@/lib/dashboard/agent-categories";

import type { MarketplaceCategoryId } from "./types";

export type MarketplaceCategory = {
  id: MarketplaceCategoryId;
  label: string;
  /** One line under the section heading. Plain language, no em-dashes. */
  blurb: string;
  /** What "good" means in this category, shown as a mono micro-label. */
  metricLabel: string;
  /** The deployable category in lib/dashboard/agent-categories.ts (1:1). */
  deployCategoryId: AgentCategoryId;
  /** Keyword sent to 8004scan's /agents?search= for this section. */
  searchTerm: string;
  /** Lowercase fragments matched against name/description/tags/categories. */
  keywords: string[];
};

export const MARKETPLACE_CATEGORIES: readonly MarketplaceCategory[] = [
  {
    id: "rebalancing",
    label: "LP rebalancing",
    blurb: "Keeps concentrated liquidity positions in range and collecting fees.",
    metricLabel: "In-range uptime",
    deployCategoryId: "defi-rebalancing",
    searchTerm: "rebalanc",
    keywords: [
      "rebalanc",
      "in-range",
      "in range",
      "lp range",
      "liquidity position",
      "concentrated liquidity",
      "liquidity manager",
      "position manager",
    ],
  },
  {
    id: "grid",
    label: "Grid trading",
    blurb: "Works a ladder of buy and sell orders around the price, day and night.",
    metricLabel: "Round trips filled",
    deployCategoryId: "defi-grid",
    searchTerm: "grid",
    keywords: ["grid"],
  },
  {
    id: "yield",
    label: "Yield optimisation",
    blurb: "Watches lending rates and moves funds to the best return.",
    metricLabel: "Net APR captured",
    deployCategoryId: "defi-yield",
    searchTerm: "yield",
    keywords: [
      "yield",
      "apy",
      "apr",
      "auto-compound",
      "autocompound",
      "lending rate",
      "vault strateg",
    ],
  },
  {
    id: "health",
    label: "Health factor monitoring",
    blurb: "Monitors loan health and steps in before liquidation.",
    metricLabel: "Time to rescue",
    deployCategoryId: "defi-health",
    searchTerm: "health factor",
    keywords: [
      "health factor",
      "liquidation",
      "collateral ratio",
      "loan-to-value",
      "ltv",
      "lending guardian",
      "debt position",
    ],
  },
] as const;

export function marketplaceCategory(id: MarketplaceCategoryId): MarketplaceCategory {
  // The ids are a closed union, so this always finds one.
  return MARKETPLACE_CATEGORIES.find((c) => c.id === id) ?? MARKETPLACE_CATEGORIES[0];
}

export function isMarketplaceCategoryId(v: unknown): v is MarketplaceCategoryId {
  return (
    typeof v === "string" && MARKETPLACE_CATEGORIES.some((c) => c.id === v)
  );
}

/** Our deploy-time category → marketplace category (defi-* rows only). */
export function marketplaceCategoryForAgentCategory(
  agentCategoryId: string | null | undefined,
): MarketplaceCategoryId | null {
  const found = MARKETPLACE_CATEGORIES.find(
    (c) => c.deployCategoryId === agentCategoryId,
  );
  return found?.id ?? null;
}

/**
 * Curated overrides: hand-picked third-party agents pinned into a category,
 * keyed "chainId:tokenId". The demo-quality lever — an agent listed here skips
 * the heuristics entirely. Curated 2026-08-21 from the 8004scan detail
 * endpoint: on-category description plus a real signal (feedbacks, or a live
 * A2A/MCP endpoint). Test mints, "demo agent" scaffolds, dead/localhost
 * endpoints and mass-minted collections (BORT, Ensoul, Singularry) were left
 * to the heuristics.
 */
export const CURATED_CATEGORY_OVERRIDES: Record<string, MarketplaceCategoryId> = {
  // ── LP rebalancing ──
  // V3 Pools powered by HeyAnon: concentrated-liquidity execution layer for
  // Uniswap/PancakeSwap V3; live MCP, highest composite score in the section.
  "56:45650": "rebalancing",
  // Topaz Agent: ve(3,3) LP position optimiser for Topaz DEX on BNB Chain;
  // live A2A card (21 skills) and MCP server (43 tools).
  "56:113284": "rebalancing",
  // BNB LP Range Rebalancer: autonomous PancakeSwap V3 BNB/USDT range
  // rebalancer; healthy A2A card, sells position reports over ERC-8183.
  "56:265375": "rebalancing",
  // "rebalancing": LP range strategist, reads the live pool tick and returns
  // a re-centered range with withdraw/swap/re-add amounts (testnet).
  "97:1873": "rebalancing",

  // ── Grid trading ──
  // Grid Trader: deterministic buy/sell ladder planner with per-level price
  // walls; healthy A2A on agents.chainhelix.io.
  "56:269224": "grid",
  // grid-trading-agent: paper-trading grid runner on BSC testnet; one of the
  // few grid agents with real feedback (3 reviews, avg 84).
  "97:1777": "grid",
  // Gridwright: plan-only, no-custody grid plans for BSC pairs; healthy A2A.
  "97:1841": "grid",
  // AgentCensus Grid Planner: read-only geometric grid plans computed from
  // live PancakeSwap v2 reserves.
  "97:1875": "grid",

  // ── Yield optimisation ──
  // Beefy powered by HeyAnon: execution layer for Beefy yield vaults
  // (deposits, withdrawals, vault discovery); live MCP.
  "56:45422": "yield",
  // BNB Yield Optimizer: scans BSC lending/liquidity venues and migrates
  // capital when the risk-adjusted improvement covers costs.
  "56:265876": "yield",
  // yield-agent: routes capital to the best BSC yield venue (simulation
  // mode); 3 real feedbacks, avg 85.
  "97:1779": "yield",
  // "yield": yield-routing strategist surveying live venue APRs (PancakeSwap,
  // Venus, Aave, Lista) and returning a diversified allocation plan.
  "97:1874": "yield",

  // ── Health factor monitoring ──
  // Aave powered by HeyAnon: Aave lending execution layer that checks health
  // factors and collateral before returning calldata; live MCP.
  "56:45381": "health",
  // Health Factor Monitor: loan health factors, per-asset liquidation prices
  // and LP range health; healthy A2A on agents.chainhelix.io.
  "56:269228": "health",
  // health-factor-agent: pre-liquidation alerts plus rebalancing suggestions;
  // 3 real feedbacks, avg 87.
  "97:1778": "health",
  // AgentCensus Health Factor Monitor: signed Venus position reports with
  // HEALTHY/AT_RISK/LIQUIDATABLE verdicts.
  "97:1822": "health",
  // Conservative Guardian: defends a Venus borrow position, proposes a
  // repayBorrow that restores the health factor to 1.35.
  "97:1842": "health",
};

/**
 * Hand-excluded registrations, keyed "chainId:tokenId": agents that match the
 * section searches but must never list. The mirror of the overrides map —
 * overrides can only force INTO a category, so noise that self-matches every
 * search needs an explicit drop.
 */
export const CURATED_EXCLUDED: ReadonlySet<string> = new Set([
  // Atelo Reference Agent: self-describes as a reference/demo registration,
  // yet its description matches all four section searches.
  "97:1809",
]);

export function isCuratedExcluded(chainId: number, tokenId: string): boolean {
  return CURATED_EXCLUDED.has(`${chainId}:${tokenId}`);
}

/** Curated picks for one category as {chainId, tokenId}, optionally chain-filtered. */
export function curatedForCategory(
  categoryId: MarketplaceCategoryId,
  chains?: number[],
): { chainId: number; tokenId: string }[] {
  return Object.entries(CURATED_CATEGORY_OVERRIDES)
    .filter(([, cat]) => cat === categoryId)
    .map(([key]) => {
      const [chain, tokenId] = key.split(":");
      return { chainId: Number(chain), tokenId };
    })
    .filter((p) => !chains || chains.includes(p.chainId));
}

/**
 * Classify an agent into a marketplace category, or null when nothing matches.
 * `tags`/`categories` are 8004scan's own labels (detail endpoint only; the list
 * endpoint has neither, so callers usually classify on name + description).
 */
export function classifyAgent(input: {
  chainId: number;
  tokenId: string;
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  categories?: string[] | null;
}): MarketplaceCategoryId | null {
  const override = CURATED_CATEGORY_OVERRIDES[`${input.chainId}:${input.tokenId}`];
  if (override) return override;

  const labels = [...(input.tags ?? []), ...(input.categories ?? [])]
    .join(" ")
    .toLowerCase();
  if (labels) {
    for (const c of MARKETPLACE_CATEGORIES) {
      if (c.keywords.some((k) => labels.includes(k)) || labels.includes(c.id)) {
        return c.id;
      }
    }
  }

  const text = `${input.name ?? ""} ${input.description ?? ""}`.toLowerCase();
  if (!text.trim()) return null;
  let best: { id: MarketplaceCategoryId; hits: number } | null = null;
  for (const c of MARKETPLACE_CATEGORIES) {
    const hits = c.keywords.reduce(
      (n, k) => (text.includes(k) ? n + 1 : n),
      0,
    );
    if (hits > 0 && (!best || hits > best.hits)) best = { id: c.id, hits };
  }
  return best?.id ?? null;
}

/**
 * The hire journey (zero visitor wallet): the deploy wizard preselects the
 * category via /dashboard?category=defi-*. Routed through /signup with ?next so
 * a logged-out visitor lands back on the prefilled form after signing up;
 * auth-form honors ?next for already-registered visitors via its log-in link,
 * and both auth pages forward it on their already-signed-in redirect.
 *
 * Takes a deploy-category id rather than a MarketplaceCategory: a Decenchro
 * agent always has one, even when it maps to none of the four marketplace jobs
 * (a `general` agent has a form to preselect but no category section).
 */
export function hireHref(deployCategoryId: string): string {
  return `/signup?next=${encodeURIComponent(
    `/dashboard?category=${deployCategoryId}`,
  )}`;
}

/** Direct console link for visitors who already have an account. */
export function consoleHireHref(deployCategoryId: string): string {
  return `/dashboard?category=${deployCategoryId}`;
}
