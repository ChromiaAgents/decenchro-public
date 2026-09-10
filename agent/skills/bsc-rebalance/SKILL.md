---
name: bsc-rebalance
description: >
  PancakeSwap v3 liquidity rebalancing on BNB Chain. Watch the agent's LP
  positions with `bsc-defi positions` on a cron and re-center a position on
  the current price when it drifts out of range. Use this skill when the
  operator asks about LP positions, concentrated liquidity, fees earned, or
  asks you to keep a position in range.
version: 0.1.0
author: Decenchro
license: MIT
metadata:
  hermes:
    tags: [defi, bsc, pancakeswap, liquidity, rebalancing, lp]
    related_skills: [bsc-health, bsc-grid, bsc-yield]
---

# BSC LP Rebalancer

## Overview

Concentrated-liquidity positions only earn fees while the pool price is
inside their tick range. You keep the wallet's PancakeSwap v3 positions
centered.

**Your CLI:** `bsc-defi` (all output is JSON).

```bash
bsc-defi positions                              # every LP NFT: range, inRange, unclaimed fees
bsc-defi lp rebalance --id <tokenId> --width 10%          # dry-run: remove + re-mint centered
bsc-defi lp rebalance --id <tokenId> --width 10% --execute
bsc-defi lp add --pair WBNB/USDT --fee 2500 --range -5%..+5% --amount0 0.1 --amount1 60
bsc-defi lp remove --id <tokenId>               # decrease + collect + burn
```

## Cadence

Schedule with the `cronjob` tool: every **15–30 minutes** (e.g.
`*/20 * * * *`), prompt: "Run `bsc-defi positions` and follow the
bsc-rebalance skill." Rebalancing is not latency-critical; fee loss accrues
slowly.

## When to rebalance (anti-churn)

For each position in `pancakeV3`:

- **`inRange: false`** → rebalance now (dry-run → execute). An out-of-range
  position earns nothing.
- **In range but near the edge** — current tick within ~10% of the range
  width from either bound → rebalance ONLY if the last rebalance of this
  position was more than 6 hours ago. Edge-hugging churn burns gas and
  realizes impermanent loss; when in doubt, wait one more cycle.
- Otherwise: do nothing. A quiet in-range position is the goal state.

Remember (on-chain memory if available) the tokenId and timestamp of each
rebalance you execute, so the cooldown survives restarts.

## After any execute

Report to the operator via Telegram, in one message:
- old range → new range (ticks and prices, both in the command output),
- fees collected on the way out (`feesCollected` in the detail),
- tx hashes from `steps`,
- the amounts redeployed.

## Hard rules

1. **Dry-run first, always.** `lp rebalance --id N` without `--execute`,
   sanity-check the plan (expected amounts, new range around `currentTick`),
   then execute. Both calls are judged and recorded.
2. **Stop on HOLD/BLOCK.** Report the verdict; never retry around it.
3. **Never reveal `BSC_AGENT_KEY`.**
4. Read-only deployment (`BSC_AGENT_KEY not set` error): monitoring only —
   report positions drifting out of range, take no action.
5. Don't rebalance more than one position per invocation unless the operator
   asked — a chain of removals is harder to audit than one clean move.
6. Respect the spend caps: if the CLI refuses on `BSC_MAX_SPEND_BNB`, report
   it — never split a trade to sneak under a cap.

## Error handling

- `position #N does not exist` → the NFT was burned (perhaps by a previous
  rebalance); refresh with `bsc-defi positions`.
- Simulation reverts in the plan → include the revert text in your report;
  do not force `--execute` after a failed dry-run.
