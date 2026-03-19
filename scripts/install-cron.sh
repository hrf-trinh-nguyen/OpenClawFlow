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

echo ""
echo "Current crontab:"
crontab -l

echo ""
echo "Done. All 4 jobs installed:"
echo "  - Bouncer:          5:00 AM PT   → logs/build-list.log"
echo "  - Load campaign:    5:30 AM PT   → logs/load-campaign.log"
echo "  - Process replies:  10AM–9PM PT  → logs/process-replies.log"
echo "  - Daily report:     10:00 PM PT  → logs/daily-report.log"
echo ""
echo "Verify: crontab -l"
echo "Logs:   tail -f $REPO_ROOT/logs/*.log"
