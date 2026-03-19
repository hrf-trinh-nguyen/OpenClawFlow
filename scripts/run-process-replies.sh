#!/usr/bin/env bash
set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

log_info "Starting process-replies"
start_timer

if MODE=fetch node workspace/skills/instantly/index.mjs; then
  DURATION=$(get_duration)
  PT_AT="$(get_pt_timestamp)"
  MSG="✅ [${PT_AT}] Process-replies done in ${DURATION}s"
  log_success "$MSG"
  post_slack_report "$MSG"
else
  handle_error "process-replies" "Instantly fetch"
fi
