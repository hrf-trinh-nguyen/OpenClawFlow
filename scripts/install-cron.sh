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
echo "Done. Jobs installed (cron times are UTC on the VPS; business timezone is US Eastern):"
echo ""
echo "  Job               Eastern (local)            UTC (EDT, ~Mar–Nov)"
echo "  ─────────────────────────────────────────────────────────────────"
echo "  Bouncer           5, 6, 7, 8 AM              9, 10, 11, 12"
echo "  Load Campaign     5:30, 6:30, 7:30, 8:30 AM  9:30, 10:30, 11:30, 12:30"
echo "  Process Replies   10 AM – 9 PM (hourly)      14–23, 0, 1"
echo "  Daily Report      10 PM                     02:00"
echo ""
echo "DST: In US Eastern Standard Time (winter), add +1h to each UTC hour above"
echo "     or re-install after updating cron/crontab.example for EST."
echo ""
echo "Verify: crontab -l"
echo "Logs:   tail -f $REPO_ROOT/logs/*.log"
