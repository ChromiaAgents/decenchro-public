#!/usr/bin/env node
/**
 * The shared poller must keep a URL's last payload when its subscriber count
 * momentarily hits zero.
 *
 * `useSharedPoll`'s effect depends on `intervalMs`, and the fleet roster changes
 * cadence whenever an agent enters or leaves a transient state. Each change
 * unsubscribes and resubscribes. If the stream is dropped in between, the
 * resubscribe rebuilds it from `initialData` — the server-rendered page-load
 * snapshot — and serves that before the refetch lands: the fleet flickers back
 * to stale state, and an agent deployed after page load disappears for a frame.
 *
 * Driven through a ~40-line React stub rather than a renderer: the part under
 * test is the module-level stream cache, which has nothing to do with React.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "poll-check-"));
const stub = join(dir, "react-stub.mjs");

// Slots persist across renders; a render walks them in order, like React does.
writeFileSync(
  stub,
  `
const slots = [];
let i = 0;
export const __harness = { states: [], cleanups: [] };
export function __render(fn) { i = 0; __harness.cleanups.length = 0; return fn(); }
export function useState(init) {
  const j = i++;
  if (!slots[j]) slots[j] = { v: typeof init === "function" ? init() : init };
  const s = slots[j];
  return [s.v, (nv) => { s.v = typeof nv === "function" ? nv(s.v) : nv; __harness.states.push(s.v); }];
}
export function useRef(init) {
  const j = i++;
  if (!slots[j]) slots[j] = { current: init };
  return slots[j];
}
export function useEffect(fn) {
  i++;
  const cleanup = fn();
  if (typeof cleanup === "function") __harness.cleanups.push(cleanup);
}
export function useMemo(fn) { i++; return fn(); }
export function useCallback(fn) { i++; return fn; }
`,
);

// One entry, so the stub is a single instance shared with the module under test
// (bundling it twice would give the harness its own private hook slots).
const entry = join(dir, "entry.mjs");
writeFileSync(
  entry,
  `export { useSharedPoll } from ${JSON.stringify(process.cwd() + "/components/dashboard/use-poll.ts")};\n` +
    `export { __harness, __render } from ${JSON.stringify(stub)};\n`,
);

const bundle = join(dir, "use-poll.mjs");
const { spawnSync } = await import("node:child_process");
const build = spawnSync(
  "npx",
  [
    "--yes",
    "esbuild",
    entry,
    "--bundle",
    "--format=esm",
    `--alias:react=${stub}`,
    `--outfile=${bundle}`,
    "--log-level=error",
  ],
  { encoding: "utf8" },
);
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}

globalThis.document = {
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};

let body = { agents: ["FRESH"] };
globalThis.fetch = async () => ({ json: async () => body });

const { useSharedPoll, __harness, __render } = await import(bundle);

const URL_ = "/api/agents";
const SSR = { agents: ["SSR"] };
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)));

// First mount: seeded from the server payload, then the poll lands.
__render(() => useSharedPoll(URL_, 60_000, true, SSR));
const teardown = [...__harness.cleanups];
await settle();
const fetched = __harness.states.at(-1);
if (fetched?.data?.agents?.[0] !== "FRESH")
  throw new Error(`first poll never landed: ${JSON.stringify(fetched)}`);

// Cadence change: the roster went hot, so the only subscriber leaves and comes
// straight back with a tighter interval.
__harness.states.length = 0;
for (const c of teardown) c();
__render(() => useSharedPoll(URL_, 3_000, true, SSR));
const served = __harness.states[0];
if (!served) throw new Error("resubscribe served nothing from cache");
if (served.data?.agents?.[0] !== "FRESH")
  throw new Error(
    `resubscribe served the stale page-load payload: ${JSON.stringify(served.data)}`,
  );
if (served.loading)
  throw new Error("resubscribe reported loading with a cached payload in hand");

// And it must still be live, not a frozen cache.
body = { agents: ["NEWER"] };
await settle();
if (__harness.states.at(-1)?.data?.agents?.[0] !== "NEWER")
  throw new Error("stream stopped fetching after the resubscribe");

for (const c of __harness.cleanups) c();
console.log("poll cache: ok (payload survives a cadence change, stream stays live)");
process.exit(0);
