#!/bin/sh
# Strip the base image down to what a Decenchro agent actually runs.
#
# Why this exists: Render caches nothing, so it re-pulls the whole image on
# every service create AND every restart. The pull is ~all of the deploy time,
# so bytes are the only lever left. The stock base is 2.7 GB unpacked / 969 MB
# compressed, and most of that is capability this fleet never uses: a Chromium
# shell + its X11/font/mesa/LLVM stack, the toolchain that compiled the wheels,
# ffmpeg, the iMessage sidecar, and the root node_modules that BUILT the web and
# TUI bundles (both are shipped prebuilt, so the build tree is dead weight).
#
# IMPORTANT: this only pays off behind a flatten. Deleting in a child layer
# leaves the bytes in the parent layer and the pull is unchanged — see the
# `FROM scratch` stage in Dockerfile.
#
# Every deletion here is either (a) unreachable given our config.yaml.tmpl, or
# (b) degrades gracefully. The one behaviour change is ffmpeg: inbound Telegram
# voice notes answer "ffmpeg was not found" instead of transcribing
# (tools/transcription_tools.py returns that as an error string, it does not
# raise), and outgoing voice duration falls back to Telegram's own metadata.
set -eu

log() { echo "[slim] $*"; }
mb() { du -sm "$1" 2>/dev/null | cut -f1; }

BEFORE=$(du -sm / 2>/dev/null | cut -f1 || echo 0)

# ── apt ───────────────────────────────────────────────────────────────────
# Only leaves are named; the heavy transitive libs (libavcodec…, libllvm19,
# mesa-libgallium, gcc-14/cpp-14/libstdc++-14-dev, libpython3.13-dev) are
# marked auto by the base build and get swept by autoremove below. Purging
# them by name instead would break the moment the base bumps Debian.
#
# Kept on purpose: git + ripgrep (search_files / terminal tool), curl (the
# readiness beacon and the deploy webhook), procps (s6), python3 + libpython
# (the venv symlinks /usr/bin/python3 — see .venv/pyvenv.cfg), libolm3 runtime,
# xz-utils, ca-certificates.
apt-get purge -y \
  gcc g++ cmake make python3-dev libffi-dev libolm-dev \
  docker-cli openssh-client xvfb ffmpeg \
  fonts-unifont fonts-wqy-zenhei fonts-freefont-ttf fonts-ipafont-gothic \
  fonts-noto-color-emoji fonts-liberation fonts-tlwg-loma-otf xfonts-scalable \
  libnss3 libnspr4 libgbm1 libcups2t64 libasound2t64 \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
  libxkbcommon0 libxrandr2 libxdamage1 libxfixes3 libxcomposite1 \
  >/dev/null
apt-get autoremove -y --purge >/dev/null
apt-get clean
rm -rf /var/lib/apt/lists/* /var/cache/apt/* /var/log/* /usr/share/doc /usr/share/man
log "apt done"

# ── Chromium shell ────────────────────────────────────────────────────────
# The browser tool is off in config.yaml.tmpl. dep_ensure.py probes for
# node_modules/.bin/agent-browser and reports it missing rather than failing.
log "playwright: $(mb /opt/hermes/.playwright) MB"
rm -rf /opt/hermes/.playwright

# ── root node_modules ─────────────────────────────────────────────────────
# Build-only: web/ ships as hermes_cli/web_dist and ui-tui/ as
# ui-tui/dist/entry.js (a 3.6 MB bundle whose only requires are node builtins,
# verified with grep). HERMES_TUI_DIR makes the launcher take the prebuilt path
# before it ever reaches _tui_need_npm_install(), and gateway.py only uses
# node_modules/.bin as a PATH entry, which tolerates being absent.
# ui-tui/node_modules (semver + undici, ~2 MB) STAYS: entry.js is bundled but
# the launcher's workspace check reads it.
log "root node_modules: $(mb /opt/hermes/node_modules) MB"
rm -rf /opt/hermes/node_modules /opt/hermes/web/node_modules /opt/hermes/web/src

# ── Photon iMessage sidecar ───────────────────────────────────────────────
# macOS-only platform, 129 MB of node_modules for a bridge that cannot run in
# a Linux container at all.
log "photon sidecar: $(mb /opt/hermes/plugins/platforms/photon) MB"
rm -rf /opt/hermes/plugins/platforms/photon/sidecar/node_modules

# ── venv extras ───────────────────────────────────────────────────────────
# Baked by the base's `uv sync --extra all --extra bedrock --extra
# azure-identity --extra hindsight --extra matrix`. Hermes imports a platform
# adapter only when it is enabled in config.yaml (ours enables telegram), and a
# provider only when a model names it (ours is openrouter + a gemini fallback,
# both over the OpenAI-compatible client). google-api-python-client alone is
# 95 MB of generated Discovery stubs for Meet/Drive.
#
# uv pip uninstall, not pip: pip is not installed in the sealed venv.
# `|| true` per group so a base bump that drops one of these does not fail the
# whole build; the import smoke test below is what actually gates the result.
VENV=/opt/hermes/.venv
uninstall() { uv pip uninstall --python "$VENV/bin/python" "$@" >/dev/null 2>&1 || true; }
uninstall google-api-python-client google-auth-httplib2 google-auth-oauthlib googleapis-common-protos
uninstall boto3 botocore s3transfer azure-identity azure-core msal
uninstall mautrix python-olm hindsight-client nemo-relay
uninstall discord.py slack-sdk slack-bolt
find "$VENV" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
log "venv: $(mb $VENV) MB"

# ── generic sweep ─────────────────────────────────────────────────────────
find /opt/hermes -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
rm -rf /root/.npm /root/.cache /tmp/* 2>/dev/null || true

# ── smoke test ────────────────────────────────────────────────────────────
# The trim is only safe if the agent still boots, so fail the BUILD here rather
# than discovering it on a tenant's deploy. Covers: the CLI entrypoint, the one
# platform adapter we ship, the guard's runtime (node), and the DeFi CLI.
#
# HERMES_HOME is redirected: importing hermes_cli.main SEEDS the home directory
# (logs/, cron/, hooks/, SOUL.md), and doing that here as root is what broke the
# first flattened build — see the pristine-volume block below.
SMOKE_HOME=/tmp/decenchro-smoke
mkdir -p "$SMOKE_HOME"
export HERMES_HOME="$SMOKE_HOME"
log "smoke: hermes cli"
"$VENV/bin/python" -c 'import hermes_cli.main'
log "smoke: telegram adapter"
cd /opt/hermes && "$VENV/bin/python" -c 'import plugins.platforms.telegram.adapter'
log "smoke: pillow + sqlite + yaml"
"$VENV/bin/python" -c 'import PIL.Image, sqlite3, yaml; sqlite3.connect(":memory:").execute("select 1")'
log "smoke: node + tui bundle parses"
node --check /opt/hermes/ui-tui/dist/entry.js
log "smoke: web_dist present"
test -f /opt/hermes/hermes_cli/web_dist/index.html
rm -rf "$SMOKE_HOME"
unset HERMES_HOME

# ── restore the data volume to pristine ───────────────────────────────────
# BuildKit does NOT discard writes under a VOLUME path the way the legacy
# builder did, so anything a build step leaves in $HERMES_HOME ships inside the
# image — owned by root, because builds run as root. That is fatal, not untidy:
# the base's stage2-hook only chowns the subdirs when the TOP-LEVEL dir is not
# already hermes-owned (`needs_chown` in docker/stage2-hook.sh), and /opt/data
# is, so a root-owned logs/ survives boot and every gateway write then fails
# with EACCES while /health still reports the agent fine.
#
# Keep only the useradd skeleton the base image ships; cont-init recreates
# everything else on the real volume at boot.
find /opt/data -mindepth 1 -maxdepth 1 \
     ! -name .bashrc ! -name .bash_logout ! -name .profile \
     -exec rm -rf {} +
chown -R 10000:10000 /opt/data
# The assertion that would have caught the bug. Cheap, so it stays.
leftover=$(find /opt/data -mindepth 1 ! -user 10000 -print -quit)
if [ -n "$leftover" ]; then
  echo "[slim] FATAL: non-hermes owner under /opt/data: $leftover" >&2
  exit 1
fi
log "data volume pristine"

AFTER=$(du -sm / 2>/dev/null | cut -f1 || echo 0)
log "unpacked ${BEFORE} MB -> ${AFTER} MB"
