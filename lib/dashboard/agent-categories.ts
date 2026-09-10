// Curated agent categories: what an agent *is*, chosen once in the deploy wizard
// and fixed for the life of the deployment.
//
// Deliberately code, not a table (user decision 2026-08-11): the catalog is
// curated in-repo, so there is no authoring UI, no RLS, and no moderation
// surface. Adding a category is a pull request.
//
// Client-safe on purpose. The wizard imports this for the picker, so it must
// stay free of `server-only` and free of the persona text itself, which lives in
// category-soul.ts and ships inside cloud-init user_data.

export type AgentCategoryId =
  | "general"
  | "research"
  | "web3"
  | "defi-rebalancing"
  | "defi-grid"
  | "defi-yield"
  | "defi-health";

export type AgentCategory = {
  id: AgentCategoryId;
  label: string;
  /** One line on the wizard card: what this agent is for. */
  blurb: string;
  /**
   * One or two words each, rendered as a single uppercase mono line on the
   * card, so keep them short enough to survive a narrow column.
   *
   * Presentational and advisory only. These describe emphasis the persona
   * creates, NOT an enforced tool allowlist: Hermes' tool-gating mechanism is
   * still unresolved (no config key found; the decenchro-guard plugin, which
   * already intercepts every tool call, is the likely enforcement point). Do not
   * word these as guarantees until that lands.
   */
  tags: string[];
  /**
   * Top-level type this is a capability of, if any.
   *
   * The four DeFi categories shipped as top-level types alongside General,
   * Research and Web3, which put seven cards in the deploy form and read as
   * seven unrelated products. They are all the same Web3 agent with a different
   * job, so they hang off `web3`.
   *
   * The deploy form no longer offers them (user decision 2026-08-23, "keep only
   * the agent type"): a grouped category lights the Web3 card and is otherwise
   * invisible there. It still arrives through a marketplace ?category=defi-*
   * hire link and still deploys with its own persona, and ids are unchanged, so
   * deployed rows and category-soul.ts all still resolve.
   */
  group?: AgentCategoryId;
};

export const AGENT_CATEGORIES: readonly AgentCategory[] = [
  {
    id: "general",
    label: "General agent",
    blurb: "A capable all-rounder. Start here if you are not sure.",
    tags: ["Files", "Web", "Shell"],
  },
  {
    id: "research",
    label: "Research agent",
    blurb: "Digs through sources and reports back what it actually found.",
    tags: ["Search", "Cites sources"],
  },
  {
    id: "web3",
    label: "Web3 agent",
    blurb: "Knows crypto and web3, and explains it without the hype.",
    tags: ["Crypto", "Explains", "No advice"],
  },
  // The four DeFi categories match the BNB Agent Studio marketplace taxonomy
  // (rebalancing / grid / yield / health). Each pairs with a bsc-* skill the
  // agent image ships; the persona in category-soul.ts sets the operating
  // stance (dry-run first, act on operator-approved thresholds).
  {
    id: "defi-rebalancing",
    group: "web3",
    label: "LP rebalancing agent",
    blurb: "Keeps your PancakeSwap liquidity in range and collecting fees.",
    tags: ["PancakeSwap", "LP ranges"],
  },
  {
    id: "defi-grid",
    group: "web3",
    label: "Grid trading agent",
    blurb: "Places buy and sell orders around the price, around the clock.",
    tags: ["Grid", "Automated orders"],
  },
  {
    id: "defi-yield",
    group: "web3",
    label: "Yield optimisation agent",
    blurb: "Watches lending rates and moves funds to the best return.",
    tags: ["Venus", "Best APR"],
  },
  {
    id: "defi-health",
    group: "web3",
    label: "Health factor agent",
    blurb: "Guards your lending position and steps in before liquidation.",
    tags: ["Venus", "Liquidation guard"],
  },
] as const;

export const DEFAULT_AGENT_CATEGORY: AgentCategoryId = "general";

/** The cards the deploy form offers: everything that is not a capability of another type. */
export const TOP_LEVEL_CATEGORIES: readonly AgentCategory[] = AGENT_CATEGORIES.filter(
  (c) => !c.group,
);

/**
 * The top-level type a category belongs to — itself, unless it is a capability.
 *
 * Lets the picker derive both selections from the single category id it already
 * holds, so a /dashboard?category=defi-grid deep link lands on Web3 with grid
 * selected without any extra state.
 */
export function topLevelOf(id: AgentCategoryId): AgentCategoryId {
  return agentCategory(id).group ?? id;
}

/** Narrowing guard for untrusted input. The category selects the agent's
 *  instructions, so an unknown id is rejected by the API rather than defaulted. */
export function isAgentCategoryId(value: unknown): value is AgentCategoryId {
  return (
    typeof value === "string" &&
    AGENT_CATEGORIES.some((c) => c.id === value)
  );
}

/** Catalog entry for an id, falling back to the default for rows written before
 *  categories existed (or by a database still on an older migration). */
export function agentCategory(id: string | null | undefined): AgentCategory {
  const found = AGENT_CATEGORIES.find((c) => c.id === id);
  return (
    found ??
    AGENT_CATEGORIES.find((c) => c.id === DEFAULT_AGENT_CATEGORY) ??
    AGENT_CATEGORIES[0]
  );
}
