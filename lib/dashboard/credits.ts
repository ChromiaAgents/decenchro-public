export const CREDIT_USD = 0.01;
export const RUNTIME_CREDITS_PER_HOUR = 6;
export const MS_PER_RUNTIME_CREDIT = 3_600_000 / RUNTIME_CREDITS_PER_HOUR;
// One credit's worth of runtime, in minutes. It is also the billing increment,
// so the UI states it. Derived rather than written down twice: change the hourly
// rate and the copy follows instead of quietly going wrong.
export const RUNTIME_BLOCK_MINUTES = MS_PER_RUNTIME_CREDIT / 60_000;
export const LLM_MARKUP = 1.2;
// The trial has to survive its own first launch. At 10 credits it did not: a
// measured first session on 2026-08-19 reported $0.0833 of model spend in two
// and a half minutes, which billed 10 credits and paused the agent before the
// operator had done anything with it. The grant covers runtime and model use
// together, so it has to be sized against both, not against the 6 credits an
// hour of runtime alone.
export const SIGNUP_GRANT_CREDITS = 100;
export const SELF_SERVE_AGENT_LIMIT = 3;
export const IDLE_DESTROY_MS = 48 * 60 * 60 * 1000;
export const WARN_FRACTION = 0.2;
export const CRITICAL_FRACTION = 0.05;
export const METER_INTERVAL_MS = 60 * 1000;
export const CREDITS_EXHAUSTED_REASON = "Credit balance exhausted";
export const IDLE_REMOVED_REASON = "Idle server removed";

export type Pack = {
  id: string;
  label: string;
  usd: number;
  credits: number;
  bonusPct: number;
};

export const PACKS: Pack[] = [
  { id: "starter", label: "Starter", usd: 10, credits: 1_000, bonusPct: 0 },
  { id: "team", label: "Team", usd: 50, credits: 5_250, bonusPct: 5 },
  { id: "scale", label: "Scale", usd: 200, credits: 22_000, bonusPct: 10 },
];

export const SETTLEMENT_ASSETS = ["chr", "usdc", "usdt"] as const;
export type SettlementAsset = (typeof SETTLEMENT_ASSETS)[number];

// What a pack buys, in the unit a customer actually thinks in.
//
// This is an estimate and the UI says "about", because credits drain on uptime
// as well as on tokens: an agent left idle around the clock burns its balance
// whether or not anyone talks to it. The figure assumes an agent that is live
// while it works.
//
// Derived rather than guessed, from two measured sessions on 2026-08-19:
//
//   gpt-5.5        $0.08333 reported  -> 10 credits
//   gpt-5.4-mini   $0.00833 reported  ->  1 credit
//
// The fleet runs the second, so a conversation costs about 1 credit of model
// spend, plus the runtime it occupies. Runtime bills in 10 minute blocks at
// RUNTIME_BLOCK_MINUTES, so a conversation inside one block adds 1 more:
//
//   1 model + 1 runtime block = 2
//
// It happens to land back on the value this started at, which was a guess and
// was right only by accident: against gpt-5.5 the true figure was 11, not 2.
// Change the model and this has to be re-derived, which is why the arithmetic
// is written down rather than just the answer.
export const CREDITS_PER_CONVERSATION = 2;

// Rounded, because a precise-looking estimate reads as a promise.
export function conversationsFor(credits: number): number {
  const n = credits / CREDITS_PER_CONVERSATION;
  return n < 1_000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100;
}

export function packById(id: string): Pack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}

export function isSettlementAsset(value: string): value is SettlementAsset {
  return (SETTLEMENT_ASSETS as readonly string[]).includes(value);
}

export function creditsToUsd(credits: number): number {
  return Math.round(credits * CREDIT_USD * 100) / 100;
}

export function usdAmountString(usd: number): string {
  return usd.toFixed(2);
}

/**
 * A credit figure as the dollars a customer actually thinks in: 966 -> "$9.66".
 *
 * Credits are the internal unit (1 = $0.01) and the ledger stays in them, but
 * "966 cr" asks the reader to do arithmetic before they know whether they can
 * afford anything. Every credit VALUE in the console renders through here so the
 * unit cannot drift between the balance, a pack, an agent's spend and the ledger.
 * The word "credits" stays as the product noun; only the numbers change.
 *
 * `signed` forces a leading + on positive amounts, for the ledger where the
 * direction of an entry is the point. Negatives always show their sign.
 */
export function creditsUsdLabel(credits: number, signed = false): string {
  const usd = creditsToUsd(credits);
  const digits = Math.abs(usd).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = usd < 0 ? "-" : signed && usd > 0 ? "+" : "";
  return `${sign}$${digits}`;
}

export function runtimeDebit(
  meteredUntilMs: number,
  nowMs: number,
): { credits: number; meteredUntilMs: number } {
  const elapsed = nowMs - meteredUntilMs;
  if (!Number.isFinite(elapsed) || elapsed <= 0)
    return { credits: 0, meteredUntilMs };
  const credits = Math.floor(elapsed / MS_PER_RUNTIME_CREDIT);
  return {
    credits,
    meteredUntilMs: meteredUntilMs + credits * MS_PER_RUNTIME_CREDIT,
  };
}

// Close out a session. runtimeDebit floors and carries the remainder, which is
// correct while the agent is still running: the next tick picks the tail up. A
// stop has no next tick, so that tail would be free, and stop/start cycling just
// under the block size would run an agent indefinitely for nothing. Ending a
// session therefore bills up to the next whole block, the way cloud providers
// apply a minimum billing increment.
export function settleRuntimeDebit(
  meteredUntilMs: number,
  nowMs: number,
): { credits: number; meteredUntilMs: number } {
  const elapsed = nowMs - meteredUntilMs;
  if (!Number.isFinite(elapsed) || elapsed <= 0)
    return { credits: 0, meteredUntilMs };
  return {
    credits: Math.ceil(elapsed / MS_PER_RUNTIME_CREDIT),
    meteredUntilMs: nowMs,
  };
}

export function llmDebit(
  reportedUsd: number,
  billedUsd: number,
): { credits: number; billedUsd: number } {
  const delta = reportedUsd - billedUsd;
  if (!Number.isFinite(delta) || delta <= 0) return { credits: 0, billedUsd };
  const credits = Math.floor((delta * LLM_MARKUP) / CREDIT_USD);
  if (credits <= 0) return { credits: 0, billedUsd };
  return { credits, billedUsd: billedUsd + (credits * CREDIT_USD) / LLM_MARKUP };
}

export function runwayMs(balance: number, liveAgents: number): number {
  if (liveAgents <= 0) return Infinity;
  if (balance <= 0) return 0;
  return (balance / (RUNTIME_CREDITS_PER_HOUR * liveAgents)) * 3_600_000;
}

export function runwayHours(balance: number, liveAgents: number): number | null {
  const ms = runwayMs(balance, liveAgents);
  return Number.isFinite(ms) ? Math.round((ms / 3_600_000) * 10) / 10 : null;
}

export function projectedExpiry(
  balance: number,
  liveAgents: number,
  nowMs: number,
): string | null {
  const ms = runwayMs(balance, liveAgents);
  if (!Number.isFinite(ms)) return null;
  return new Date(nowMs + ms).toISOString();
}

export type BalanceLevel = "empty" | "critical" | "warn" | "ok";

export function balanceLevel(balance: number, lastTopup: number): BalanceLevel {
  if (balance <= 0) return "empty";
  const base = lastTopup > 0 ? lastTopup : SIGNUP_GRANT_CREDITS;
  if (balance <= base * CRITICAL_FRACTION) return "critical";
  if (balance <= base * WARN_FRACTION) return "warn";
  return "ok";
}

export type CreditGate = {
  canDeploy: boolean;
  needsCredits: boolean;
  atLimit: boolean;
  agentLimit: number | null;
};

export function creditGate(
  balance: number,
  enterprise: boolean,
  agentCount: number,
): CreditGate {
  const agentLimit = enterprise ? null : SELF_SERVE_AGENT_LIMIT;
  const atLimit = agentLimit !== null && agentCount >= agentLimit;
  const needsCredits = !enterprise && balance <= 0;
  return { canDeploy: !needsCredits && !atLimit, needsCredits, atLimit, agentLimit };
}

export function demo(): void {
  const a = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`credits self-check failed: ${msg}`);
  };

  a(PACKS.every((p) => p.credits >= p.usd / CREDIT_USD), "packs never short-change");
  a(packById("team")?.credits === 5_250, "team pack is 5250 credits");
  a(packById("nope") === null, "unknown pack id");
  a(usdAmountString(10) === "10.00", "amount is a decimal string");
  a(RUNTIME_BLOCK_MINUTES === 10, "a credit is ten minutes of runtime");

  // The console shows dollars, so the conversion is now user-visible in every
  // credit figure rather than only in the checkout total.
  a(creditsUsdLabel(966) === "$9.66", "credits render as dollars");
  a(creditsUsdLabel(1) === "$0.01", "one credit is a cent");
  a(creditsUsdLabel(0) === "$0.00", "zero is not blank");
  a(creditsUsdLabel(123_456) === "$1,234.56", "thousands are grouped");
  a(creditsUsdLabel(-250) === "-$2.50", "a debit keeps its sign outside the $");
  a(creditsUsdLabel(250, true) === "+$2.50", "the ledger can force a + on credits");
  a(creditsUsdLabel(-250, true) === "-$2.50", "signed does not double up on debits");
  a(creditsUsdLabel(0, true) === "$0.00", "zero gets no sign either way");
  // The grant and the packs have to be expressible in whole cents, or the
  // dollar label and the credit ledger disagree by a rounding step.
  for (const n of [SIGNUP_GRANT_CREDITS, ...PACKS.map((p) => p.credits)])
    a(Number.isInteger(n), `${n} credits is not a whole number of cents`);
  // A pack's dollar value is what the operator compares against its price, so
  // the bonus tiers must come out above their own price.
  for (const pack of PACKS)
    a(
      creditsToUsd(pack.credits) >= pack.usd,
      `pack ${pack.id} gives less credit value than it costs`,
    );
  a(conversationsFor(1_000) === 500, "the starter pack is about 500 conversations");
  a(conversationsFor(5_250) === 2_600, "estimates round rather than look precise");
  a(conversationsFor(22_000) === 11_000, "the scale pack is about 11,000");
  a(
    CREDITS_PER_CONVERSATION === 2,
    "a conversation is one credit of model spend plus one runtime block",
  );

  const start = 1_000_000;
  let r = runtimeDebit(start, start + 9 * 60_000);
  a(r.credits === 0 && r.meteredUntilMs === start, "under ten minutes bills nothing");
  r = runtimeDebit(start, start + 10 * 60_000);
  a(r.credits === 1, "ten minutes is one credit");
  r = runtimeDebit(start, start + 65 * 60_000);
  a(r.credits === 6 && r.meteredUntilMs === start + 60 * 60_000, "remainder carries");
  a(runtimeDebit(start, start - 1).credits === 0, "clock skew bills nothing");

  let cursor = start;
  let total = 0;
  for (let i = 0; i < 180; i++) {
    const step = runtimeDebit(cursor, start + (i + 1) * 60_000);
    total += step.credits;
    cursor = step.meteredUntilMs;
  }
  a(total === 18, "many small ticks bill the same as one big tick");

  // Ending a session bills the tail, so a run shorter than one block is not
  // free. This is what stops start/stop cycling from running an agent for
  // nothing: each cycle costs its block whether or not it completed one.
  a(settleRuntimeDebit(start, start).credits === 0, "settling an idle cursor bills nothing");
  a(settleRuntimeDebit(start, start - 1).credits === 0, "clock skew settles to nothing");
  a(settleRuntimeDebit(start, start + 9 * 60_000).credits === 1, "a nine minute session bills a block");
  a(settleRuntimeDebit(start, start + 10 * 60_000).credits === 1, "an exact block bills once");
  a(settleRuntimeDebit(start, start + 11 * 60_000).credits === 2, "a block and a tail bills twice");
  a(
    settleRuntimeDebit(start, start + 9 * 60_000).meteredUntilMs === start + 9 * 60_000,
    "settling closes the cursor at now, leaving no tail behind",
  );

  let cycled = 0;
  for (let i = 0; i < 10; i++) {
    const open = start + i * 30 * 60_000;
    cycled += settleRuntimeDebit(open, open + 9 * 60_000).credits;
  }
  a(cycled === 10, "ten short sessions bill ten blocks, not zero");

  // A settle after a mid-session tick charges the remainder once, never twice.
  const tick = runtimeDebit(start, start + 25 * 60_000);
  const tail = settleRuntimeDebit(tick.meteredUntilMs, start + 25 * 60_000);
  a(tick.credits === 2 && tail.credits === 1, "a 25 minute session bills three blocks in all");

  let l = llmDebit(0.1, 0);
  a(l.credits === 12, "ten cents of model use is twelve credits");
  a(llmDebit(0.001, 0).credits === 0, "sub-credit usage bills nothing");
  a(llmDebit(0, 5).credits === 0, "a reset agent never bills negative");
  l = llmDebit(0.005, 0);
  a(l.credits === 0 && l.billedUsd === 0, "cursor holds when nothing is billed");

  a(runwayMs(600, 1) === 100 * 60 * 60 * 1000, "600 credits is 100 agent-hours");
  a(runwayMs(600, 2) === 50 * 60 * 60 * 1000, "two agents burn twice as fast");
  a(runwayMs(0, 1) === 0, "no balance is no runway");
  a(projectedExpiry(600, 0, start) === null, "an idle company never expires");
  a(projectedExpiry(0, 1, start) === new Date(start).toISOString(), "empty expires now");

  a(balanceLevel(0, 1_000) === "empty", "zero is empty");
  a(balanceLevel(40, 1_000) === "critical", "under five percent is critical");
  a(balanceLevel(150, 1_000) === "warn", "under twenty percent is warn");
  a(balanceLevel(900, 1_000) === "ok", "a full balance is ok");
  a(
    balanceLevel(SIGNUP_GRANT_CREDITS * 0.1, SIGNUP_GRANT_CREDITS) === "warn",
    "a tenth of the trial grant warns",
  );
  a(
    balanceLevel(1, SIGNUP_GRANT_CREDITS) === "critical",
    "one credit against the trial grant is critical, not merely low",
  );
  a(
    SIGNUP_GRANT_CREDITS > CREDITS_PER_CONVERSATION,
    "the trial grant survives at least one conversation",
  );

  let g = creditGate(0, false, 0);
  a(g.needsCredits && !g.canDeploy, "no credits blocks deploy");
  g = creditGate(500, false, 0);
  a(g.canDeploy && g.agentLimit === SELF_SERVE_AGENT_LIMIT, "credits allow deploy");
  g = creditGate(500, false, SELF_SERVE_AGENT_LIMIT);
  a(g.atLimit && !g.canDeploy, "self-serve caps the fleet");
  g = creditGate(0, true, 99);
  a(g.canDeploy && g.agentLimit === null, "enterprise is invoiced and uncapped");

  console.log("credits self-check: OK");
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
