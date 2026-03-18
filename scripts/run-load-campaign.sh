#!/usr/bin/env bash
set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

LOAD_LIMIT="${LOAD_LIMIT:-100}"

log_info "Starting load-campaign batch (LOAD_LIMIT=${LOAD_LIMIT})"
start_timer

if LOAD_LIMIT="$LOAD_LIMIT" MODE=load node workspace/skills/instantly/index.mjs; then
  DURATION=$(get_duration)
  LOADED_TODAY=$(get_loaded_count_today)
  MSG="✅ Load-campaign batch done in ${DURATION}s (limit ${LOAD_LIMIT}). Daily instantly_loaded count: ${LOADED_TODAY}"
  log_success "$MSG"
  post_slack_report "$MSG"
else
  handle_error "load-campaign" "Instantly load"
fi
