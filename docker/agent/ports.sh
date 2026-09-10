# Port layout for the agent container. Sourced (not executed) by
# decenchro-{proxy,metrics,ready}/run and by the Dockerfile HEALTHCHECK.
#
# One file because three consumers have to agree on where metrics listens, and
# they previously each re-derived it from ${METRICS_PORT:-${PORT:-9484}}. That
# expression is wrong as soon as the dashboard is enabled — metrics moves to an
# internal port — so a copy that didn't get the memo polls a closed port and the
# readiness beacon reports a healthy agent as failed.
#
# POSIX sh only: these run under `with-contenv sh`, not bash.

decenchro_dashboard_on() {
    case "${HERMES_DASHBOARD:-}" in
        1|true|TRUE|True|yes|YES|Yes) return 0 ;;
        *) return 1 ;;
    esac
}

# What the outside world reaches. Render injects PORT; a VM publishes 9484.
DECENCHRO_PUBLIC_PORT="${PORT:-9484}"

if decenchro_dashboard_on; then
    # decenchro-proxy owns the public port and forwards /health + /metrics here.
    DECENCHRO_METRICS_PORT="${METRICS_INTERNAL_PORT:-9485}"
    # An operator-supplied METRICS_INTERNAL_PORT equal to the public port would
    # have the proxy and the metrics server race for the same address: whichever
    # loses crash-loops, and the loss is either metrics (health 502s) or the
    # dashboard (never exposed). Step off it rather than fail the boot.
    if [ "$DECENCHRO_METRICS_PORT" = "$DECENCHRO_PUBLIC_PORT" ]; then
        DECENCHRO_METRICS_PORT=$((DECENCHRO_PUBLIC_PORT + 1))
        echo "[decenchro] METRICS_INTERNAL_PORT collided with the public port;" \
             "using ${DECENCHRO_METRICS_PORT}" >&2
    fi
else
    # No proxy: agent-metrics.py binds the public port directly, and an explicit
    # METRICS_PORT still wins, exactly as before the dashboard existed.
    DECENCHRO_METRICS_PORT="${METRICS_PORT:-$DECENCHRO_PUBLIC_PORT}"
fi

# Where a *local* liveness probe should look. With the proxy up that is the front
# door (which also proves the proxy itself is routing); without it, metrics is the
# front door. Used by the readiness beacon and the Docker HEALTHCHECK.
if decenchro_dashboard_on; then
    DECENCHRO_FRONT_PORT="$DECENCHRO_PUBLIC_PORT"
else
    DECENCHRO_FRONT_PORT="$DECENCHRO_METRICS_PORT"
fi

# Where the metrics server binds. Render watches the container for listening
# sockets and ADDS each one to the set of ports it routes ("Detected new open
# ports HTTP:9119, HTTP:9485" in a tenant's log), after which requests are
# sprayed across all of them: the health check lands on the dashboard and 404s,
# dashboard assets land on metrics and 404. openPorts is read-only through the
# API, so the only way to be routed one port is to listen on one port.
#
# Behind the proxy, metrics is reached at 127.0.0.1 and has no reason to be
# externally bound. With the dashboard off, metrics IS the public server and must
# stay on 0.0.0.0.
if decenchro_dashboard_on; then
    DECENCHRO_METRICS_HOST="127.0.0.1"
else
    DECENCHRO_METRICS_HOST="0.0.0.0"
fi
