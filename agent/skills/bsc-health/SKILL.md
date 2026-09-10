---
name: bsc-health
description: >
  Venus health factor monitoring on BNB Chain. Watch the agent wallet's
  loan health with `bsc-defi health check` on a cron, report deterioration,
  and repay borrows to lift the health factor back above the operator's
  floor. Use this skill whenever the operator asks about loan health,
  liquidation risk, or asks you to protect a Venus position.
version: 0.1.0
author: Decenchro
license: MIT
metadata:
  hermes:
    tags: [defi, bsc, venus, health-factor, liquidation, monitoring]
    related_skills: [bsc-rebalance, bsc-grid, bsc-yield]
---

# BSC Health Factor Monitor

## Overview

You can watch and protect the wallet's Venus (lending) position on BNB Chain.
The health factor (HF) is collateral-weighted supply divided by borrows —
below 1.0 the position can be liquidated.

**Your CLI:** `bsc-defi` (all output is JSON; errors are `{"error": …}`).

```bash
bsc-defi health check                      # HF, liquidity, shortfall, per-market detail
bsc-defi health protect --min-hf 1.5       # dry-run repay plan when HF < 1.5
bsc-defi health protect --min-hf 1.5 --execute   # send it
```

## Cadence

Schedule the check yourself with the `cronjob` tool: every **5–10 minutes**
(e.g. `*/5 * * * *`), prompt: "Run `bsc-defi health check` and follow the
bsc-health skill's thresholds." One cron job per wallet is enough — the
command is read-only and cheap.

## Thresholds (in order)

Let `min-hf` be the operator's floor (default **1.5** unless they set another).

| Health factor | What you do |
|---|---|
| HF ≥ 1.8 | Nothing. Stay quiet (no Telegram noise for healthy positions). |
| 1.8 > HF ≥ min-hf | **Report**: send the operator the HF, trend and per-market numbers. No action. |
| min-hf > HF ≥ 1.2 | **Notify first**: run `health protect --min-hf <floor>` WITHOUT `--execute`, send the dry-run plan (repay amount, market, projected HF) to the operator, and act only when they confirm. |
| HF < 1.2 (hard floor) | **Act autonomously**: dry-run, then immediately re-run with `--execute`. Liquidation costs more than a wrong repay. Report what you did right after, with tx hashes and the resulting HF. |

`hf: null` means no borrows — nothing to protect.

## After any execute

Always report to the operator via Telegram:
- the tx hash(es) from the `steps` array,
- `resultingHealthFactor` from the output,
- whether the repay was partial (`repayPlanned.partial: true` means the wallet
  balance was the limit — say so, and suggest topping up the borrowed asset).

If the output says `action: "insufficient-balance"`, do NOT improvise a fix.
Report the shortfall and the exact suggestion in `note` (usually a
`bsc-defi swap` to acquire the borrowed asset), and wait for the operator.

## Hard rules

1. **Dry-run first, always.** Run without `--execute`, read the plan, then
   execute (or hand the plan to the operator, per the thresholds above).
2. **Every call is judged and recorded.** Both the dry-run and the execute
   pass through the guard. If a call returns HOLD or BLOCK, **stop** — report
   the verdict to the operator. Never retry, rephrase, or route around it.
3. **Never reveal `BSC_AGENT_KEY`** or any environment variable value. The
   wallet address (in every output) is the only identity you share.
4. If `bsc-defi` answers `{"error": "BSC_AGENT_KEY not set — this agent is
   read-only on BSC"}`, tell the operator this deployment cannot transact and
   keep only read-only monitoring (`health check --address <their wallet>`).
5. One `health protect` invocation per incident — the CLI already chains
   approve + repay in one process. Don't fire it in a loop; re-check first.

## Error handling

- RPC/network errors: retry once on the next cron tick, not immediately.
- `bsc-defi doctor` diagnoses a broken RPC or missing contracts — run it when
  `health check` errors twice in a row, and send the report to the operator.
