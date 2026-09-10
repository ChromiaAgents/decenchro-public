#!/usr/bin/env bash
# Build the public mirror: one squashed commit of REF with internal-only files
# stripped, force-pushed to DEST. Creates DEST as PRIVATE on first run; making
# it public is a separate, deliberate step (the command is printed at the end).
#
#   scripts/build-public-mirror.sh [REF=HEAD] [DEST=ChromiaAgents/decenchro-public]
set -euo pipefail

REF=${1:-HEAD}
DEST=${2:-ChromiaAgents/decenchro-public}
SRC_DIR=$(git rev-parse --show-toplevel)
SRC_SHA=$(git -C "$SRC_DIR" rev-parse --short "$REF")

# Internal-only: agent instructions, decision logs, marketing drafts, mail DNS.
# .github too: these are this repo's ops workflows, and on the mirror they are
# all either broken or harmful. staging-meter has no STAGING_CRON_SECRET there,
# so it sent `Bearer ` and collected a 401 every 10 minutes; the base-bump cron
# would open PRs against a branch that gets force-pushed; agent-image would
# build the 293 MB agent into the mirror owner's GHCR. A read-only mirror runs
# no CI.
STRIP=(CLAUDE.md AGENTS.md PROJECT_CONTEXT.md .github
  decenchro-article.md decenchro-launch.md decenchro-threads.md decenchro-tweets.md
  decenchro-email-dns.txt)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git -C "$SRC_DIR" archive "$REF" | tar -x -C "$WORK"
cd "$WORK"
rm -rf "${STRIP[@]}"
# The first migration's header names the retired Supabase project. Drop the ref.
sed -i.bak -E 's/ \(project [a-z]{20}\)//' db/migrations/0001_init.sql && rm -f db/migrations/0001_init.sql.bak
if grep -q '(project ' db/migrations/0001_init.sql; then
  echo "Supabase project ref survived the scrub" >&2; exit 1
fi

# Refuse to publish anything secret-shaped. Same patterns as the pre-publish audit.
if grep -rIEn --exclude=package-lock.json --exclude=build-public-mirror.sh \
  '(sk-or-v1-[A-Za-z0-9]{20,}|cpay_(sk|at)_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{30,}|rnd_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|postgres(ql)?://[^:/]+:[^@]{8,}@|[0-9]{8,10}:AA[A-Za-z0-9_-]{30,})' . ; then
  echo "secret-shaped string in export, refusing to publish" >&2; exit 1
fi
for f in "${STRIP[@]}"; do [ -e "$f" ] && { echo "$f survived the strip" >&2; exit 1; }; done

git init -q -b main
git add -A
git -c user.name=liho00 -c user.email=77238199+liho00@users.noreply.github.com \
  commit -q -m "Public mirror of decenchro at $SRC_SHA"

gh repo view "$DEST" >/dev/null 2>&1 || gh repo create "$DEST" --private \
  --homepage https://decenchro.com \
  --description "Decentralised, auditable AI agents: Hermes agent, Chromia on-chain memory, ERC-8004 identity on BNB Smart Chain"
git push -q --force "git@github.com:$DEST.git" main

echo "pushed $SRC_SHA -> https://github.com/$DEST ($(gh repo view "$DEST" --json visibility --jq .visibility))"
echo "to publish: gh repo edit $DEST --visibility public --accept-visibility-change-consequences"
