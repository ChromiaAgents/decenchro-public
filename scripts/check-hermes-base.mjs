// Resolves the newest published Hermes base image and compares it to the tag
// docker/agent/Dockerfile pins.
//
//   node scripts/check-hermes-base.mjs              # report
//   node scripts/check-hermes-base.mjs --self-check # just the comparator tests
//
// Why a script and not a one-line curl in the workflow: the ordering is the
// whole job and it is easy to get wrong. Tags are `v2026.8.3`, `v2026.8.16.2` —
// mixed component counts, and compared as STRINGS "v2026.8.3" sorts above
// "v2026.8.19", which would silently pin the fleet to an older base forever.
// Docker Hub's own `ordering=last_updated` is not a substitute either: a
// rebuild of an old tag bumps its timestamp.
//
// Exit code is 0 whether or not a bump is available — a newer base is news, not
// a failure. The workflow reads the GITHUB_OUTPUT values instead.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";

const REPO = "nousresearch/hermes-agent";
const DOCKERFILE = "docker/agent/Dockerfile";

/** `v2026.8.16.2` → [2026, 8, 16, 2]. Null for anything not a plain version. */
export function parseTag(tag) {
  const m = /^v(\d+(?:\.\d+)*)$/.exec(tag);
  return m ? m[1].split(".").map(Number) : null;
}

/** Numeric, component by component; a missing component counts as 0. */
export function compareTags(a, b) {
  const x = parseTag(a);
  const y = parseTag(b);
  if (!x || !y) throw new Error(`not a version tag: ${!x ? a : b}`);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function selfCheck() {
  // The bug this file exists to prevent.
  assert.ok(compareTags("v2026.8.19", "v2026.8.3") > 0, "8.19 is newer than 8.3");
  assert.ok("v2026.8.3" > "v2026.8.19", "…and string order really is the trap");
  // A patch suffix outranks the tag it patches, and vice versa.
  assert.ok(compareTags("v2026.8.16.2", "v2026.8.16") > 0, "16.2 is newer than 16");
  assert.ok(compareTags("v2026.8.16", "v2026.8.16.2") < 0, "and the reverse");
  assert.equal(compareTags("v2026.8.3", "v2026.8.3"), 0, "equal tags tie");
  // Year and month still win over the components below them.
  assert.ok(compareTags("v2027.1.1", "v2026.12.31") > 0, "year wins");
  assert.ok(compareTags("v2026.9.1", "v2026.8.99") > 0, "month wins");
  // Moving tags and pre-releases must never be selected as a pin.
  for (const junk of ["latest", "main", "v2026.8.3-rc1", "sha-abc123", ""])
    assert.equal(parseTag(junk), null, `${JSON.stringify(junk)} is not a pin`);
  // Sorting a realistic listing must land on 8.19, not 8.3.
  const listed = ["latest", "v2026.8.3", "v2026.8.19", "v2026.7.7.2", "main"];
  const newest = listed.filter(parseTag).sort(compareTags).at(-1);
  assert.equal(newest, "v2026.8.19", "newest of a mixed listing");
  console.log("hermes base comparator OK (numeric order, patch suffixes, moving tags rejected)");
}

if (process.argv.includes("--self-check")) {
  selfCheck();
  process.exit(0);
}
selfCheck();

// ── pinned ────────────────────────────────────────────────────────────────
const pinned = readFileSync(DOCKERFILE, "utf8").match(
  /^ARG HERMES_VERSION=(\S+)/m,
)?.[1];
assert.ok(pinned, `${DOCKERFILE}: no ARG HERMES_VERSION`);
assert.ok(parseTag(pinned), `${DOCKERFILE} pins a non-version tag: ${pinned}`);

// ── published ─────────────────────────────────────────────────────────────
const res = await fetch(
  `https://hub.docker.com/v2/repositories/${REPO}/tags?page_size=100&ordering=last_updated`,
);
assert.ok(res.ok, `docker hub tags: HTTP ${res.status}`);
const tags = (await res.json()).results.map((r) => r.name).filter(parseTag);
assert.ok(tags.length, "docker hub returned no version tags");

const latest = tags.sort(compareTags).at(-1);
const behind = tags.filter((t) => compareTags(t, pinned) > 0).sort(compareTags);
const needsBump = compareTags(latest, pinned) > 0;

console.log(`pinned:  ${pinned}`);
console.log(`latest:  ${latest}`);
console.log(
  needsBump
    ? `behind by ${behind.length}: ${behind.join(", ")}`
    : "up to date",
);

if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `pinned=${pinned}\nlatest=${latest}\nneeds_bump=${needsBump}\nbehind=${behind.length}\n`,
  );
