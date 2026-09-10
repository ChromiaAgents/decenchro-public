// Agent Advantage Report harness (TermiX track). Run from the repo root.
//
//   node scripts/agent-advantage/run-task.mjs capture --task health-rescue \
//     --trigger 2026-08-27T09:00:00Z --tx 0x... [--manual-minutes 25] [--note "..."]
//   node scripts/agent-advantage/run-task.mjs report
//
// `capture` measures one agent run: pulls the tx receipt from the BSC RPC
// (confirmation block timestamp + gas used), computes trigger→confirmed
// latency, and appends a row to scripts/agent-advantage/measurements.json.
// The trigger timestamp is the moment the condition became true (price move
// sent, borrow executed, rate changed) — the tc-<epochms> id of the agent's
// audited tool call is the on-chain evidence for when the agent acted; pass it
// as --tool-call to embed the reference.
//
// `report` renders docs/agent-advantage-report.md from the accumulated
// measurements: one section per task, agent vs manual columns, every claim
// carrying its bscscan + audit references. The report is regenerated whole —
// prose lives here, data in measurements.json.

import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const DATA = path.join(DIR, "measurements.json");
const REPORT = path.join(DIR, "..", "..", "docs", "agent-advantage-report.md");

const chainId = Number.parseInt(process.env.BSC_CHAIN_ID ?? "97", 10);
const rpc =
  process.env.BSC_RPC_URL ||
  (chainId === 56
    ? "https://bsc-rpc.publicnode.com"
    : "https://bsc-testnet-rpc.publicnode.com");
const explorer = chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com";

const TASKS = {
  "health-rescue": {
    title: "Health-factor rescue",
    what:
      "A Venus borrow position drops below the operator's minimum health factor. " +
      "The agent detects it on its cron, plans a repay, and executes.",
    manualBaseline:
      "A human notices the alert (if awake), opens the Venus app, connects a wallet, " +
      "and repays by hand.",
    metric: "condition true → repay confirmed on-chain",
  },
  "grid-overnight": {
    title: "Overnight grid execution",
    what:
      "A 6-level grid runs unattended overnight; price crossings must each be traded.",
    manualBaseline: "A human places the same trades by hand, but sleeps.",
    metric: "crossings traded / crossings occurred, spread captured",
  },
  "yield-move": {
    title: "Yield reallocation",
    what:
      "Supply rates shift so another Venus market clears the operator's threshold. " +
      "The agent scans hourly and moves funds.",
    manualBaseline: "A human checks rates when they remember to, then moves funds.",
    metric: "rate change → funds earning at the better rate",
  },
};

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf8"));
  } catch {
    return { measurements: [] };
  }
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

async function rpcCall(method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function capture() {
  const task = arg("task");
  const trigger = arg("trigger");
  const tx = arg("tx");
  if (!task || !TASKS[task] || !trigger || !tx) {
    console.error(
      `usage: capture --task <${Object.keys(TASKS).join("|")}> --trigger <iso> --tx <hash> ` +
        `[--tool-call tc-...] [--manual-minutes n] [--note "..."]`,
    );
    process.exit(1);
  }
  const receipt = await rpcCall("eth_getTransactionReceipt", [tx]);
  if (!receipt) throw new Error(`no receipt for ${tx} on chain ${chainId}`);
  const block = await rpcCall("eth_getBlockByNumber", [receipt.blockNumber, false]);
  const confirmed = new Date(Number.parseInt(block.timestamp, 16) * 1000);
  const triggerAt = new Date(trigger);
  const seconds = Math.round((confirmed.getTime() - triggerAt.getTime()) / 1000);

  const row = {
    task,
    trigger: triggerAt.toISOString(),
    confirmed: confirmed.toISOString(),
    agentSeconds: seconds,
    tx,
    gasUsed: Number.parseInt(receipt.gasUsed, 16),
    status: receipt.status === "0x1" ? "success" : "reverted",
    chainId,
    toolCallId: arg("tool-call") ?? null,
    manualMinutes: arg("manual-minutes") ? Number(arg("manual-minutes")) : null,
    note: arg("note") ?? null,
    capturedAt: new Date().toISOString(),
  };
  const data = readData();
  data.measurements.push(row);
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
  console.log(JSON.stringify(row, null, 2));
}

function fmtSeconds(s) {
  if (s == null) return "—";
  if (s < 120) return `${s}s`;
  return `${Math.round(s / 60)}m ${s % 60}s`;
}

function report() {
  const data = readData();
  const lines = [
    "# Agent Advantage Report",
    "",
    "Decenchro agents on BNB Smart Chain, measured against a human doing the same",
    "job by hand. Every agent action in this report was pre-judged by Atbash before",
    "it ran, recorded on Chromia (the `tc-…` ids), and is verifiable on-chain via",
    "the transaction links. Produced for the BNB Chain Smart Money Era hackathon,",
    "TermiX track.",
    "",
    `Chain: ${chainId === 56 ? "BSC mainnet (56)" : "BSC testnet (97)"} · ` +
      `Explorer: ${explorer}`,
    "",
  ];
  for (const [id, t] of Object.entries(TASKS)) {
    const rows = data.measurements.filter((m) => m.task === id);
    lines.push(`## ${t.title}`, "", t.what, "", `Manual baseline: ${t.manualBaseline}`, "");
    lines.push(`Metric: ${t.metric}`, "");
    if (!rows.length) {
      lines.push("_No measurements captured yet._", "");
      continue;
    }
    lines.push(
      "| run | agent (trigger → confirmed) | manual baseline | gas | evidence |",
      "|---|---|---|---|---|",
    );
    rows.forEach((m, i) => {
      const manual = m.manualMinutes != null ? `${m.manualMinutes}m (measured)` : "—";
      const audit = m.toolCallId ? ` · audit \`${m.toolCallId}\`` : "";
      lines.push(
        `| ${i + 1} | ${fmtSeconds(m.agentSeconds)} | ${manual} | ${m.gasUsed} | ` +
          `[tx](${explorer}/tx/${m.tx})${audit}${m.note ? ` · ${m.note}` : ""} |`,
      );
    });
    lines.push("");
  }
  lines.push(
    "## Method",
    "",
    "- Agent latency is condition-true → transaction confirmed, from block",
    "  timestamps (`scripts/agent-advantage/run-task.mjs capture`). The agent's",
    "  cron ticks every 60s, so ~60-90s is its floor; manual baselines are wall",
    "  clock for a person doing the same flow in the protocol UI.",
    "- The `tc-…` audit ids embed the epoch-ms the guard recorded the tool call;",
    "  they are queryable on Chromia through the Decenchro console.",
    "- Raw data: `scripts/agent-advantage/measurements.json`.",
    "",
  );
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join("\n"));
  console.log(`wrote ${REPORT} (${data.measurements.length} measurements)`);
}

const cmd = process.argv[2];
if (cmd === "capture") await capture();
else if (cmd === "report") report();
else {
  console.error("usage: run-task.mjs <capture|report>");
  process.exit(1);
}
