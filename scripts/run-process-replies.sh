#!/usr/bin/env bash
set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env
# Hourly: never post the Process Replies Slack template (evening script forces 1 after load_env)
export PROCESS_REPLIES_SLACK_REPORT=0

log_info "Starting process-replies"
start_timer

if MODE=fetch node workspace/skills/instantly/index.mjs; then
  DURATION=$(get_duration)
  PT_AT="$(get_pt_timestamp)"
  log_success "✅ [${PT_AT}] Process-replies done in ${DURATION}s"
else
  handle_error "process-replies" "Instantly fetch"
fi
