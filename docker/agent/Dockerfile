# syntax=docker/dockerfile:1
#
# Decenchro agent image.
#
# Everything a tenant box used to install at deploy time (a ~10 minute cloud-init
# on a VM: the Hermes installer, NodeSource, `npm install @atbash/sdk`) is baked
# here instead. A deploy is now: pull, start. The VM providers that needed that
# cloud-init were retired on 2026-08-18; this image is the whole deploy.
#
# The base image already ships Node 26 + npm 11, Python 3.13, git, curl, and
# s6-overlay supervision, so this layer only adds Decenchro's own pieces:
#   - the decenchro-guard plugin WITH its node_modules (from the committed lock)
#   - the Chromia skill, pinned at a commit
#   - the metrics endpoint + first-message claim watcher, as s6 services
#   - a cont-init hook that seeds config from environment variables
#
# Nothing tenant-specific is baked. The image is byte-identical for every
# customer and holds no secret, so it can be published publicly.
#
# The image is also SLIMMED here (docker/agent/slim.sh) and then flattened into
# a single layer. Render caches no layers, so it re-pulls everything on every
# create and every restart: the pull is essentially the whole deploy time, and
# bytes are the only lever. Deleting in a child layer does NOT shrink a pull —
# the bytes stay in the parent layer — hence the `FROM scratch` stage, which is
# also why every ENV/ENTRYPOINT/VOLUME the base set has to be re-declared below.
#
# Build from the REPO ROOT: docker build -f docker/agent/Dockerfile .

ARG HERMES_VERSION=v2026.8.31
FROM nousresearch/hermes-agent:${HERMES_VERSION} AS build

# Pinned, not a floating clone: a deploy must never depend on whatever happens
# to be on the skill repo's HEAD that morning.
ARG CHROMIA_SKILL_REPO=https://bitbucket.org/chromawallet/chromia-skill.git
ARG CHROMIA_SKILL_REF=4b639bd7e70f2251e7b240b7cc2a6efeeb62b81f

# Bumped per build (CI passes the image tag). cont-init compares it against a
# stamp on the volume and refreshes the managed payload when it changes — that
# is what makes an image upgrade actually reach an already-claimed agent.
ARG PAYLOAD_VERSION=dev
ENV DECENCHRO_PAYLOAD_VERSION=${PAYLOAD_VERSION}

# The payload lives OUTSIDE $HERMES_HOME on purpose. /opt/data is a declared
# volume, so anything written there at build time is masked the instant a real
# disk is mounted over it. cont-init copies from here into the volume at boot.
ENV DECENCHRO_PAYLOAD=/opt/decenchro

# ── decenchro-guard plugin ────────────────────────────────────────────────
# package.json + lock first so the npm layer caches independently of the
# plugin source. `npm ci` (not install) so every image resolves to the exact
# @atbash/sdk tree the lockfile pins.
COPY agent/plugins/decenchro-guard/package.json \
     agent/plugins/decenchro-guard/package-lock.json \
     ${DECENCHRO_PAYLOAD}/plugins/decenchro-guard/
RUN cd ${DECENCHRO_PAYLOAD}/plugins/decenchro-guard \
 && npm ci --omit=dev --no-audit --no-fund \
 && test -f node_modules/@atbash/sdk/package.json \
 && npm cache clean --force

COPY agent/plugins/decenchro-guard/__init__.py \
     agent/plugins/decenchro-guard/plugin.yaml \
     ${DECENCHRO_PAYLOAD}/plugins/decenchro-guard/
COPY agent/plugins/decenchro-guard/bin/judge.mjs \
     ${DECENCHRO_PAYLOAD}/plugins/decenchro-guard/bin/

# ── bsc-defi CLI ──────────────────────────────────────────────────────────
# Same pattern as the guard: lockfile-pinned `npm ci` in its own cached
# layer, source copied after. It lives OUTSIDE the volume on purpose — the
# symlink puts it on PATH for the terminal tool (and thus under the Atbash
# judge), and an image upgrade refreshes it without touching /opt/data.
# `help` runs offline, so it doubles as a build-time import smoke test.
COPY agent/bsc-defi/package.json \
     agent/bsc-defi/package-lock.json \
     ${DECENCHRO_PAYLOAD}/bsc-defi/
RUN cd ${DECENCHRO_PAYLOAD}/bsc-defi \
 && npm ci --omit=dev --no-audit --no-fund \
 && test -f node_modules/viem/package.json \
 && npm cache clean --force
COPY agent/bsc-defi/bin/ ${DECENCHRO_PAYLOAD}/bsc-defi/bin/
COPY agent/bsc-defi/src/ ${DECENCHRO_PAYLOAD}/bsc-defi/src/
RUN chmod 0755 ${DECENCHRO_PAYLOAD}/bsc-defi/bin/bsc-defi.mjs \
 && ln -s ${DECENCHRO_PAYLOAD}/bsc-defi/bin/bsc-defi.mjs /usr/local/bin/bsc-defi \
 && bsc-defi help >/dev/null

# ── Chromia skill ─────────────────────────────────────────────────────────
RUN git clone --quiet "${CHROMIA_SKILL_REPO}" /tmp/chromia-skill-repo \
 && git -C /tmp/chromia-skill-repo checkout --quiet "${CHROMIA_SKILL_REF}" \
 && mkdir -p ${DECENCHRO_PAYLOAD}/skills \
 && cp -r /tmp/chromia-skill-repo/chromia-skill ${DECENCHRO_PAYLOAD}/skills/chromia-skill \
 && rm -rf /tmp/chromia-skill-repo \
 && test -f ${DECENCHRO_PAYLOAD}/skills/chromia-skill/SKILL.md

# ── BSC DeFi skills ───────────────────────────────────────────────────────
# Four separate skills — Hermes cron jobs attach skills individually, so
# health/rebalance/grid/yield each need their own directory. cont-init copies
# every ${DECENCHRO_PAYLOAD}/skills/* onto the volume at boot.
COPY agent/skills/bsc-health/ ${DECENCHRO_PAYLOAD}/skills/bsc-health/
COPY agent/skills/bsc-rebalance/ ${DECENCHRO_PAYLOAD}/skills/bsc-rebalance/
COPY agent/skills/bsc-grid/ ${DECENCHRO_PAYLOAD}/skills/bsc-grid/
COPY agent/skills/bsc-yield/ ${DECENCHRO_PAYLOAD}/skills/bsc-yield/

# ── Sidecar scripts + config template ─────────────────────────────────────
COPY docker/agent/agent-metrics.py docker/agent/decenchro-claim.py ${DECENCHRO_PAYLOAD}/
COPY docker/agent/config.yaml.tmpl ${DECENCHRO_PAYLOAD}/config.yaml.tmpl
# Single-port front door, used only where the Hermes dashboard is exposed, plus
# the port layout its run script shares with metrics and the readiness beacon.
COPY docker/agent/proxy.mjs ${DECENCHRO_PAYLOAD}/proxy.mjs
COPY docker/agent/ports.sh ${DECENCHRO_PAYLOAD}/ports.sh
COPY docker/agent/dashboard-theme.yaml ${DECENCHRO_PAYLOAD}/dashboard-theme.yaml
COPY docker/agent/skin.yaml ${DECENCHRO_PAYLOAD}/skin.yaml

# ── s6-overlay wiring ─────────────────────────────────────────────────────
# Extension points the base image already uses for its own services, so we
# inherit real supervision (restart-on-crash, ordered startup) instead of
# hand-backgrounding processes. COPY merges into the existing trees; our
# user/contents.d entries sit alongside the base's dashboard + main-hermes.
COPY --chmod=0755 docker/agent/cont-init.d/ /etc/cont-init.d/
COPY docker/agent/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
RUN chmod 0755 /etc/s6-overlay/s6-rc.d/decenchro-*/run \
               /etc/s6-overlay/s6-rc.d/decenchro-*/finish

# ── source patches ────────────────────────────────────────────────────────
# Render drops CAP_KILL, so root s6-supervise cannot signal the uid-10000
# gateway and every console "Restart gateway" was a silent no-op (measured
# 2026-08-27). The patch makes `hermes gateway restart|stop` fall back to a
# same-uid signal. It is anchored on exact upstream text and FAILS THE BUILD
# when a base bump moves it; the import afterwards catches a syntax slip.
COPY docker/agent/patches/capkill.py /tmp/capkill.py
RUN python3 /tmp/capkill.py /opt/hermes/hermes_cli/service_manager.py \
 && /opt/hermes/.venv/bin/python -c 'import hermes_cli.service_manager as m; assert m._decenchro_signal_fallback' \
 && rm -f /tmp/capkill.py

# ── console branding ──────────────────────────────────────────────────────
# Every text string, the wordmark, <title> and favicon are compiled into the SPA;
# colours and fonts come from dashboard-theme.yaml at runtime. Asserted
# replacements: a base bump that renames a key fails here, not on a tenant.
COPY docker/agent/patches/brand.py /tmp/brand.py
COPY app/icon.svg /tmp/decenchro-icon.svg
RUN python3 /tmp/brand.py /opt/hermes/hermes_cli/web_dist /tmp/decenchro-icon.svg /opt/hermes/hermes_cli /opt/hermes/ui-tui/dist/entry.js \
 && cd /opt/hermes && /opt/hermes/.venv/bin/python -c 'import hermes_cli.web_server, hermes_cli.banner, hermes_cli.cli_commands_mixin, hermes_cli._startup_fast, cli' \
 && rm -f /tmp/brand.py /tmp/decenchro-icon.svg

# ── slim ──────────────────────────────────────────────────────────────────
# Last step of the build stage, so it also strips anything the steps above
# dragged in (npm caches, __pycache__). It ends in an import smoke test, so a
# trim that breaks the agent fails the build instead of a tenant's deploy.
COPY --chmod=0755 docker/agent/slim.sh /usr/local/bin/decenchro-slim
RUN /usr/local/bin/decenchro-slim && rm -f /usr/local/bin/decenchro-slim


# ── flatten ───────────────────────────────────────────────────────────────
# One layer, so the deletions above actually leave the image. `scratch` keeps
# no metadata from the parent, so everything the base image's Config carried is
# re-declared here verbatim (verify with scripts/check-image-config.mjs, which
# diffs this against the base and fails if a base bump adds a key we drop).
FROM scratch
COPY --from=build / /

ARG PAYLOAD_VERSION=dev

# Inherited from the base image's Config (docker inspect nousresearch/hermes-agent).
ENV PATH=/opt/hermes/bin:/opt/hermes/.venv/bin:/opt/data/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright \
    npm_config_install_links=false \
    HERMES_WEB_DIST=/opt/hermes/hermes_cli/web_dist \
    HERMES_TUI_DIR=/opt/hermes/ui-tui \
    HERMES_HOME=/opt/data \
    HERMES_WRITE_SAFE_ROOT=/opt/data \
    HERMES_DISABLE_LAZY_INSTALLS=1 \
    HERMES_LAZY_INSTALL_TARGET=/opt/data/lazy-packages

# Ours. The payload version is the stamp cont-init compares against the copy on
# the volume, so it has to survive the flatten or an image upgrade silently
# stops refreshing an already-claimed agent's plugin.
ENV DECENCHRO_PAYLOAD=/opt/decenchro \
    DECENCHRO_PAYLOAD_VERSION=${PAYLOAD_VERSION}

# Root at boot so the base's stage2 hook can usermod/chown the data volume;
# each s6 service drops to the hermes user itself.
USER root
WORKDIR /opt/hermes
VOLUME /opt/data

# Unauthenticated liveness route on the metrics server (the /metrics route
# itself is Bearer-gated). Doubles as Render's healthCheckPath. The port comes
# from ports.sh rather than being re-derived here, because the answer changes
# when the dashboard moves metrics behind the proxy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD . /opt/decenchro/ports.sh \
   && curl -fsS "http://127.0.0.1:${DECENCHRO_FRONT_PORT}/health" >/dev/null || exit 1

# Both re-declared: `scratch` inherits neither. The base's main-wrapper turns
# this CMD into `hermes gateway run`, dropped to the hermes user.
ENTRYPOINT ["/opt/hermes/docker/entrypoint-dispatch.sh"]
CMD ["gateway", "run"]
