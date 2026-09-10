// Front door for the single public port.
//
// Render routes exactly one port per web service (confirmed: openPorts is
// [{"port":10000}]), but we need two things reachable: the metrics endpoint the
// console polls, and the Hermes dashboard. So when the dashboard is enabled the
// metrics server moves to an internal port, this proxy takes the public one, and
// two exact paths are carved back out for metrics:
//
//     /health, /metrics  ->  agent-metrics.py   (internal, default 9485)
//     everything else    ->  hermes dashboard   (internal, default 9119)
//
// Node stdlib only — no dependency is added to the image for ~60 lines. The
// dashboard is a SPA that upgrades to websockets (see hermes_cli/dashboard_auth/
// ws_tickets.py), which is why the metrics server's Python http.server could not
// simply grow a proxy handler: `upgrade` needs raw socket piping.
//
// This proxy performs NO authentication. The dashboard binds a non-loopback
// address so its own auth gate engages (basic-auth plugin, per-deployment
// credentials), and /metrics keeps its own bearer check. Do not "simplify" by
// The dashboard is now deliberately loopback-bound (so Render detects exactly
// one listening port) and this proxy enforces its basic auth instead — see the
// block below. Do not remove that check: on loopback the dashboard's own gate
// does not engage, so the check here is the only thing in front of /api/pty.

import { timingSafeEqual } from "node:crypto";
import { createServer, request as forward } from "node:http";
import { connect } from "node:net";

const PUBLIC_PORT = Number(process.env.DECENCHRO_PROXY_PORT || process.env.PORT || 9484);
const METRICS_PORT = Number(process.env.METRICS_INTERNAL_PORT || 9485);
const DASHBOARD_PORT = Number(process.env.HERMES_DASHBOARD_PORT || 9119);

// Exact matches only. A prefix test would hand the dashboard's own /health (if
// it ever grows one) to the metrics server and break Render's health check.
const METRICS_ROUTES = new Set(["/health", "/metrics"]);

// ── Basic auth for everything that reaches the dashboard ──────────────────
// The dashboard binds to loopback now, because Render watches the container for
// listening sockets and ADDS every one it finds to the set of ports it routes.
// Observed in a tenant's logs:
//
//   [decenchro-proxy] :10000 -> metrics :9485, dashboard :9119
//   ==> Available at your primary URL https://…
//   ==> Detected new open ports HTTP:9119, HTTP:9485
//
// After that line, requests were sprayed across all three: /health landed on the
// dashboard and 404'd, dashboard assets landed on the metrics server and 404'd,
// and the Hermes console was blank with the agent reporting healthy. `openPorts`
// is read-only through Render's API (a PATCH returns 200 and changes nothing),
// so the only way to be routed to one port is to LISTEN on one port.
//
// Loopback moves the auth problem here. Hermes' own gate engages only on a
// non-loopback bind, so a loopback dashboard does not authenticate — and this
// proxy publishes it. So the credentials are checked at the single public door
// instead, against the same per-deployment values the console derives
// (dashboardPassword() in lib/dashboard/agent-dashboard.ts).
const AUTH_USER = process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME || "";
const AUTH_PASS = process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD || "";
const AUTH_CONFIGURED = AUTH_USER.length > 0 && AUTH_PASS.length > 0;

// Constant-time, and length-safe: timingSafeEqual throws on a length mismatch,
// which would itself leak length through a 500. Compare digests of equal size
// by padding through Buffer.from of the same expected length instead.
function sameSecret(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(req) {
  const header = req.headers.authorization || "";
  if (!header.toLowerCase().startsWith("basic ")) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  // Two separate comparisons so a wrong username is as slow as a wrong password.
  const userOk = sameSecret(decoded.slice(0, split), AUTH_USER);
  const passOk = sameSecret(decoded.slice(split + 1), AUTH_PASS);
  return userOk && passOk;
}

/** True when this request must present dashboard credentials. */
function needsAuth(url) {
  // /health stays open on purpose: it is Render's health check, and gating it
  // would fail every deploy. /metrics carries its own per-deployment bearer,
  // checked by the metrics server itself.
  return upstreamPort(url) !== METRICS_PORT;
}

/**
 * Refuse the dashboard when no credentials are configured.
 *
 * Fails CLOSED deliberately, mirroring the upstream gate this replaces: with the
 * dashboard on loopback and no password set, forwarding would publish a shell
 * (/api/pty) to the internet. A 503 is the safe answer, and metrics keeps
 * working so the agent stays healthy and billable.
 */
function denyUnconfigured(res) {
  res.writeHead(503, { "content-type": "text/plain" });
  res.end("dashboard credentials not configured\n");
}

function demandAuth(res) {
  res.writeHead(401, {
    "content-type": "text/plain",
    // Realm without the deployment id in it: this string is public.
    "www-authenticate": 'Basic realm="Decenchro agent", charset="UTF-8"',
  });
  res.end("authentication required\n");
}

function upstreamPort(url) {
  const path = (url || "/").split("?")[0];
  return METRICS_ROUTES.has(path) ? METRICS_PORT : DASHBOARD_PORT;
}

// Hop-by-hop headers (RFC 9110 s7.6.1) describe THIS connection, so forwarding
// them describes the wrong one. Transfer-Encoding is the one that actually
// bites: pass a client's `chunked` through and it contradicts what Node decides
// to send, and the same header echoed back from upstream fights the response
// Node is framing. Dropping them lets each hop frame its own message.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Loopback-bound upstreams accept only loopback Host/Origin (see the request
// handler). Origin is rewritten only when present: a missing Origin is a
// non-browser client and Hermes treats it as allowed.
function loopbackHost(headers, port) {
  const out = { ...headers, host: `127.0.0.1:${port}` };
  if (out.origin) out.origin = `http://127.0.0.1:${port}`;
  return out;
}

function endToEnd(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

const server = createServer((req, res) => {
  const port = upstreamPort(req.url);
  if (needsAuth(req.url)) {
    if (!AUTH_CONFIGURED) return denyUnconfigured(res);
    if (!authorized(req)) return demandAuth(res);
  }
  const upstream = forward(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      // Host/Origin are rewritten to the loopback upstream: the dashboard binds
      // 127.0.0.1 and refuses any other Host ("Invalid Host header", its DNS-
      // rebinding guard), and its websocket handshake applies the same test to
      // Origin. The real public hostname travels in X-Forwarded-Host. Render
      // sets X-Forwarded-* ahead of us; only fill them in if missing.
      headers: {
        ...loopbackHost(endToEnd(req.headers), port),
        "x-forwarded-proto": req.headers["x-forwarded-proto"] ?? "http",
        "x-forwarded-host": req.headers["x-forwarded-host"] ?? req.headers.host ?? "",
      },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, endToEnd(up.headers));
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    // Upstream not up yet (or crashed). 502 rather than a hang, so Render's
    // health check fails fast and retries instead of timing out. Name the side
    // that's down: a dead dashboard and a dead metrics server look identical
    // from the outside otherwise, and only one of them is worth paging about.
    const which = port === METRICS_PORT ? "metrics" : "dashboard";
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`${which} upstream unavailable\n`);
  });
  req.pipe(upstream);
});

// Websocket / any other Upgrade: replay the request line and headers onto a raw
// socket, then pipe both directions. `head` carries bytes the parser already
// read past the headers, so it must go out before piping or the first frame is
// lost.
server.on("upgrade", (req, socket, head) => {
  // Gated too, and this is the one that matters most: /api/pty is a terminal, and
  // an Upgrade never passes through the request handler above, so checking only
  // there would leave a shell open to anyone.
  if (needsAuth(req.url) && !(AUTH_CONFIGURED && authorized(req))) {
    socket.write(
      "HTTP/1.1 401 Unauthorized\r\n" +
        'www-authenticate: Basic realm="Decenchro agent", charset="UTF-8"\r\n' +
        "connection: close\r\n\r\n",
    );
    socket.destroy();
    return;
  }
  const up = connect(upstreamPort(req.url), "127.0.0.1", () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    const headers = loopbackHost(
      { ...req.headers, "x-forwarded-host": req.headers["x-forwarded-host"] ?? req.headers.host ?? "" },
      upstreamPort(req.url),
    );
    for (const [k, v] of Object.entries(headers)) {
      for (const one of Array.isArray(v) ? v : [v]) raw += `${k}: ${one}\r\n`;
    }
    up.write(`${raw}\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(
    `[decenchro-proxy] :${PUBLIC_PORT} -> metrics :${METRICS_PORT} (/health,/metrics), ` +
      `dashboard :${DASHBOARD_PORT} (basic auth ${AUTH_CONFIGURED ? "on" : "NOT CONFIGURED — dashboard refused"})`,
  );
});
