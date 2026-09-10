#!/usr/bin/env bash
set -euo pipefail

# Decenchro — Local Setup Script
# Installs Hermes Agent + Chromia skill + Atbash SDK (@atbash/sdk)
# for on-chain memory and policy-gated tool calls.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES_DIR="$HOME/.hermes"
SKILL_REPO="https://bitbucket.org/chromawallet/chromia-skill.git"

# ── decenchro-guard plugin (TODO: pick one) ──
# The Hermes plugin that bridges to @atbash/sdk via the pre_tool_call hook.
# Either a git URL OR an in-repo path. If both are blank, the plugin step is
# skipped with a warning.
PLUGIN_REPO=""
PLUGIN_LOCAL_DIR="$SCRIPT_DIR/agent/plugins/decenchro-guard"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[decenchro]${NC} $1"; }
warn() { echo -e "${YELLOW}[decenchro]${NC} $1"; }
err()  { echo -e "${RED}[decenchro]${NC} $1" >&2; }

# ── Phase 1: Check prerequisites ──────────────────────────────────────

log "Phase 1/7: Checking prerequisites..."

if ! command -v git &>/dev/null; then
    err "git is required. Install it first."
    exit 1
fi

# Node 18+ is required by @atbash/sdk.
if ! command -v node &>/dev/null; then
    err "Node.js 18+ is required (for @atbash/sdk). Install from https://nodejs.org"
    exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0")
if [ "$NODE_MAJOR" -lt 18 ]; then
    err "Node.js 18+ required, found v$(node -v). Upgrade Node before re-running."
    exit 1
fi

if ! command -v npm &>/dev/null; then
    err "npm is required (ships with Node.js). Reinstall Node from https://nodejs.org"
    exit 1
fi

# ── Phase 2: Install Hermes Agent ─────────────────────────────────────

log "Phase 2/7: Installing Hermes Agent..."

if command -v hermes &>/dev/null; then
    log "Hermes already installed: $(hermes version 2>/dev/null || echo 'unknown version')"
    warn "Skipping installation. To reinstall, run: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
else
    log "Running Hermes installer..."
    curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

    # Ensure hermes is in PATH for this script
    export PATH="$HOME/.local/bin:$PATH"

    if ! command -v hermes &>/dev/null; then
        err "Hermes installation failed. Check output above."
        exit 1
    fi
    log "Hermes installed: $(hermes version 2>/dev/null || echo 'ok')"
fi

# ── Phase 3: Bundle Chromia skill ─────────────────────────────────────

log "Phase 3/7: Bundling Chromia skill..."

SKILL_DIR="$HERMES_DIR/skills/chromia-skill"

if [ -d "$SKILL_DIR" ]; then
    warn "Chromia skill already exists at $SKILL_DIR"
    warn "Updating..."
    cd "$SKILL_DIR" && git pull --quiet 2>/dev/null || true
    cd "$SCRIPT_DIR"
else
    mkdir -p "$HERMES_DIR/skills"
    git clone --quiet "$SKILL_REPO" /tmp/chromia-skill-repo 2>/dev/null
    cp -r /tmp/chromia-skill-repo/chromia-skill "$SKILL_DIR"
    rm -rf /tmp/chromia-skill-repo
fi

# Verify skill files
if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
    err "SKILL.md not found in $SKILL_DIR. Clone may have failed."
    exit 1
fi

REFS=$(ls "$SKILL_DIR/references/"*.md 2>/dev/null | wc -l | tr -d ' ')
log "Chromia skill bundled: SKILL.md + ${REFS} reference files"

# ── Phase 4: Install decenchro-guard plugin + @atbash/sdk ────────────

log "Phase 4/7: Installing decenchro-guard plugin and @atbash/sdk..."

PLUGIN_DIR="$HERMES_DIR/plugins/decenchro-guard"
mkdir -p "$HERMES_DIR/plugins"

# 4a. Install the plugin
if [ -d "$PLUGIN_DIR" ]; then
    warn "decenchro-guard already exists at $PLUGIN_DIR"
    if [ -n "$PLUGIN_REPO" ]; then
        warn "Updating from $PLUGIN_REPO..."
        cd "$PLUGIN_DIR" && git pull --quiet 2>/dev/null || true
        cd "$SCRIPT_DIR"
    fi
elif [ -n "$PLUGIN_REPO" ]; then
    log "Cloning decenchro-guard from $PLUGIN_REPO..."
    git clone --quiet "$PLUGIN_REPO" "$PLUGIN_DIR"
elif [ -d "$PLUGIN_LOCAL_DIR" ]; then
    log "Copying decenchro-guard from $PLUGIN_LOCAL_DIR..."
    cp -r "$PLUGIN_LOCAL_DIR" "$PLUGIN_DIR"
else
    warn "decenchro-guard not found at $PLUGIN_LOCAL_DIR and PLUGIN_REPO is empty — skipping plugin install."
    warn "Tool calls will NOT be policy-gated until the plugin is installed and wired into config.yaml."
fi

# 4b. Install @atbash/sdk into the plugin's node_modules (the plugin shells
# out to a small Node wrapper that imports the SDK).
if [ -d "$PLUGIN_DIR" ]; then
    if [ -f "$PLUGIN_DIR/package.json" ]; then
        log "Installing @atbash/sdk dependencies via npm..."
        (cd "$PLUGIN_DIR" && npm install --silent --no-audit --no-fund 2>&1 | tail -5) || {
            err "npm install failed in $PLUGIN_DIR"
            exit 1
        }
    else
        warn "No package.json in $PLUGIN_DIR — installing @atbash/sdk directly."
        (cd "$PLUGIN_DIR" && npm install --silent --no-audit --no-fund @atbash/sdk 2>&1 | tail -5) || {
            err "npm install @atbash/sdk failed in $PLUGIN_DIR"
            exit 1
        }
    fi
    log "@atbash/sdk installed in $PLUGIN_DIR/node_modules"
fi

# 4c. Wire the plugin's pre_tool_call hook into ~/.hermes/config.yaml.
# Idempotent: only enables the plugin once ATBASH_AGENT_KEY is set in the env
# file. Uncomments an existing stanza when present, otherwise appends one.
HERMES_CONFIG="$HERMES_DIR/config.yaml"
ENV_FILE_FOR_PLUGIN="$HERMES_DIR/.env"

if [ -d "$PLUGIN_DIR" ] && [ -f "$HERMES_CONFIG" ]; then
    if [ -f "$ENV_FILE_FOR_PLUGIN" ] && grep -qE '^ATBASH_AGENT_KEY=[^[:space:]]+' "$ENV_FILE_FOR_PLUGIN"; then
        if grep -qE '^[[:space:]]+- decenchro-guard[[:space:]]*$' "$HERMES_CONFIG"; then
            log "decenchro-guard already enabled in $HERMES_CONFIG"
        elif grep -qE '^[[:space:]]+#[[:space:]]*- decenchro-guard[[:space:]]*$' "$HERMES_CONFIG"; then
            # Uncomment in place (sed -i.bak works on both BSD/macOS and GNU).
            sed -i.bak -E 's/^([[:space:]]+)#[[:space:]]*- decenchro-guard[[:space:]]*$/\1- decenchro-guard/' "$HERMES_CONFIG"
            rm -f "$HERMES_CONFIG.bak"
            log "Enabled decenchro-guard in $HERMES_CONFIG"
        else
            {
                echo ""
                echo "# decenchro-guard — routes tool calls through Atbash judge."
                echo "plugins:"
                echo "  enabled:"
                echo "    - decenchro-guard"
            } >> "$HERMES_CONFIG"
            log "Appended plugins.enabled with decenchro-guard to $HERMES_CONFIG"
        fi
    else
        warn "ATBASH_AGENT_KEY not set in $ENV_FILE_FOR_PLUGIN — leaving decenchro-guard disabled."
        warn "Add the key from https://atbash.ai/risk-engine/agents and re-run this script."
    fi
fi

# ── Phase 5: Configure agent identity ─────────────────────────────────

log "Phase 5/7: Configuring agent identity..."

# Copy SOUL.md
if [ ! -f "$HERMES_DIR/SOUL.md" ] || [ "$HERMES_DIR/SOUL.md" -ot "$SCRIPT_DIR/agent/SOUL.md" ]; then
    cp "$SCRIPT_DIR/agent/SOUL.md" "$HERMES_DIR/SOUL.md"
    log "SOUL.md installed"
else
    warn "SOUL.md already exists (not overwriting). To update: cp $SCRIPT_DIR/agent/SOUL.md $HERMES_DIR/SOUL.md"
fi

# Copy config.yaml (only if not exists — don't overwrite user customizations)
if [ ! -f "$HERMES_DIR/config.yaml" ]; then
    cp "$SCRIPT_DIR/agent/config.yaml" "$HERMES_DIR/config.yaml"
    log "config.yaml installed"
else
    warn "config.yaml already exists (not overwriting). Template at: $SCRIPT_DIR/agent/config.yaml"
fi

# ── Phase 6: Configure API keys ──────────────────────────────────────

log "Phase 6/7: Configuring API keys..."

ENV_FILE="$HERMES_DIR/.env"

check_env_key() {
    local key="$1"
    local pattern="$2"
    if ! grep -qE "^${key}=${pattern}" "$ENV_FILE" 2>/dev/null; then
        warn "${key} not set in $ENV_FILE"
        return 1
    fi
    return 0
}

if [ -f "$ENV_FILE" ]; then
    MISSING_KEYS=0
    check_env_key "OPENROUTER_API_KEY" "sk-" || MISSING_KEYS=1
    check_env_key "TELEGRAM_BOT_TOKEN"  ".+"  || MISSING_KEYS=1
    check_env_key "ATBASH_AGENT_KEY"    ".+"  || MISSING_KEYS=1

    if [ "$MISSING_KEYS" -eq 1 ]; then
        warn "Edit $ENV_FILE to add missing keys. Reference: $SCRIPT_DIR/agent/.env.example"
    else
        log "API keys configured"
    fi
else
    cp "$SCRIPT_DIR/agent/.env.example" "$ENV_FILE"
    warn "Created $ENV_FILE from template — you MUST edit it with your real keys:"
    echo ""
    echo -e "  ${CYAN}1.${NC} OpenRouter API key:    https://openrouter.ai/keys"
    echo -e "  ${CYAN}2.${NC} Telegram bot token:    Message @BotFather on Telegram"
    echo -e "  ${CYAN}3.${NC} Telegram user ID:      Message @userinfobot on Telegram"
    echo -e "  ${CYAN}4.${NC} Atbash agent key:      https://atbash.ai/risk-engine/agents"
    echo ""
    echo -e "  ${CYAN}Edit:${NC} nano $ENV_FILE"
    echo ""
fi

# ── Phase 7: Verify ──────────────────────────────────────────────────

log "Phase 7/7: Verifying setup..."

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Decenchro setup complete${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo "  Hermes dir:        $HERMES_DIR"
echo "  SOUL.md:           $HERMES_DIR/SOUL.md"
echo "  Config:            $HERMES_DIR/config.yaml"
echo "  Env:               $HERMES_DIR/.env"
echo "  Chromia skill:     $SKILL_DIR/"
echo "  Decenchro-guard:   $PLUGIN_DIR/"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo ""
echo "  1. Onboard your Atbash agent (if not done):"
echo "     https://atbash.ai/risk-engine/agents"
echo "     Copy the private key into ATBASH_AGENT_KEY in $HERMES_DIR/.env"
echo ""
echo "  2. Edit your API keys (if not done):"
echo "     nano $HERMES_DIR/.env"
echo ""
echo "  3. Test locally (CLI mode):"
echo "     hermes chat -q \"What can you help me build on Chromia?\""
echo ""
echo "  4. Start Telegram gateway:"
echo "     hermes gateway"
echo ""
echo "  5. Run diagnostics:"
echo "     hermes doctor"
echo ""
