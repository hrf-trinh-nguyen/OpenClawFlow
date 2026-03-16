#!/usr/bin/env bash
# Start OpenClaw gateway — works identically for local dev and VPS.
#
# Flow:
#   1. Guard against duplicate starts
#   2. Load .env (set -a so all vars export to child processes)
#   3. Ensure OPENCLAW_STATE_DIR exists
#   4. Run `openclaw onboard --non-interactive` if no config exists yet
#   5. Remove stale gateway.lock
#   6. exec openclaw gateway
#
# Usage (local):  ./scripts/start-openclaw.sh
# Usage (systemd): ExecStart=/home/deploy/openclaw-mvp/scripts/start-openclaw.sh
# Override repo root: OPENCLAW_HOME=/custom/path ./scripts/start-openclaw.sh

set -e

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
fi

REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"

OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"
if [ -z "$OPENCLAW_BIN" ]; then
    for candidate in \
        /home/linuxbrew/.linuxbrew/bin/openclaw \
        /usr/local/bin/openclaw \
        /opt/homebrew/bin/openclaw
    do
        if [ -x "$candidate" ]; then
            OPENCLAW_BIN="$candidate"
            break
        fi
    done
fi

if [ -z "$OPENCLAW_BIN" ]; then
    echo "ERROR: openclaw binary not found in PATH or known install locations."
    exit 127
fi

# ── 1. Load .env ──────────────────────────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
    echo "Loaded env from $ENV_FILE"
else
    echo "WARNING: No .env found at $ENV_FILE — env vars must already be set."
fi

# ── 2. Ensure state dir exists ────────────────────────────────────────────────

if [ -n "${OPENCLAW_STATE_DIR:-}" ]; then
    mkdir -p "$OPENCLAW_STATE_DIR"
fi

# ── 3. Onboard if no config ───────────────────────────────────────────────────

CONFIG_FILE="$HOME/.openclaw/openclaw.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "No config found at $CONFIG_FILE, running openclaw onboard..."

    AUTH_ARGS=""
    if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
        AUTH_ARGS="--auth-choice apiKey --anthropic-api-key $ANTHROPIC_API_KEY"
    elif [ -n "${OPENAI_API_KEY:-}" ]; then
        AUTH_ARGS="--auth-choice openai-api-key --openai-api-key $OPENAI_API_KEY"
    fi

    "$OPENCLAW_BIN" onboard --non-interactive --accept-risk \
        --mode local \
        ${AUTH_ARGS:---skip-auth} \
        --gateway-port 18789 \
        --gateway-bind loopback \
        --skip-channels \
        --skip-skills \
        --skip-health

    echo "Onboard completed"
else
    echo "Using existing config at $CONFIG_FILE"
fi

# ── 4. Remove stale lock ──────────────────────────────────────────────────────

rm -f "$HOME/.openclaw/gateway.lock" 2>/dev/null || true

# ── 5. Start gateway ──────────────────────────────────────────────────────────

BIND="${OPENCLAW_GATEWAY_BIND:-loopback}"
echo "Starting OpenClaw gateway (port 18789, bind=$BIND)..."

if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
    exec "$OPENCLAW_BIN" gateway --port 18789 --bind "$BIND" --token "$OPENCLAW_GATEWAY_TOKEN"
else
    exec "$OPENCLAW_BIN" gateway --port 18789 --bind "$BIND"
fi
