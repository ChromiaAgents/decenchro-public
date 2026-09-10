---
name: bsc-yield
description: >
  Venus yield optimisation on BNB Chain. Rank lending markets by real
  on-chain supply APY with `bsc-defi yield scan` on a cron, and move idle
  or supplied funds into the better market when the spread is worth the gas.
  Use this skill when the operator asks about yield, APY, lending returns,
  or where to park an asset.
version: 0.1.0
author: Decenchro
license: MIT
metadata:
  hermes:
    tags: [defi, bsc, venus, yield, apy, lending]
    related_skills: [bsc-health, bsc-rebalance, bsc-grid]
---

# BSC Yield Optimiser

## Overview

Venus supply rates move with utilisation. You scan them and reallocate when
it pays.

**Your CLI:** `bsc-defi` (all output is JSON).

```bash
bsc-defi yield scan                       # markets ranked by supply APY (on-chain rates)
bsc-defi yield scan --reference mainnet   # adds read-only chain-56 rates, labeled
bsc-defi yield move --asset USDT --to vUSDC             # dry-run: redeem + mint plan
bsc-defi yield move --asset USDT --to vUSDC --execute
```

APY is computed from `supplyRatePerBlock` (rate/1e18 × blocks-per-day,
compounded daily, 10,512,000 blocks/year) — real chain values, not an
indexer. On testnet the absolute numbers are noisy; `--reference mainnet`
shows what the same assets pay on chain 56 for context (read-only, labeled —
never trade on reference numbers).

## Cadence

Schedule with the `cronjob` tool: **hourly** (e.g. `17 * * * *`), prompt:
"Run `bsc-defi yield scan` and follow the bsc-yield skill." Rates drift
slowly; faster polling is noise.

## When to move

Move only when ALL hold:

- the APY delta between the current market and the best market for capital
  you actually hold is **> 50 basis points** (0.5 percentage points),
- the delta has held for **two consecutive scans** (remember the last scan;
  one-tick spikes are utilisation noise),
- the position is large enough that the extra yield clears gas within ~a
  week (on testnet gas is negligible — still respect the rule so behaviour
  matches mainnet).

Same-asset moves (`--asset USDT --to vUSDT`, depositing idle USDT) are the
simple case. **Cross-asset moves take two judged steps**: `yield move`
redeems and tells you in `note` that a `bsc-defi swap` is needed before the
mint — do the swap as its own dry-run → execute, then re-run `yield move`.
Present the whole sequence to the operator in the dry-run report before
executing any of it.

## After any execute

Report via Telegram: what moved (asset, from → to market), the APY delta
that justified it, tx hashes from `steps`, and the new balance
(`bsc-defi positions` shows the resulting supply).

## Hard rules

1. **Dry-run first, always** — send the plan, then `--execute`. Both calls
   are judged and recorded.
2. **Stop on HOLD/BLOCK.** Report the verdict; never retry around it.
3. **Never reveal `BSC_AGENT_KEY`.**
4. Read-only deployment (`BSC_AGENT_KEY not set`): keep scanning and report
   opportunities; take no action.
5. Never borrow to chase yield, and never move funds that serve as
   collateral for an open borrow — check `bsc-defi health check` first: if
   there are borrows, a redeem that drops HF below the bsc-health floor is
   off-limits (the two skills share one wallet).
6. Respect `action: "none"` outputs — if the CLI says there is nothing to
   move, there is nothing to move.

## Error handling

- `mainnet reference unavailable` inside an otherwise-good scan is fine —
  report testnet numbers and note the reference was down.
- Venus error codes (`protocol returned error code N`) → report verbatim;
  code 3 on mint/redeem usually means comptroller rejection (paused market).
