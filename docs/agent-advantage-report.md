# Agent Advantage Report

Decenchro agents on BNB Smart Chain, measured against a human doing the same
job by hand. Every agent action in this report was pre-judged by Atbash before
it ran, recorded on Chromia (the `tc-…` ids), and is verifiable on-chain via
the transaction links. Produced for the BNB Chain Smart Money Era hackathon,
TermiX track.

Chain: BSC testnet (97) · Explorer: https://testnet.bscscan.com

## Health-factor rescue

A Venus borrow position drops below the operator's minimum health factor. The agent detects it on its cron, plans a repay, and executes.

Manual baseline: A human notices the alert (if awake), opens the Venus app, connects a wallet, and repays by hand.

Metric: condition true → repay confirmed on-chain

_No measurements captured yet._

## Overnight grid execution

A 6-level grid runs unattended overnight; price crossings must each be traded.

Manual baseline: A human places the same trades by hand, but sleeps.

Metric: crossings traded / crossings occurred, spread captured

_No measurements captured yet._

## Yield reallocation

Supply rates shift so another Venus market clears the operator's threshold. The agent scans hourly and moves funds.

Manual baseline: A human checks rates when they remember to, then moves funds.

Metric: rate change → funds earning at the better rate

_No measurements captured yet._

## Method

- Agent latency is condition-true → transaction confirmed, from block
  timestamps (`scripts/agent-advantage/run-task.mjs capture`). The agent's
  cron ticks every 60s, so ~60-90s is its floor; manual baselines are wall
  clock for a person doing the same flow in the protocol UI.
- The `tc-…` audit ids embed the epoch-ms the guard recorded the tool call;
  they are queryable on Chromia through the Decenchro console.
- Raw data: `scripts/agent-advantage/measurements.json`.
