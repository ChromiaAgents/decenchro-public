// Shared between the server-side deploy orchestrator and the setup flow UI.
// No server-only import — the client needs the types.

export type DeployTarget = "local" | "cloud";

// The only cloud we provision to. DigitalOcean and Hetzner were retired on
// 2026-08-18: one container host means one code path, and it deletes the whole
// class of bug where a VM outlives its database row still holding live secrets.
export type CloudProvider = "render";

export const CLOUD_PROVIDERS: { id: CloudProvider; label: string }[] = [
  { id: "render", label: "Render" },
];

/**
 * What a deployment row's `provider` column can actually contain. Retired
 * providers are still in the database — 36 rows at the time of the cutover, two
 * of them still `running` — so reads must keep parsing them even though nothing
 * new can be created there.
 *
 * The DB check-constraint is deliberately NOT narrowed to match CloudProvider:
 * that would reject every historical row on its next update.
 */
export type DeploymentProvider = CloudProvider | "digitalocean" | "hetzner";

/**
 * True when a row can still be driven through a provider API. Retired rows read
 * fine but have no client behind them, so every call site that would reach a
 * cloud (reconcile, power actions, teardown) has to check this first rather than
 * letting hostClient() throw.
 */
export function isManagedProvider(
  provider: DeploymentProvider,
): provider is CloudProvider {
  return provider === "render";
}

/** Operator-facing reason a retired row has no controls. */
export const RETIRED_PROVIDER_REASON =
  "This agent runs on a provider Decenchro no longer manages (DigitalOcean/Hetzner). Remove it from that provider's console.";

export type DeployStepState = "pending" | "active" | "done" | "failed";

// Provisioning phases as reported by the deploy webhook (0..7), mapped to
// operator-facing steps. Shared: the server derives step states from
// provision_phase; the client shows granular progress on fleet cards so a
// refreshed page still tells the operator exactly where the boot is.
//
// Only phases 0, 5, 6 and 7 are ever reported: 0 on insert, then 5 and 6 from
// the container's cont-init hook and 7 from the readiness beacon. Phases 1-4
// were cloud-init on a VM host and fire nowhere since 2026-08-18, so the ladder
// lists what actually reports. Every step carries a `detail` because the phase
// number alone is useless to an operator — and because phase 0 is not a quick
// first step but the whole Render service-create plus the image pull, i.e.
// nearly all of the wall clock. Naming that is the point of the detail.
export const PROVISION_STEPS: {
  id: string;
  label: string;
  detail: string;
  phase: number;
}[] = [
  {
    id: "provision",
    label: "Creating the service and pulling the agent image",
    detail:
      "Render is creating the service and pulling the agent image. This is nearly all of the wait, measured at about 75 seconds; the remaining steps take seconds.",
    phase: 0,
  },
  {
    id: "configure",
    label: "Configuring the agent",
    detail:
      "The container is writing its config, guard plugin and skills onto the disk.",
    phase: 5,
  },
  {
    id: "start",
    label: "Starting the agent",
    detail: "Bringing up the gateway, the guard and the metrics endpoint.",
    phase: 6,
  },
  {
    id: "verify",
    label: "Verifying the agent is reachable",
    detail: "Waiting for the agent to answer its own health check.",
    phase: 7,
  },
];

/** Where the bar starts, so t=0 is a visible sliver rather than nothing. */
const FIRST_TICK = 0.04;

/**
 * Time constant for the first step's creep. Was 43_000 against a 1m55s deploy.
 * Re-measured 2026-08-27 by creating a real Render `standard` service from each
 * image and timing it to `live`: 109s on the old 985 MB image, 75s on the
 * slimmed 271 MB one. Tau is set so the ease is ~0.93 at that 75s, i.e. the bar
 * has covered 93% of the step and still has not arrived.
 *
 * The same measurement corrected an assumption worth keeping written down: the
 * pull is NOT most of the wait. 714 MB less image bought 34s, so the pull is now
 * ~13s and the other ~60s is Render's own create, schedule, container boot and
 * health-check gating. Shrinking the image further can win ~13s at absolute
 * best; the rest is not ours to cut.
 */
const FIRST_STEP_TAU_MS = 28_000;

/**
 * Current step for a provisioning phase: what is happening, why it is taking
 * what it is taking, and a 0..1 bar fraction.
 *
 * The fraction counts completed *steps*, not phase/7 — phases are not evenly
 * spaced in time (0 is minutes, 5→7 is seconds), so phase/7 pinned the bar near
 * empty for the entire deploy and then jumped to full.
 *
 * `elapsedMs` (age of the deployment) adds an nprogress-style creep INSIDE the
 * first step and nowhere else. That step is the ~2 minute image pull, and a bar
 * that holds one value for two minutes reads as a hung deploy however accurate
 * it is. The creep is asymptotic on purpose: it approaches the step's own
 * ceiling and never reaches it, so movement never implies a milestone that has
 * not been reported. Later steps land seconds apart and need no help — faking
 * progress there would only risk the bar running ahead of the truth.
 */
export function provisionProgress(
  phase: number,
  elapsedMs = 0,
): {
  label: string;
  detail: string;
  frac: number;
} {
  let i = 0;
  for (let n = PROVISION_STEPS.length - 1; n >= 0; n--) {
    if (phase >= PROVISION_STEPS[n].phase) {
      i = n;
      break;
    }
  }
  const active = PROVISION_STEPS[i];
  const done = (i + 1) / PROVISION_STEPS.length;
  if (i > 0) return { label: active.label, detail: active.detail, frac: done };

  const ease = 1 - Math.exp(-Math.max(elapsedMs, 0) / FIRST_STEP_TAU_MS);
  return {
    label: active.label,
    detail: active.detail,
    frac: FIRST_TICK + (done - FIRST_TICK) * ease,
  };
}

export type DeployStep = {
  id: string;
  label: string;
  state: DeployStepState;
  detail?: string;
};

export type Deployment = {
  id: string;
  // Reads can surface a retired provider, so this is the wide type.
  provider: DeploymentProvider;
  status: "running" | "succeeded" | "failed";
  steps: DeployStep[];
  // privKey is included so the operator can save it — shown once in the UI.
  agent?: { pubKey: string; privKey: string; fingerprint: string };
  createdAt: string;
};

export function demo(): void {
  const a = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`deploy-types self-check failed: ${msg}`);
  };

  // Only 0, 5, 6, 7 are ever reported, and the mapping is what decides whether
  // the operator sees "creating the service" or "starting the agent".
  a(provisionProgress(0).label.startsWith("Creating"), "phase 0 is the create");
  a(provisionProgress(0).detail.includes("75 seconds"), "phase 0 names the measured wait");
  a(provisionProgress(5).label === "Configuring the agent", "phase 5 configures");
  a(provisionProgress(6).label === "Starting the agent", "phase 6 starts");
  a(provisionProgress(7).label.startsWith("Verifying"), "phase 7 verifies");
  // Dead phases must not fall off the front of the ladder.
  a(provisionProgress(3).label === provisionProgress(0).label, "1-4 stay on the create");

  a(provisionProgress(7).frac === 1, "the last phase fills the bar");
  a(provisionProgress(5).frac === 0.5, "reported steps land on their own mark");
  a(
    provisionProgress(5, 999_999).frac === 0.5,
    "elapsed time never moves a step that has actually reported",
  );

  // The creep: monotonic, starts visible, and never reaches the next milestone.
  a(provisionProgress(0, 0).frac === FIRST_TICK, "t=0 is a visible sliver");
  a(provisionProgress(-1, 0).frac === FIRST_TICK, "a negative phase clamps here too");
  a(provisionProgress(0, -5_000).frac === FIRST_TICK, "clock skew cannot rewind it");
  const creep = [0, 5_000, 30_000, 75_000, 600_000].map(
    (ms) => provisionProgress(0, ms).frac,
  );
  a(
    creep.every((f, i) => i === 0 || f > creep[i - 1]),
    "the creep only ever moves forward",
  );
  a(creep.every((f) => f < 0.25), "the creep never claims the next step");
  a(
    provisionProgress(0, 75_000).frac > 0.22,
    "by the measured deploy time it is nearly at the step ceiling",
  );
  // A slow deploy must still stay inside the first step rather than sitting at
  // a number the next milestone owns.
  a(
    provisionProgress(0, 600_000).frac < 0.25,
    "a slow deploy still cannot claim the next step",
  );
  const fracs = [provisionProgress(0, 600_000).frac, 0.5, 0.75, 1];
  a(
    fracs.every((f, i) => i === 0 || f > fracs[i - 1]),
    "the bar only ever moves forward across steps",
  );
  a(
    PROVISION_STEPS.every((s) => s.detail.length > 20),
    "every step explains itself — the phase number alone told the operator nothing",
  );

  console.log("deploy-types self-check ok");
}

// Guarded, unlike the other self-checks in lib/: this module is imported by a
// "use client" component, and `process.argv` does not exist in the browser
// bundle — an unguarded read throws at module init.
if (
  typeof process !== "undefined" &&
  import.meta.url === `file://${process.argv?.[1]}`
)
  demo();
