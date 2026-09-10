---
name: bsc-grid
description: >
  Grid trading on PancakeSwap v2 (BNB Chain). Set up a price grid once with
  operator approval, then work it on a fast cron with `bsc-defi grid run`:
  sell the base token as the price rises through a level, buy it back as the
  price falls. Use this skill when the operator asks for grid trading, range
  trading, or automated buy-low/sell-high on a pair.
version: 0.1.0
author: Decenchro
license: MIT
metadata:
  hermes:
    tags: [defi, bsc, pancakeswap, grid-trading, trading, automation]
    related_skills: [bsc-health, bsc-rebalance, bsc-yield]
---

# BSC Grid Trader

## Overview

A grid places N price levels between a lower and upper bound. Each time the
price crosses a level upward you sell one level-size of the base token; each
downward crossing buys it back. Profit accumulates from round trips inside
the band.

**Your CLI:** `bsc-defi` (all output is JSON).

```bash
bsc-defi grid init --pair WBNB/USDT --lower 500 --upper 700 --levels 11 --size 0.01
bsc-defi grid run              # dry-run: which levels crossed, what would trade
bsc-defi grid run --execute    # trade the crossings
bsc-defi grid status           # config, last/current price, fills
```

Prices are units of the second token per unit of the first (`--pair A/B` →
B per A). `--size` is the amount of A traded per level.

## Setup — operator-approved, once

`grid init` only writes a local state file (no chain writes), but the grid's
parameters ARE the strategy. **Never invent them.** Ask the operator for
pair, band (lower/upper), level count and size — or present a proposal and
get an explicit yes before running `grid init`. Sanity-check the band around
the current price (`grid status` / the `currentPrice` in the init output):
a band that doesn't contain the current price only trades one direction.

## Cadence

After init, schedule with the `cronjob` tool: every **1–5 minutes**
(e.g. `*/2 * * * *`), prompt: "Run `bsc-defi grid run --execute` and follow
the bsc-grid skill." Tight cadence matters — a level crossed and re-crossed
between runs is a missed round trip.

The state file makes runs **idempotent**: the first run only records a price
baseline; each later run trades exactly the levels crossed since the last
one, and a crash resumes without double-trading. Don't try to track fills
yourself — the file is the ledger (`grid status` shows it).

## Reporting

- Per run: stay quiet when `action` is `none` or `baseline-set`.
- When trades execute: report fills (level, side, tx hash from `steps`) to
  the operator via Telegram in one message.
- **Daily summary** (schedule a second cron, e.g. `0 18 * * *`): run
  `grid status` and report round trips completed, fill count, current price
  vs band, and whether the band still makes sense.

## Hard rules

1. The cron may run `--execute` directly — the operator approved the grid at
   init. A **changed** grid (new band/size/pair) needs fresh approval and a
   fresh `grid init` (pass `--force` only after the operator confirms).
2. **Stop on HOLD/BLOCK.** Pause the cron job and report the verdict. Never
   retry around it.
3. **Never reveal `BSC_AGENT_KEY`.**
4. Read-only deployment (`BSC_AGENT_KEY not set`): `grid run` will refuse.
   Report that grid trading needs a funded key; `grid status` still works.
5. If the CLI refuses on `BSC_MAX_SPEND_BNB` (a violent move crossing many
   levels at once), report it and let the next cron tick continue the run —
   the state file resumes where it stopped. Never split trades to dodge caps.
6. If the price leaves the band entirely, tell the operator: the grid is
   idle and the capital could be re-banded (their call, not yours).

## Error handling

- `no grid state` → init was never run (or the volume was wiped); ask the
  operator before re-initializing.
- `no v2 pair` → the pair has no PancakeSwap v2 pool on this chain; the grid
  cannot price itself. Report and stop the cron.
