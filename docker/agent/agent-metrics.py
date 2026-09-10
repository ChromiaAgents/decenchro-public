#!/usr/bin/env python3
"""decenchro agent metrics — a tiny authenticated HTTP endpoint that reports the
live Hermes agent's activity from its local state, so the (remote) console can
show real usage without SSHing in.

Reads, never writes:
  - $HERMES_HOME/state.db          sessions + messages (sqlite, opened read-only)
  - $HERMES_HOME/gateway_state.json  gateway + platform status

Auth: every request must send `Authorization: Bearer $METRICS_TOKEN`. The token
is derived by the console from ENCRYPTION_KEY + deployment id, so it is stable
and never stored on the box beyond this process's environment.

Env: METRICS_TOKEN (required), METRICS_PORT (default 9484),
     HERMES_HOME (default /home/hermes/.hermes).
Stdlib only — no pip installs on the box.
"""
import hmac
import json
import os
import sqlite3
import subprocess
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERMES_HOME = os.environ.get("HERMES_HOME", "/home/hermes/.hermes")
DB_PATH = os.path.join(HERMES_HOME, "state.db")
GATEWAY_STATE = os.path.join(HERMES_HOME, "gateway_state.json")
# Written by decenchro-claim.py once an owner has been paired. Its presence is
# the whole signal: an agent nobody has claimed answers nobody, and the console
# had no way to tell that apart from an agent nobody had used.
CLAIM_SENTINEL = os.path.join(HERMES_HOME, ".decenchro-claimed")
TOKEN = os.environ.get("METRICS_TOKEN", "")
PORT = int(os.environ.get("METRICS_PORT", "9484"))


def _hermes_version():
    # Read once at startup — the installed version doesn't change while running.
    # Prefer the hermes user's local install; fall back to PATH.
    for exe in (os.path.expanduser("~hermes/.local/bin/hermes"), "hermes"):
        try:
            r = subprocess.run([exe, "version"], capture_output=True, text=True, timeout=5)
            v = (r.stdout or r.stderr).strip()
            if v:
                return v.splitlines()[0][:64]
        except (OSError, subprocess.SubprocessError):
            continue
    return None


HERMES_VERSION = _hermes_version()


def _db():
    # Read-only, so a live agent writing to the same db is never blocked. busy
    # timeout keeps a concurrent checkpoint from erroring the read.
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=3)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA query_only = 1")
    return con


def _one(con, sql, params=()):
    try:
        row = con.execute(sql, params).fetchone()
        return row[0] if row and row[0] is not None else 0
    except sqlite3.Error:
        return 0


def _month_start():
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()


def collect():
    now = time.time()
    day_ago = now - 86400
    month_start = _month_start()
    out = {
        "ok": True,
        "collected_at": now,
        "totals": {},
        "last24h": {},
        "tokens": {},
        "spend_month": 0.0,
        "by_source": [],
        "by_model": [],
        "daily": [],
        "sessions": [],
        "recent": [],
        "hermes_version": HERMES_VERSION,
        "gateway": {},
        "claimed": os.path.exists(CLAIM_SENTINEL),
    }

    if os.path.exists(DB_PATH):
        try:
            con = _db()
            out["totals"] = {
                "sessions": _one(con, "SELECT COUNT(*) FROM sessions"),
                "active_sessions": _one(
                    con, "SELECT COUNT(*) FROM sessions WHERE ended_at IS NULL"
                ),
                "messages": _one(con, "SELECT COUNT(*) FROM messages"),
                "tool_calls": _one(con, "SELECT COALESCE(SUM(tool_call_count),0) FROM sessions"),
                "last_active": _one(con, "SELECT MAX(timestamp) FROM messages"),
            }
            out["last24h"] = {
                "messages": _one(
                    con, "SELECT COUNT(*) FROM messages WHERE timestamp >= ?", (day_ago,)
                ),
                "tool_calls": _one(
                    con,
                    "SELECT COUNT(*) FROM messages WHERE timestamp >= ? "
                    "AND tool_name IS NOT NULL AND tool_name != ''",
                    (day_ago,),
                ),
                "sessions": _one(
                    con, "SELECT COUNT(*) FROM sessions WHERE started_at >= ?", (day_ago,)
                ),
            }
            cost_expr = "COALESCE(actual_cost_usd, estimated_cost_usd, 0)"
            out["tokens"] = {
                "input": _one(con, "SELECT COALESCE(SUM(input_tokens),0) FROM sessions"),
                "output": _one(con, "SELECT COALESCE(SUM(output_tokens),0) FROM sessions"),
                "cache_read": _one(con, "SELECT COALESCE(SUM(cache_read_tokens),0) FROM sessions"),
                "cache_write": _one(con, "SELECT COALESCE(SUM(cache_write_tokens),0) FROM sessions"),
                "cost_usd": round(
                    float(_one(con, f"SELECT COALESCE(SUM({cost_expr}),0) FROM sessions")), 4
                ),
            }
            # Spend since the start of the current UTC month — what a monthly
            # budget is measured against.
            out["spend_month"] = round(
                float(
                    _one(
                        con,
                        f"SELECT COALESCE(SUM({cost_expr}),0) FROM sessions WHERE started_at >= ?",
                        (month_start,),
                    )
                ),
                4,
            )
            try:
                out["by_source"] = [
                    {"source": r["source"], "sessions": r["n"], "messages": r["m"]}
                    for r in con.execute(
                        "SELECT source, COUNT(*) n, COALESCE(SUM(message_count),0) m "
                        "FROM sessions GROUP BY source ORDER BY n DESC"
                    )
                ]
                out["by_model"] = [
                    {"model": r["model"], "sessions": r["n"]}
                    for r in con.execute(
                        "SELECT model, COUNT(*) n FROM sessions "
                        "WHERE model IS NOT NULL GROUP BY model ORDER BY n DESC LIMIT 8"
                    )
                ]
                # 14-day series for the sparkline: messages + cost per UTC day.
                since = now - 14 * 86400
                msgs_by_day = {
                    r["d"]: r["n"]
                    for r in con.execute(
                        "SELECT strftime('%Y-%m-%d', timestamp, 'unixepoch') d, "
                        "COUNT(*) n FROM messages WHERE timestamp >= ? GROUP BY d",
                        (since,),
                    )
                }
                cost_by_day = {
                    r["d"]: round(float(r["c"]), 4)
                    for r in con.execute(
                        f"SELECT strftime('%Y-%m-%d', started_at, 'unixepoch') d, "
                        f"SUM({cost_expr}) c FROM sessions WHERE started_at >= ? GROUP BY d",
                        (since,),
                    )
                }
                out["daily"] = [
                    {"date": d, "messages": msgs_by_day.get(d, 0), "cost": cost_by_day.get(d, 0.0)}
                    for d in sorted(set(msgs_by_day) | set(cost_by_day))
                ]
                # Recent sessions — metadata only (no transcript content).
                out["sessions"] = [
                    {
                        "source": r["source"],
                        "model": r["model"],
                        "messages": r["message_count"],
                        "tool_calls": r["tool_call_count"],
                        "cost": round(float(r["cost"] or 0), 4),
                        "started_at": r["started_at"],
                        "title": r["title"],
                    }
                    for r in con.execute(
                        f"SELECT source, model, message_count, tool_call_count, "
                        f"{cost_expr} cost, started_at, title FROM sessions "
                        "ORDER BY started_at DESC LIMIT 10"
                    )
                ]
                # Recent activity — no message content, only shape (role, tool,
                # when, which session) so this never leaks conversation text.
                out["recent"] = [
                    {
                        "ts": r["timestamp"],
                        "role": r["role"],
                        "tool": r["tool_name"],
                        "source": r["source"],
                    }
                    for r in con.execute(
                        "SELECT m.timestamp, m.role, m.tool_name, s.source "
                        "FROM messages m JOIN sessions s ON m.session_id = s.id "
                        "ORDER BY m.timestamp DESC LIMIT 25"
                    )
                ]
            except sqlite3.Error:
                pass
            con.close()
        except sqlite3.Error as e:
            out["ok"] = False
            out["error"] = f"db: {e.__class__.__name__}"

    # Gateway status — expose only safe fields. gateway_state.json embeds the
    # Telegram token inside platform error_message, so never pass that through.
    try:
        with open(GATEWAY_STATE) as f:
            gs = json.load(f)
        plats = {}
        for name, p in (gs.get("platforms") or {}).items():
            plats[name] = {
                "state": p.get("state"),
                "error_code": p.get("error_code"),  # code only, not message
            }
        out["gateway"] = {
            "state": gs.get("gateway_state"),
            "active_agents": gs.get("active_agents"),
            "restart_requested": gs.get("restart_requested"),
            "updated_at": gs.get("updated_at"),
            "platforms": plats,
        }
    except (OSError, ValueError):
        pass

    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _authed(self):
        if not TOKEN:
            return False
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not header.startswith(prefix):
            return False
        return hmac.compare_digest(header[len(prefix):], TOKEN)

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            self._send(200, {"ok": True})
            return
        if self.path.split("?")[0] != "/metrics":
            self._send(404, {"error": "not found"})
            return
        if not self._authed():
            self._send(401, {"error": "unauthorized"})
            return
        try:
            self._send(200, collect())
        except Exception:  # never leak a stack trace to the caller
            self._send(500, {"ok": False, "error": "collect failed"})

    def log_message(self, *args):  # silence default stderr access logging
        pass


def main():
    if not TOKEN:
        raise SystemExit("METRICS_TOKEN not set — refusing to start unauthenticated")
    # 0.0.0.0 only when this server is the public one. Behind the proxy it is
    # loopback, so Render cannot detect the port and start routing traffic
    # straight to it — see docker/agent/ports.sh for why that matters.
    host = os.environ.get("DECENCHRO_METRICS_HOST", "0.0.0.0")
    ThreadingHTTPServer((host, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
