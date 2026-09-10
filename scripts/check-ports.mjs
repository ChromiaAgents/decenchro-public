// Checks docker/agent/ports.sh, which decides where the metrics server binds and
// where a local liveness probe should look.
//
// Run from the repo root: node scripts/check-ports.mjs
//
// Three consumers source that file (decenchro-proxy, decenchro-metrics,
// decenchro-ready) plus the Dockerfile HEALTHCHECK. They used to each re-derive
// the ports from `${METRICS_PORT:-${PORT:-9484}}`, which is wrong the moment the
// dashboard moves metrics behind the proxy: the readiness beacon then polls a
// closed port and reports a healthy agent as failed. These cases pin the answers.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

function ports(env) {
  const out = execFileSync(
    "sh",
    [
      "-c",
      '. docker/agent/ports.sh; echo "$DECENCHRO_PUBLIC_PORT $DECENCHRO_METRICS_PORT $DECENCHRO_FRONT_PORT"',
    ],
    // A clean env: inheriting the caller's PORT would silently change the answers.
    { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" },
  );
  const [publicPort, metricsPort, frontPort] = out.trim().split(/\s+/);
  return { publicPort, metricsPort, frontPort };
}

// VM, dashboard off: unchanged from before the proxy existed. Metrics owns the
// published port and is what the beacon probes.
assert.deepEqual(ports({}), {
  publicPort: "9484",
  metricsPort: "9484",
  frontPort: "9484",
});

// VM with an operator-set METRICS_PORT: still honoured, still probed.
assert.deepEqual(ports({ METRICS_PORT: "9500" }), {
  publicPort: "9484",
  metricsPort: "9500",
  frontPort: "9500",
});

// Render, dashboard off: metrics takes Render's injected port.
assert.deepEqual(ports({ PORT: "10000" }), {
  publicPort: "10000",
  metricsPort: "10000",
  frontPort: "10000",
});

// Render, dashboard on: the proxy takes 10000, metrics steps aside to 9485, and
// the probe goes through the front door (which also proves the proxy routes).
assert.deepEqual(ports({ PORT: "10000", HERMES_DASHBOARD: "1" }), {
  publicPort: "10000",
  metricsPort: "9485",
  frontPort: "10000",
});

// The regression this file exists for: an explicit METRICS_PORT must NOT drag the
// probe onto a port nothing is listening on once the dashboard is enabled.
assert.deepEqual(ports({ PORT: "10000", HERMES_DASHBOARD: "1", METRICS_PORT: "9484" }), {
  publicPort: "10000",
  metricsPort: "9485",
  frontPort: "10000",
});

// Collision: an internal port equal to the public one would have the proxy and
// the metrics server race for the same address. Step off it instead.
assert.deepEqual(
  ports({ PORT: "10000", HERMES_DASHBOARD: "1", METRICS_INTERNAL_PORT: "10000" }),
  { publicPort: "10000", metricsPort: "10001", frontPort: "10000" },
);

// Same collision on a VM, where the public port is the 9484 default.
assert.deepEqual(ports({ HERMES_DASHBOARD: "1", METRICS_INTERNAL_PORT: "9484" }), {
  publicPort: "9484",
  metricsPort: "9485",
  frontPort: "9484",
});

// Every truthy spelling the s6 scripts accept has to agree, or metrics and the
// proxy end up disagreeing about who owns the public port.
for (const on of ["1", "true", "TRUE", "True", "yes", "YES", "Yes"]) {
  assert.equal(
    ports({ PORT: "10000", HERMES_DASHBOARD: on }).metricsPort,
    "9485",
    `HERMES_DASHBOARD=${on} must enable the proxy layout`,
  );
}
// And anything else must not.
for (const off of ["", "0", "false", "no", "off", "maybe"]) {
  assert.equal(
    ports({ PORT: "10000", HERMES_DASHBOARD: off }).metricsPort,
    "10000",
    `HERMES_DASHBOARD=${JSON.stringify(off)} must leave metrics on the public port`,
  );
}

console.log("ports.sh OK (vm, render, dashboard on/off, explicit overrides, collisions)");
