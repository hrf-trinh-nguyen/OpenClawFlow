#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

mkdir -p "$REPO_ROOT/logs"

# Use repo root as OPENCLAW_REPO in crontab
CRON_FILE="$REPO_ROOT/cron/crontab.example"
INSTALLED=$(sed "s|/home/deploy/openclaw-mvp|$REPO_ROOT|g" "$CRON_FILE")

echo "Installing SYSTEM user crontab for $(whoami) from cron/crontab.example"
echo "(OpenClaw gateway cron is disabled in openclaw.json — this file is the schedule.)"
echo "$INSTALLED" | crontab -

echo ""
echo "Current crontab:"
crontab -l

echo ""
echo "Done. Pipeline jobs use system crontab only (UTC on VPS; business time = US Eastern):"
echo ""
echo "  Job               Eastern (local)            UTC (EDT, ~Mar–Nov)"
echo "  ─────────────────────────────────────────────────────────────────"
echo "  Bouncer           4:00 AM – 11:50 PM ET (every 10m)  UTC 8–23 + 0–3 (EDT)"
echo "  Load Campaign     6:05 AM – 11:55 PM ET (every 10m)  UTC 10–23 + 0–3 (EDT)"
echo "  Process Replies   10 AM – 9 PM (hourly, no Slack)  14–23, 0, 1"
echo "  Process Replies   9:30 PM (Slack summary)      01:30 (EDT)"
echo "  Daily Report      10 PM                     02:00"
echo ""
echo "DST: In US Eastern Standard Time (winter), add +1h to each UTC hour above"
echo "     or re-install after updating cron/crontab.example for EST."
echo ""
echo "Verify: crontab -l"
echo "Logs:   tail -f $REPO_ROOT/logs/*.log"
