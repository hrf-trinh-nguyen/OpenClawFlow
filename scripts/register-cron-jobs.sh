#!/usr/bin/env bash
# Register 4 OpenClaw cron jobs (optional; primary scheduling is system crontab).
# All schedules are US Eastern (America/New_York). Run: ./scripts/register-cron-jobs.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

TZ_ET="America/New_York"

openclaw cron add --name "5–8 AM ET - Bouncer (Build List)" --cron "0 5,6,7,8 * * *" --tz "$TZ_ET" \
  --session isolated --no-deliver --message "Run workflow: build-list"

openclaw cron add --name "5:30–8:30 AM ET - Load Campaign" --cron "30 5,6,7,8 * * *" --tz "$TZ_ET" \
  --session isolated --no-deliver --message "Run workflow: load-campaign"

openclaw cron add --name "10AM–9PM ET - Process Replies (Hourly)" --cron "0 10-21 * * *" --tz "$TZ_ET" \
  --session isolated --no-deliver --message "Run workflow: process-replies"

openclaw cron add --name "10PM ET - Daily Report" --cron "0 22 * * *" --tz "$TZ_ET" \
  --session isolated --message "Run workflow: daily-report" \
  --announce --channel slack --to "channel:${SLACK_REPORT_CHANNEL:-}"

echo "Done. List jobs: openclaw cron list"
