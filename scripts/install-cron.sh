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
echo "Done. Jobs installed (cron times are UTC, PT shown for reference):"
echo ""
echo "  Job               PT Time                    UTC Time"
echo "  ─────────────────────────────────────────────────────────────"
echo "  Bouncer           5, 6, 7, 8 AM              12, 13, 14, 15"
echo "  Load Campaign     5:30, 6:30, 7:30, 8:30 AM  12:30, 13:30, 14:30, 15:30"
echo "  Process Replies   10 AM – 9 PM (hourly)      17–23, 0–4"
echo "  Daily Report      10 PM                      05:00 (next day)"
echo ""
echo "IMPORTANT: Cron uses server timezone (UTC). TZ variable is ignored."
echo "           All times in crontab.example are already converted to UTC."
echo ""
echo "Verify: crontab -l"
echo "Logs:   tail -f $REPO_ROOT/logs/*.log"
