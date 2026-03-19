#!/usr/bin/env bash
set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

log_info "Starting daily-report"
start_timer

# Build and save report to DB + state
if node workspace/skills/report-build/index.mjs; then
  log_info "Report built"
else
  handle_error "daily-report" "Report build"
fi

# Send to Slack
if node workspace/skills/slack-notify/index.mjs; then
  DURATION=$(get_duration)
  PT_AT="$(get_pt_timestamp)"
  MSG="✅ [${PT_AT}] Daily-report done in ${DURATION}s"
  log_success "$MSG"
  post_slack_report "$MSG"
else
  handle_error "daily-report" "Slack notify"
fi
