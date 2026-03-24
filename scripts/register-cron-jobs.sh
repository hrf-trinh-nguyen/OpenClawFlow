#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# OPTIONAL — only if you enable OpenClaw cron in openclaw.json ("cron.enabled": true).
# Normal deployments use LINUX USER CRONTAB only: ./scripts/install-cron.sh
# Do NOT run this if system crontab already runs the same workflows (double execution).
# ═══════════════════════════════════════════════════════════════════════════════
# Register OpenClaw cron jobs. Schedules are US Eastern (America/New_York).
# Run: ./scripts/register-cron-jobs.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

TZ_ET="America/New_York"

openclaw cron add --name "4 AM–11:50 PM ET (10m) - Bouncer (Build List)" --cron "0,10,20,30,40,50 4-23,0-3 * * *" --tz "$TZ_ET" \
  --session isolated --no-deliver --message "Run workflow: build-list"

openclaw cron add --name "6:05 AM–11:55 PM ET (10m) - Load Campaign" --cron "5,15,25,35,45,55 6-23,0-3 * * *" --tz "$TZ_ET" \
  --session isolated --no-deliver --message "Run workflow: load-campaign"

openclaw cron add --name "10AM–9PM ET - Process Replies (Hourly)" --cron "0 10-21 * * *" --tz "$TZ_ET" \
  --session isolated --no-deliver --message "Run workflow: process-replies"

openclaw cron add --name "9:30PM ET - Process Replies Slack Summary" --cron "30 21 * * *" --tz "$TZ_ET" \
  --session isolated --no-deliver --message "Run workflow: process-replies-evening-slack"

openclaw cron add --name "10PM ET - Daily Report" --cron "0 22 * * *" --tz "$TZ_ET" \
  --session isolated --message "Run workflow: daily-report" \
  --announce --channel slack --to "channel:${SLACK_REPORT_CHANNEL:-}"

echo "Done. List jobs: openclaw cron list"
