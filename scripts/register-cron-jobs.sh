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

openclaw cron add --name "3AM-5AM PT - Build List (Batched)" --cron "0 3-5 * * *" --tz "America/Los_Angeles" \
  --session isolated --no-deliver --message "Run workflow: build-list"

openclaw cron add --name "5:15AM & 5:45AM PT - Load Campaign (Batched)" --cron "15,45 5 * * *" --tz "America/Los_Angeles" \
  --session isolated --no-deliver --message "Run workflow: load-campaign"

openclaw cron add --name "10AM–9PM PT - Process Replies (Hourly)" --cron "0 10-21 * * *" --tz "America/Los_Angeles" \
  --session isolated --no-deliver --message "Run workflow: process-replies"

# 10PM: deliver report to Slack
openclaw cron add --name "10PM PT - Daily Report" --cron "0 22 * * *" --tz "America/Los_Angeles" \
  --session isolated --message "Run workflow: daily-report" \
  --announce --channel slack --to "channel:${SLACK_REPORT_CHANNEL:-}"

echo "Done. List jobs: openclaw cron list"
