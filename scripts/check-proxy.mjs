// Routing check for docker/agent/proxy.mjs. Stands up two fake upstreams on
// throwaway ports and asserts the split.
//
// Run from the repo root: node scripts/check-proxy.mjs
//
// Worth having because the routing is exact-match and the failure is silent in
// the wrong direction: a prefix test would send Render's /health to the
// dashboard, which fails the health check and rolls the deploy back.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import assert from "node:assert/strict";

const PUBLIC = 19484;
const METRICS = 19485;
const DASH = 19119;

// Every step announces itself, so a stall names the step instead of printing
// nothing. Three sockets are in play here and each of them can hang.
const step = (s) => console.log(`  · ${s}`);
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// What each upstream actually received, so the request side can be asserted and
// not just the response.
const seen = [];

function stub(name, port) {
  return new Promise((res, rej) => {
    const s = createServer((req, r) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        seen.push({ name, url: req.url, headers: req.headers, body });
        r.writeHead(200, {
          "content-type": "text/plain",
          // A response-side hop-by-hop header, to prove the proxy strips it on
          // the way back too. Deliberately NOT transfer-encoding: declaring that
          // stops Node framing the body, and the client then hangs waiting for a
          // terminating chunk — which would test this stub, not the proxy.
          "proxy-authenticate": 'Basic realm="stub"',
        });
        r.end(`${name}:${req.url}`);
      });
    });
    s.on("upgrade", (_req, sock) => {
      sock.write("HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\n\r\n");
      sock.write(`${name}-ws`);
    });
    s.on("error", rej);
    s.listen(port, "127.0.0.1", () => res(s));
  });
}

// The dashboard binds to loopback in the container so Render detects exactly one
// port, which means Hermes' own auth gate does not engage and the proxy is the
// only thing in front of it — including in front of /api/pty, a shell. These
// credentials are what the assertions below prove is enforced.
const USER = "operator";
const PASS = "s3cret-per-deployment";
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;

const metrics = await stub("METRICS", METRICS);
const dash = await stub("DASH", DASH);

const proxy = spawn(process.execPath, ["docker/agent/proxy.mjs"], {
  env: {
    ...process.env,
    DECENCHRO_PROXY_PORT: String(PUBLIC),
    METRICS_INTERNAL_PORT: String(METRICS),
    HERMES_DASHBOARD_PORT: String(DASH),
    HERMES_DASHBOARD_BASIC_AUTH_USERNAME: USER,
    HERMES_DASHBOARD_BASIC_AUTH_PASSWORD: PASS,
  },
  stdio: "inherit",
});
// A leftover proxy from an interrupted run holds the port, and the child then
// dies on EADDRINUSE while the asserts below quietly talk to the STALE process.
// Fail loudly instead of debugging a ghost.
let proxyDead = false;
proxy.on("exit", (code) => {
  proxyDead = true;
  if (code !== 0 && code !== null) {
    console.error(`proxy exited early (code ${code}) — is :${PUBLIC} already in use?`);
  }
});

function cleanup() {
  proxy.kill();
  for (const s of [metrics, dash]) {
    try {
      s.closeAllConnections();
      s.close();
    } catch {
      /* already closed */
    }
  }
}

try {
  await nap(600);
  assert.equal(proxyDead, false, `proxy did not stay up — :${PUBLIC} likely in use`);

  const get = async (p) => {
    step(`GET ${p}`);
    return (
      await fetch(`http://127.0.0.1:${PUBLIC}${p}`, {
        headers: { authorization: AUTH },
      })
    ).text();
  };
  assert.equal(await get("/health"), "METRICS:/health");
  assert.equal(await get("/metrics"), "METRICS:/metrics");
  // Query string must not defeat the exact-path match.
  assert.equal(await get("/metrics?x=1"), "METRICS:/metrics?x=1");
  // Anything else is the dashboard, including lookalike prefixes.
  assert.equal(await get("/"), "DASH:/");
  assert.equal(await get("/login"), "DASH:/login");
  assert.equal(await get("/metrics/extra"), "DASH:/metrics/extra");
  assert.equal(await get("/healthz"), "DASH:/healthz");

  // A request body survives the hop, and hop-by-hop headers do not.
  step("POST /api/config (body, headers)");
  const posted = await fetch(`http://127.0.0.1:${PUBLIC}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: AUTH, origin: "https://agent.example" },
    body: JSON.stringify({ hello: "world" }),
  });
  assert.equal(await posted.text(), "DASH:/api/config");
  assert.equal(
    posted.headers.get("proxy-authenticate"),
    null,
    "hop-by-hop response header must be stripped",
  );
  assert.equal(posted.headers.get("content-type"), "text/plain");

  const got = seen.at(-1);
  assert.equal(got.body, '{"hello":"world"}', "request body must reach upstream intact");
  assert.equal(got.headers["content-type"], "application/json", "end-to-end headers pass through");
  assert.equal(
    got.headers["x-forwarded-host"],
    `127.0.0.1:${PUBLIC}`,
    "forwarded host is filled in when absent",
  );
  assert.equal(
    got.headers.host,
    `127.0.0.1:${DASH}`,
    "Host is rewritten to the loopback upstream, or Hermes rejects it as an invalid Host",
  );
  assert.equal(got.headers.origin, `http://127.0.0.1:${DASH}`, "Origin is rewritten too");
  // Note: `te` is deliberately not asserted. It is a forbidden header for fetch,
  // so undici drops it client-side and the assertion would pass whether or not
  // the proxy strips anything. transfer-encoding is covered by the body assert
  // above: forwarding a chunked header would corrupt the framing and fail it.

  // Upgrade must reach the dashboard and carry bytes back — the reason this
  // cannot be a plain handler bolted onto agent-metrics.py.
  step("UPGRADE /ws");
  const wsBody = await new Promise((res, rej) => {
    const s = connect(PUBLIC, "127.0.0.1", () => {
      s.write(
        "GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n" +
          `Connection: Upgrade\r\nAuthorization: ${AUTH}\r\n\r\n`,
      );
    });
    let buf = "";
    s.on("data", (d) => {
      buf += d;
      if (buf.includes("DASH-ws")) {
        s.destroy();
        res(buf);
      }
    });
    s.on("error", rej);
    setTimeout(() => rej(new Error(`upgrade timeout, got: ${buf}`)), 3000);
  });
  assert.match(wsBody, /101 Switching Protocols/);
  assert.match(wsBody, /DASH-ws/);

  // ── auth ────────────────────────────────────────────────────────────────
  // Everything above proved routing; this proves the door. The dashboard is
  // loopback-bound in the container, so if these fail the console is open to the
  // internet — /api/pty included.
  const unauth = (p, init) => fetch(`http://127.0.0.1:${PUBLIC}${p}`, init);

  step("dashboard without credentials -> 401");
  const bare = await unauth("/");
  assert.equal(bare.status, 401, "an unauthenticated dashboard request must be refused");
  assert.match(
    bare.headers.get("www-authenticate") ?? "",
    /^Basic realm=/,
    "401 must tell the browser to prompt",
  );

  step("wrong password -> 401");
  const badPass = await unauth("/", {
    headers: { authorization: `Basic ${Buffer.from(`${USER}:nope`).toString("base64")}` },
  });
  assert.equal(badPass.status, 401);

  step("wrong username -> 401");
  const badUser = await unauth("/", {
    headers: { authorization: `Basic ${Buffer.from(`nobody:${PASS}`).toString("base64")}` },
  });
  assert.equal(badUser.status, 401);

  step("malformed and non-basic authorization -> 401");
  for (const value of ["", "Basic", "Basic !!!!", "Bearer " + PASS, `Basic ${Buffer.from(USER).toString("base64")}`]) {
    const res = await unauth("/", { headers: value ? { authorization: value } : {} });
    assert.equal(res.status, 401, `authorization ${JSON.stringify(value)} must not pass`);
  }

  step("/health and /metrics stay open to Render and the console");
  // /health is Render's health check: gating it would fail every deploy.
  // /metrics carries its own bearer, checked by the metrics server itself.
  assert.equal((await unauth("/health")).status, 200, "health check must not need a password");
  assert.equal((await unauth("/metrics")).status, 200, "metrics keeps its own bearer");

  step("UPGRADE without credentials -> 401, not a shell");
  const wsDenied = await new Promise((res, rej) => {
    const s2 = connect(PUBLIC, "127.0.0.1", () => {
      s2.write("GET /api/pty HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    });
    let buf = "";
    s2.on("data", (d) => {
      buf += d;
    });
    s2.on("close", () => res(buf));
    s2.on("error", rej);
    setTimeout(() => {
      s2.destroy();
      res(buf);
    }, 2000);
  });
  assert.match(wsDenied, /401 Unauthorized/, "an unauthenticated upgrade must be refused");
  assert.doesNotMatch(wsDenied, /101 Switching Protocols/, "and must not be upgraded");

  // A dead upstream must say WHICH one, so a dashboard outage is not mistaken
  // for the agent being down. Last, because this stub does not come back.
  //
  // close() is deliberately not awaited: the proxy holds a keep-alive socket to
  // this stub, so the close callback waits on it and the check hangs. close()
  // stops accepting immediately, which is all the next request needs.
  step("kill the dashboard upstream");
  dash.closeAllConnections();
  dash.close();
  await nap(200);

  step("GET / with the dashboard down");
  // With credentials: auth is checked BEFORE forwarding, so an anonymous request
  // gets 401 and never learns whether the upstream is even alive. That ordering
  // is deliberate — the named 502 is for the operator, not for the internet.
  const dead = await fetch(`http://127.0.0.1:${PUBLIC}/`, {
    headers: { authorization: AUTH },
  });
  assert.equal(dead.status, 502);
  assert.match(await dead.text(), /dashboard upstream unavailable/);

  step("GET /health still served by metrics");
  assert.equal((await fetch(`http://127.0.0.1:${PUBLIC}/health`)).status, 200);

  console.log("proxy routing OK (paths, query, body, headers, upgrade, named 502, basic auth)");
} finally {
  cleanup();
}

// ── fails closed with no credentials configured ──────────────────────────
// The dashboard does not authenticate itself on a loopback bind, so a proxy with
// no password must refuse to forward rather than publish it. Separate instance
// because this is a property of startup configuration, not of a request.
{
  const PORT2 = PUBLIC + 40;
  const bare = spawn(process.execPath, ["docker/agent/proxy.mjs"], {
    env: {
      ...process.env,
      DECENCHRO_PROXY_PORT: String(PORT2),
      METRICS_INTERNAL_PORT: String(METRICS),
      HERMES_DASHBOARD_PORT: String(DASH),
      HERMES_DASHBOARD_BASIC_AUTH_USERNAME: "",
      HERMES_DASHBOARD_BASIC_AUTH_PASSWORD: "",
    },
    stdio: "inherit",
  });
  try {
    await nap(600);
    step("no credentials configured -> dashboard refused, metrics still up");
    const refused = await fetch(`http://127.0.0.1:${PORT2}/`);
    assert.equal(refused.status, 503, "an unconfigured proxy must not forward to the dashboard");
    assert.match(await refused.text(), /credentials not configured/);
    // Even with a password guessed correctly: nothing is configured to match.
    const guessed = await fetch(`http://127.0.0.1:${PORT2}/`, {
      headers: { authorization: AUTH },
    });
    assert.equal(guessed.status, 503, "credentials cannot be supplied for an unconfigured proxy");
    console.log("proxy fail-closed OK (no credentials -> 503, dashboard never forwarded)");
  } finally {
    bare.kill();
  }
}

// Explicit: a lingering keep-alive socket would otherwise hold the loop open and
// turn a passing check into a hang.
process.exit(0);
