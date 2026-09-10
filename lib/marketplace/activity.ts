import "server-only";

import { decenchroAgentByToken, decenchroAuditSummary } from "./decenchro";
import { readReputationSummary } from "./registry";
import { scanRecentFeedbacks } from "./scan8004";

// Live activity for one agent: the freshest thing the marketplace can honestly
// say about it right now. Backs the detail page's live panel and
// /api/marketplace/live. Every source is best-effort; missing pieces are null.

export type AgentLiveActivity = {
  /** Straight-from-chain reputation (ReputationRegistry read, not an index). */
  reputation: { clients: number; count: number; score: number | null } | null;
  latestFeedback: {
    score: number | null;
    tag: string | null;
    from: string | null;
    txHash: string | null;
    submittedAt: string | null;
  } | null;
  /** Decenchro deployments only. */
  decenchro: {
    status: string;
    live: boolean;
    lastSeen: string | null;
    guardedActions: number | null;
  } | null;
  lastActive: string | null;
  readAt: string;
};

export async function agentLiveActivity(
  chainId: number,
  tokenId: string,
  opts: { noStore?: boolean } = {},
): Promise<AgentLiveActivity> {
  const [reputation, feedbacks, ours] = await Promise.all([
    readReputationSummary(chainId, tokenId),
    scanRecentFeedbacks(chainId, { limit: 100, noStore: opts.noStore }),
    decenchroAgentByToken(chainId, tokenId),
  ]);

  const mine = (feedbacks ?? []).find(
    (f) => f.agent?.chain_id === chainId && f.agent?.token_id === tokenId,
  );
  const latestFeedback = mine
    ? {
        score: mine.score ?? null,
        // tag2 tends to carry the meaningful label ("rebalancing"); tag1 the
        // issuer's own namespace.
        tag: mine.tag2 || mine.tag1 || null,
        from: mine.user_address ?? null,
        txHash: mine.transaction_hash ?? null,
        submittedAt: mine.submitted_at ?? null,
      }
    : null;

  let decenchro: AgentLiveActivity["decenchro"] = null;
  if (ours) {
    const audit = await decenchroAuditSummary(ours.deploymentId);
    decenchro = {
      status: ours.status,
      live: ours.live,
      lastSeen: ours.lastSeen,
      guardedActions: audit?.actions ?? null,
    };
  }

  const lastActive =
    decenchro?.lastSeen ?? latestFeedback?.submittedAt ?? null;

  return {
    reputation,
    latestFeedback,
    decenchro,
    lastActive,
    readAt: new Date().toISOString(),
  };
}
