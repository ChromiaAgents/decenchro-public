#!/usr/bin/env bash
# dev-local.sh — bring up the local stack (Chromia node + Next.js) with one
# command, track each process's PID, and ping Telegram when they're ready.
#
#   ./dev-local.sh start     # launch both, wait for readiness, notify Telegram
#   ./dev-local.sh stop      # kill the tracked processes (leaves the shared Postgres)
#   ./dev-local.sh restart
#   ./dev-local.sh status
#
# PIDs and logs live under .dev-local/ (git-ignored). Re-running start is
# idempotent: anything already listening on its port is left alone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$ROOT/.dev-local"
mkdir -p "$RUN_DIR"

NEXT_PORT="${NEXT_PORT:-3000}"
CHAIN_PORT="${CHAIN_PORT:-7740}"

# Telegram notify (optional). Token comes from the Claude Telegram channel
# config; chat id defaults to the owner allowlisted there. Override via env.
TG_ENV="${TELEGRAM_ENV:-$HOME/.claude/channels/telegram/.env}"
TG_CHAT_ID="${TELEGRAM_CHAT_ID:-5157721111}"

notify() {
  local msg="$1"
  [ -f "$TG_ENV" ] || return 0
  local token
  token="$(grep -E '^TELEGRAM_BOT_TOKEN=' "$TG_ENV" | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$token" ] || return 0
  curl -s -o /dev/null --max-time 10 \
    --data-urlencode "chat_id=$TG_CHAT_ID" \
    --data-urlencode "text=$msg" \
    "https://api.telegram.org/bot${token}/sendMessage" || true
}

is_up() { [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$1" 2>/dev/null)" =~ ^[23] ]]; }

# Recursively kill a process and its descendants (children first).
kill_tree() {
  local pid="$1"
  local c
  for c in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$c"; done
  kill "$pid" 2>/dev/null || true
}

spawn() { # name, healthcheck_url, working_dir, command...
  local name="$1" url="$2" dir="$3"; shift 3
  if is_up "$url"; then
    echo "$name: already up"
    return 0
  fi
  ( cd "$dir" && exec "$@" ) > "$RUN_DIR/$name.log" 2>&1 &
  echo $! > "$RUN_DIR/$name.pid"
  echo "$name: starting (pid $(cat "$RUN_DIR/$name.pid"), log .dev-local/$name.log)"
}

wait_up() { # name, url, timeout_s
  local name="$1" url="$2" timeout="$3" i
  printf 'waiting for %s' "$name"
  for ((i=0; i<timeout; i++)); do
    is_up "$url" && { printf ' ok\n'; return 0; }
    printf '.'; sleep 1
  done
  printf ' timeout\n'; return 1
}

start() {
  spawn chain "http://localhost:$CHAIN_PORT/version" "$ROOT/chain" chr node start
  spawn web   "http://localhost:$NEXT_PORT"          "$ROOT"       npm run dev

  wait_up chain "http://localhost:$CHAIN_PORT/version" 90 || true
  wait_up web   "http://localhost:$NEXT_PORT"          60 || true

  echo "---"
  status
  local chain_mark web_mark
  is_up "http://localhost:$CHAIN_PORT/version" && chain_mark="✅" || chain_mark="❌"
  is_up "http://localhost:$NEXT_PORT"          && web_mark="✅"   || web_mark="❌"
  notify "decenchro local stack up — web ${web_mark} http://localhost:${NEXT_PORT} · chain ${chain_mark} http://localhost:${CHAIN_PORT}"
}

stop() {
  local svc pf pid
  for svc in web chain; do
    pf="$RUN_DIR/$svc.pid"
    [ -f "$pf" ] || continue
    pid="$(cat "$pf")"
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid"
      echo "$svc: stopped (pid $pid)"
    else
      echo "$svc: not running"
    fi
    rm -f "$pf"
  done
  notify "decenchro local stack stopped"
}

status() {
  is_up "http://localhost:$CHAIN_PORT/version" && echo "chain: UP   http://localhost:$CHAIN_PORT" || echo "chain: DOWN"
  is_up "http://localhost:$NEXT_PORT"          && echo "web:   UP   http://localhost:$NEXT_PORT"  || echo "web:   DOWN"
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; start ;;
  status)  status ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 1 ;;
esac
