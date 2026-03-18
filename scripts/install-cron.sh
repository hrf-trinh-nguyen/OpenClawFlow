#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

mkdir -p "$REPO_ROOT/logs"

# Use repo root as OPENCLAW_REPO in crontab
CRON_FILE="$REPO_ROOT/cron/crontab.example"
INSTALLED=$(sed "s|/home/deploy/openclaw-mvp|$REPO_ROOT|g" "$CRON_FILE")

echo "Installing crontab for user $(whoami)..."
echo "$INSTALLED" | crontab -

echo "Current crontab:"
crontab -l

echo ""
echo "Done. Logs: $REPO_ROOT/logs/build-list.log, $REPO_ROOT/logs/load-campaign.log"
