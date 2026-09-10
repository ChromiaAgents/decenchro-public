// Guards the DigitalOcean/Hetzner retirement (2026-08-18).
//
// Run from the repo root: node scripts/check-retired-providers.mjs
//
// 36 deployment rows were created on the retired providers and two were still
// `running` at the cutover. They must keep READING — a fleet request that throws
// for one legacy row takes the whole roster down — while never reaching a
// provider API, because no client exists behind them any more.
//
// This is a static check on purpose: the real ones are server-only modules that
// need Supabase and a Render key, so importing them here would test the
// environment rather than the logic.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8");

// 1. The provisionable union is render-only, but the row type still parses the
//    retired values. Narrowing both would make every historical row a type lie.
const types = read("lib/dashboard/deploy-types.ts");
assert.match(types, /export type CloudProvider = "render";/, "CloudProvider must be render-only");
assert.match(
  types,
  /export type DeploymentProvider =\s*CloudProvider \| "digitalocean" \| "hetzner";/,
  "DeploymentProvider must still accept the retired providers",
);

// 2. Every path that can reach a cloud API is guarded. These are the four sites
//    tsc flagged when CloudProvider was narrowed; a new one must be guarded too.
for (const [file, why] of [
  ["lib/dashboard/deploy.ts", "reconcile + teardown run on every fleet read"],
  ["lib/dashboard/agent-metrics.ts", "budget enforcement runs inside a read path"],
  ["app/api/agents/manage/route.ts", "power actions are operator-triggered"],
]) {
  assert.match(read(file), /isManagedProvider/, `${file} must guard provider calls: ${why}`);
}

// 3. reconcileRow returns the row untouched before anything provider-shaped. If
//    the guard drifts below the first API call, one legacy row breaks the fleet.
const deploy = read("lib/dashboard/deploy.ts");
const reconcile = deploy.slice(deploy.indexOf("async function reconcileRow"));
const guardAt = reconcile.indexOf("isManagedProvider");
const firstHostCall = reconcile.indexOf("hostClient(");
assert.ok(guardAt > -1, "reconcileRow must guard on isManagedProvider");
assert.ok(
  guardAt < firstHostCall || firstHostCall === -1,
  "the isManagedProvider guard must come BEFORE the first hostClient call in reconcileRow",
);

// 4. teardown marks a retired row deleted without a provider call, so the Fleet's
//    delete button still clears the registry.
const teardown = deploy.slice(
  deploy.indexOf("export async function teardownDeployment"),
  deploy.indexOf("async function reconcileRow"),
);
assert.match(teardown, /isManagedProvider/, "teardown must special-case retired rows");
assert.match(teardown, /status: "deleted"/, "teardown must still settle the registry");

// 5. The deleted modules stay deleted: a stray re-import would fail to resolve at
//    build time, but an unused file quietly rotting back in is worth catching.
for (const gone of [
  "lib/dashboard/digitalocean.ts",
  "lib/dashboard/hetzner.ts",
  "lib/dashboard/cloud-init.ts",
]) {
  let exists = true;
  try {
    readFileSync(gone);
  } catch {
    exists = false;
  }
  assert.equal(exists, false, `${gone} was retired and must not come back`);
}

// 6. Nothing writes the retired columns any more. They are read-only shims for
//    historical rows; writing one on a Render deploy would store a lie.
const writers = ["lib/dashboard/deploy.ts", "app/api/agents/manage/route.ts"];
for (const f of writers) {
  const src = read(f);
  for (const col of ["hetzner_server_ip:", "hetzner_ssh_key_id:"]) {
    assert.ok(
      !src.includes(col),
      `${f} must not write ${col} — retired columns are read-only`,
    );
  }
}

console.log("retirement OK (render-only union, legacy rows read, guards ordered, columns read-only)");
