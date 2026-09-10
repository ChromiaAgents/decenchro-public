// Checks that the flattened agent image re-declares everything the base image's
// Config carried.
//
// Run from the repo root: node scripts/check-image-config.mjs
//
// docker/agent/Dockerfile ends in a `FROM scratch` + `COPY --from=build / /`
// flatten, because Render caches no layers and a delete in a child layer leaves
// the bytes in the pull. `scratch` inherits NO metadata: every ENV, the
// ENTRYPOINT, WORKDIR, USER and VOLUME the base set has to be written out again
// by hand. Miss one and the failure is quiet and remote — drop
// HERMES_TUI_DIR and the dashboard's chat tab starts running `npm install` at
// runtime; drop PATH and nothing finds the venv at all.
//
// So this compares the base image's Config (read from the registry, no Docker
// daemon needed) against the final stage of our Dockerfile, and fails when the
// base declares something we do not. A base-image bump that adds a variable
// fails here instead of on a tenant's deploy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const DOCKERFILE = "docker/agent/Dockerfile";
const text = readFileSync(DOCKERFILE, "utf8");

// The base image tag comes from the Dockerfile itself, so this check follows a
// version bump automatically.
const versionArg = text.match(/^ARG HERMES_VERSION=(\S+)/m);
assert.ok(versionArg, `${DOCKERFILE}: no ARG HERMES_VERSION`);
const repo = "nousresearch/hermes-agent";
const tag = versionArg[1];

// ── the base image's Config, straight from the registry ───────────────────
async function baseConfig() {
  const auth = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`,
  );
  assert.ok(auth.ok, `docker hub token: HTTP ${auth.status}`);
  const { token } = await auth.json();
  const headers = {
    Authorization: `Bearer ${token}`,
    // The tag is a multi-arch index, so ask for both index and manifest kinds
    // and follow the amd64 entry — Render runs x86_64 and CI builds amd64 only.
    Accept: [
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].join(", "),
  };
  const get = async (ref) => {
    const res = await fetch(
      `https://registry-1.docker.io/v2/${repo}/manifests/${ref}`,
      { headers },
    );
    assert.ok(res.ok, `manifest ${ref}: HTTP ${res.status}`);
    return res.json();
  };

  let manifest = await get(tag);
  if (manifest.manifests) {
    const amd64 = manifest.manifests.find(
      (m) => m.platform?.architecture === "amd64" && m.platform?.os === "linux",
    );
    assert.ok(amd64, `${repo}:${tag} has no linux/amd64 manifest`);
    manifest = await get(amd64.digest);
  }

  const blob = await fetch(
    `https://registry-1.docker.io/v2/${repo}/blobs/${manifest.config.digest}`,
    { headers },
  );
  assert.ok(blob.ok, `config blob: HTTP ${blob.status}`);
  return (await blob.json()).config ?? {};
}

// ── what our final stage declares ─────────────────────────────────────────
// Only the LAST stage counts: an ENV in the build stage is exactly the thing
// that gets lost, so parsing the whole file would hide the bug this catches.
const stages = text.split(/^FROM /m);
const finalStage = "FROM " + stages[stages.length - 1];
assert.match(
  finalStage,
  /^FROM scratch\b/,
  "the final stage is no longer `FROM scratch`; if the flatten is gone, delete this check",
);

// Continuations first, so a multi-line `ENV A=1 \\\n B=2` reads as one line.
const joined = finalStage.replace(/\\\n\s*/g, " ");
const directive = (name) =>
  [...joined.matchAll(new RegExp(`^${name}\\s+(.*)$`, "gm"))].map((m) =>
    m[1].trim(),
  );

const declaredEnv = new Map();
for (const line of directive("ENV")) {
  // `ENV K=v K2=v2`, values unquoted in this file. A bare `ENV K v` is legacy
  // and not used here; assert that stays true rather than parsing it.
  assert.ok(
    /^\S+=/.test(line),
    `${DOCKERFILE}: legacy \`ENV key value\` form not supported: ${line}`,
  );
  for (const pair of line.match(/\S+=(?:"[^"]*"|\S*)/g) ?? []) {
    const eq = pair.indexOf("=");
    declaredEnv.set(
      pair.slice(0, eq),
      pair.slice(eq + 1).replace(/^"|"$/g, ""),
    );
  }
}

const config = await baseConfig();

// ── ENV: every base variable, same value ──────────────────────────────────
const missing = [];
const wrong = [];
for (const entry of config.Env ?? []) {
  const eq = entry.indexOf("=");
  const key = entry.slice(0, eq);
  const value = entry.slice(eq + 1);
  if (!declaredEnv.has(key)) missing.push(key);
  else if (declaredEnv.get(key) !== value)
    wrong.push(`${key}: base ${JSON.stringify(value)} vs ours ${JSON.stringify(declaredEnv.get(key))}`);
}
assert.deepEqual(
  missing,
  [],
  `${DOCKERFILE}'s final stage drops base ENV: ${missing.join(", ")}`,
);
assert.deepEqual(wrong, [], `ENV value drift from the base image:\n  ${wrong.join("\n  ")}`);

// ── the rest of the Config ────────────────────────────────────────────────
const entrypoint = directive("ENTRYPOINT")[0];
assert.ok(entrypoint, `${DOCKERFILE}: final stage has no ENTRYPOINT`);
assert.ok(
  entrypoint.includes(config.Entrypoint?.[0] ?? "\0"),
  `ENTRYPOINT drift: base ${JSON.stringify(config.Entrypoint)} vs ours ${entrypoint}`,
);

assert.equal(
  directive("WORKDIR").at(-1),
  config.WorkingDir,
  "WORKDIR drift from the base image",
);

for (const path of Object.keys(config.Volumes ?? {})) {
  assert.ok(
    directive("VOLUME").some((v) => v.split(/\s+/).includes(path)),
    `${DOCKERFILE}: base declares VOLUME ${path}, final stage does not`,
  );
}

// The base runs as root so its stage2 hook can chown the data volume; the s6
// services drop to the hermes user themselves. A flattened image that came up
// as hermes would fail that chown and every gateway write after it.
assert.equal(
  (directive("USER").at(-1) ?? "").toLowerCase(),
  (config.User || "root").toLowerCase(),
  "USER drift from the base image",
);

// Ours, and load-bearing: cont-init compares DECENCHRO_PAYLOAD_VERSION against
// the stamp on the volume to decide whether to refresh the plugin payload. If
// the flatten drops it, image upgrades stop reaching claimed agents silently.
for (const key of ["DECENCHRO_PAYLOAD", "DECENCHRO_PAYLOAD_VERSION"]) {
  assert.ok(declaredEnv.has(key), `${DOCKERFILE}: final stage must set ${key}`);
}

console.log(
  `image config OK (${repo}:${tag}: ${(config.Env ?? []).length} env vars, entrypoint, workdir, volume, user all re-declared)`,
);
