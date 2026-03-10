#!/usr/bin/env bash
# Register 4 cron jobs per https://docs.openclaw.ai/automation/cron-jobs
# Run from repo root: ./scripts/register-cron-jobs.sh
# Requires: SLACK_REPORT_CHANNEL in .env (for 10PM job delivery)

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# 6AM, 6:30AM, 6PM: run workflow silently (no delivery; results in DB/state)
openclaw cron add --name "6AM - Build List" --cron "0 6 * * *" --tz "Asia/Ho_Chi_Minh" \
  --session isolated --no-deliver --message "Run workflow: build-list"

openclaw cron add --name "6:30AM - Load Campaign" --cron "30 6 * * *" --tz "Asia/Ho_Chi_Minh" \
  --session isolated --no-deliver --message "Run workflow: load-campaign"

openclaw cron add --name "6PM - Process Replies" --cron "0 18 * * *" --tz "Asia/Ho_Chi_Minh" \
  --session isolated --no-deliver --message "Run workflow: process-replies"

openclaw cron add --name "8PM - Process Replies" --cron "0 20 * * *" --tz "Asia/Ho_Chi_Minh" \
  --session isolated --no-deliver --message "Run workflow: process-replies"

# 10PM: deliver report to Slack
openclaw cron add --name "10PM - Daily Report" --cron "0 22 * * *" --tz "Asia/Ho_Chi_Minh" \
  --session isolated --message "Run workflow: daily-report" \
  --announce --channel slack --to "channel:${SLACK_REPORT_CHANNEL:-}"

echo "Done. List jobs: openclaw cron list"
