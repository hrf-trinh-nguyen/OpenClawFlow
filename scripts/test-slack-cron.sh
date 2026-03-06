#!/usr/bin/env bash
# Add a one-shot cron job that sends a test report to Slack in ~2 minutes
# Run from repo root with gateway running: ./scripts/test-slack-cron.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -z "$SLACK_REPORT_CHANNEL" ]; then
  echo "Error: SLACK_REPORT_CHANNEL not set in .env"
  exit 1
fi

openclaw cron add \
  --name "Test Slack Report" \
  --at "2m" \
  --session isolated \
  --message "Produce a short test report: 'OpenClaw cron → Slack test ok at [current time]'. One paragraph only." \
  --announce \
  --channel slack \
  --to "channel:${SLACK_REPORT_CHANNEL}" \
  --delete-after-run

echo "Done. Job will run in ~2 min and post to Slack. Check: openclaw cron list"
