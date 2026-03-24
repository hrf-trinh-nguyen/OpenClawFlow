#!/usr/bin/env bash
set -euo pipefail

# Single daily Slack summary for process-replies (~9:30 PM US Eastern).
# Hourly run-process-replies.sh leaves PROCESS_REPLIES_SLACK_REPORT unset/false so no Slack noise.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env
export PROCESS_REPLIES_SLACK_REPORT=1

log_info "Starting process-replies (evening Slack summary)"
start_timer

if MODE=fetch node workspace/skills/instantly/index.mjs; then
  DURATION=$(get_duration)
  PT_AT="$(get_pt_timestamp)"
  log_success "✅ [${PT_AT}] Process-replies evening run done in ${DURATION}s (Slack template sent if SLACK_REPORT_CHANNEL set)"
else
  handle_error "process-replies-evening" "Instantly fetch"
fi
