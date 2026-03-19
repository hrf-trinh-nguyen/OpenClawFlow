#!/usr/bin/env bash
# Run on VPS after `git pull` to install deps, build workspace, and restart services.
# Usage: ./scripts/after-pull-vps.sh
# Optional: SKIP_RESTART=1 ./scripts/after-pull-vps.sh  (build only, do not restart openclaw)

set -euo pipefail

REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

echo "=== OpenClaw VPS — after-pull steps ==="
echo ""

echo "1. Installing workspace dependencies..."
(cd "$REPO_ROOT/workspace" && npm install --no-audit --no-fund)
echo ""

echo "2. Building workspace (TS → .mjs)..."
(cd "$REPO_ROOT/workspace" && npm run build)
echo ""

if [ "${SKIP_RESTART:-0}" = "1" ]; then
  echo "SKIP_RESTART=1 — skipping service restart."
  echo "=== Done ==="
  exit 0
fi

echo "3. Restarting OpenClaw gateway (if systemd unit exists)..."
if systemctl is-enabled openclaw &>/dev/null; then
  sudo systemctl restart openclaw
  echo "   openclaw restarted."
else
  echo "   openclaw unit not found or not enabled; skip restart. Restart gateway manually if needed."
fi
echo ""

echo "=== Done ==="
echo ""
echo "Next steps:"
echo ""
echo "  # Re-install crontab (if crontab.example changed):"
echo "  ./scripts/install-cron.sh"
echo ""
echo "  # Verify crontab:"
echo "  crontab -l"
echo ""
echo "Note: OpenClaw cron is disabled. All jobs run via system crontab (UTC times)."
