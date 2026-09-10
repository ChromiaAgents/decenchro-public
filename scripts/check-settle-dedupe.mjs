#!/usr/bin/env node
/**
 * Settling a session must bill its runtime exactly once, however many times the
 * settle runs.
 *
 * Two bugs shipped together (staging, 2026-09-01: three identical "final block
 * -$1.81" ledger rows in one minute, balance -$6.73):
 *
 *  1. meterCompany ticked a row (advancing metered_until in the DB) and then
 *     settled the SAME in-memory object in pauseForCredits, whose stale cursor
 *     re-billed the span the tick had just charged.
 *  2. A settle's ledger ref was keyed on its END cursor — wall-clock now,
 *     unique per call — so concurrent settles (the meter throttle is
 *     per-serverless-instance) sailed past the (kind, ref) unique index that
 *     dedupes ticks. The ref is now keyed on the START cursor, identical in
 *     every racer.
 *
 * Driven through stubs for the DB/provider modules; ./credits (the pure math)
 * runs for real.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "settle-check-"));
const root = process.cwd();

const stub = (name, source) => {
  const file = join(dir, name);
  writeFileSync(file, source);
  return file;
};

const ledgerStub = stub(
  "credit-ledger.mjs",
  `
// Mimics public.credit_apply: atomic, idempotent on (kind, ref) — a ref seen
// before moves nothing and returns the balance already recorded.
export const __ledger = { balance: 0, entries: [], refs: new Set() };
export async function applyCredit({ delta, kind, ref, note }) {
  const key = ref == null ? null : kind + ":" + ref;
  if (key !== null) {
    if (__ledger.refs.has(key)) return __ledger.balance;
    __ledger.refs.add(key);
  }
  __ledger.balance += delta;
  __ledger.entries.push({ delta, kind, ref, note });
  return __ledger.balance;
}
export async function getBalance() {
  return __ledger.balance;
}
`,
);
const metricsStub = stub(
  "agent-metrics.mjs",
  `export async function fetchAgentMetrics() { return { ok: false }; }\n`,
);
const deploymentsStub = stub(
  "deployments.mjs",
  `
export const __patches = [];
export async function listDeploymentRows() { throw new Error("rows are passed in"); }
export function serviceId(row) { return row.provider_service_id ?? null; }
export async function updateDeployment(id, patch) { __patches.push({ id, ...patch }); }
`,
);
const deployTypesStub = stub(
  "deploy-types.mjs",
  `export function isManagedProvider() { return true; }\n`,
);
const hostStub = stub(
  "host.mjs",
  `export function hostClient() { return { powerAction: async () => {} }; }\n`,
);
const emptyStub = stub("server-only.mjs", "export {};\n");

// The module under test, with its imports repointed at the stubs. Relative
// specifiers can't be esbuild --alias'd from the CLI, so the copy is rewritten.
const source = readFileSync(join(root, "lib/dashboard/metering.ts"), "utf8");
const rewrites = {
  '"server-only"': JSON.stringify(emptyStub),
  '"./agent-metrics"': JSON.stringify(metricsStub),
  '"./credit-ledger"': JSON.stringify(ledgerStub),
  '"./credits"': JSON.stringify(join(root, "lib/dashboard/credits.ts")),
  '"./deployments"': JSON.stringify(deploymentsStub),
  '"./deploy-types"': JSON.stringify(deployTypesStub),
  '"./host"': JSON.stringify(hostStub),
};
let rewritten = source;
for (const [from, to] of Object.entries(rewrites)) {
  if (!rewritten.includes(from))
    throw new Error(`metering.ts no longer imports ${from} — update this check`);
  rewritten = rewritten.replaceAll(from, to);
}
writeFileSync(join(dir, "metering.ts"), rewritten);
writeFileSync(
  join(dir, "entry.mjs"),
  `export { meterCompany } from "./metering.ts";\n` +
    `export { __ledger } from ${JSON.stringify(ledgerStub)};\n`,
);

const bundle = join(dir, "metering-bundle.mjs");
const build = spawnSync(
  "npx",
  [
    "--yes",
    "esbuild",
    join(dir, "entry.mjs"),
    "--bundle",
    "--format=esm",
    `--outfile=${bundle}`,
    "--log-level=error",
  ],
  { encoding: "utf8" },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}

const { meterCompany, __ledger } = await import(bundle);

const BLOCK_MS = 600_000;
// 30h5m of unmetered runtime — the cursor a staging row accumulates with no
// cron and nobody polling. 181 whole-or-part blocks.
const STALE_MS = 180 * BLOCK_MS + 5 * 60_000;
const OWED = 181;

const makeRow = (staleSince) => ({
  id: "dep-1",
  company_id: "co-1",
  agent_name: "steady-basalt-summit",
  status: "running",
  provider: "render",
  provider_service_id: "srv-1",
  metered_until: new Date(staleSince).toISOString(),
  expires_at: null,
  llm_cost_billed: 0,
});

const runtimeBilled = () =>
  __ledger.entries
    .filter((e) => e.kind === "runtime")
    .reduce((sum, e) => sum - e.delta, 0);
const settles = () => __ledger.entries.filter((e) => /final block/.test(e.note));

// One pass over a stale row with the balance about to run out: the tick bills
// the whole span floored, the settle bills only the tail — never the span again.
const staleSince = Date.now() - STALE_MS;
__ledger.balance = 5;
await meterCompany("co-1", [makeRow(staleSince)]);
if (runtimeBilled() !== OWED)
  throw new Error(
    `one exhaustion pass billed ${runtimeBilled()} credits for ${OWED} owed — the settle re-billed the ticked span`,
  );
if (settles().length !== 1)
  throw new Error(`one pass wrote ${settles().length} final-block entries`);

// A racing second pass, as another serverless instance that read the row before
// the first one wrote: its tick AND its settle must both land on refs the first
// pass already claimed.
await meterCompany("co-1", [makeRow(staleSince)]);
if (runtimeBilled() !== OWED)
  throw new Error(
    `a concurrent pass re-billed: ${runtimeBilled()} credits for ${OWED} owed`,
  );
if (settles().length !== 1)
  throw new Error(
    `concurrent settles both inserted (${settles().length} final-block entries) — settle refs must not be keyed on wall-clock now`,
  );

console.log(
  "settle dedupe: ok (exhaustion bills the session once, concurrent settles collide on the ledger ref)",
);
process.exit(0);
