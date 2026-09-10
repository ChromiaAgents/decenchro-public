#!/usr/bin/env node
/**
 * The Hermes session token is scraped out of the console's HTML, because there
 * is no endpoint that mints it and a bare basic-auth'd `GET /api/pairing`
 * answers 401. That makes one regex load-bearing for the Fleet card's pairing
 * approval, and it has already been wrong once: the real injection is
 * `window.__HERMES_SESSION_TOKEN__="…"`, and a pattern without the dunders
 * matched nothing while looking perfectly reasonable.
 *
 * Pins the shape against a real captured page plus the near-misses.
 * Run: node scripts/check-pairing.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Kept in sync with SESSION_TOKEN_RE in lib/dashboard/agent-pairing.ts. Read
// from the source so the two cannot drift silently.
const src = readFileSync(new URL("../lib/dashboard/agent-pairing.ts", import.meta.url), "utf8");
const m = /export const SESSION_TOKEN_RE =\s*(\/[\s\S]*?\/);/.exec(src);
assert.ok(m, "SESSION_TOKEN_RE must stay a single exported literal this check can read");
// eslint-disable-next-line no-new-func -- reading our own source, not input.
const RE = new Function(`return ${m[1]}`)();

const TOKEN = "Ab3-_.xyz01234567890abcd";

// The real shape, as served by v2026.8.3 (captured 2026-08-27).
const real = `<style>--x:1;</style><script>window.__HERMES_SESSION_TOKEN__="${TOKEN}";window.__HERMES_DASHBOARD_X__=1;</script>`;
assert.equal(RE.exec(real)?.[1], TOKEN, "must match the shape the agent actually serves");

// Tolerated variants: no dunders, object-literal colon, whitespace.
for (const variant of [
  `HERMES_SESSION_TOKEN="${TOKEN}"`,
  `{ HERMES_SESSION_TOKEN: "${TOKEN}" }`,
  `window.__HERMES_SESSION_TOKEN__ = "${TOKEN}"`,
]) {
  assert.equal(RE.exec(variant)?.[1], TOKEN, `must tolerate: ${variant.slice(0, 40)}`);
}

// Must NOT match: no token present, or a value too short to be one.
assert.equal(RE.exec("<html><body>no token here</body></html>"), null, "a page with no token yields null");
assert.equal(RE.exec(`__HERMES_SESSION_TOKEN__="short"`), null, "a 5-char value is not a session token");
// Gated dashboard mode injects no token at all — the caller must see that as a
// failure rather than pulling some other window value out of the page.
assert.equal(
  RE.exec(`<script>window.__HERMES_AUTH_REQUIRED__=true;</script>`),
  null,
  "gated mode (auth required, no token injected) must not false-positive",
);

console.log("pairing token scrape OK (real shape, variants, and the near-misses)");
