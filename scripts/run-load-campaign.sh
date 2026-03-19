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

LOADED_BEFORE=$(get_loaded_count_today)
if LOAD_LIMIT="$LOAD_LIMIT" MODE=load node workspace/skills/instantly/index.mjs; then
  DURATION=$(get_duration)
  LOADED_TODAY=$(get_loaded_count_today)
  LOADED_THIS_RUN=$((LOADED_TODAY - LOADED_BEFORE))
  CAP="${INSTANTLY_LOAD_DAILY_CAP:-300}"
  PT_AT="$(get_pt_timestamp)"
  if [ "$LOADED_THIS_RUN" -le 0 ] && [ "$LOADED_TODAY" -ge "$CAP" ]; then
    MSG="✅ [${PT_AT}] Load-campaign done in ${DURATION}s (limit ${LOAD_LIMIT}). Skipped (daily cap: ${LOADED_TODAY}/${CAP})."
  else
    MSG="✅ [${PT_AT}] Load-campaign done in ${DURATION}s (limit ${LOAD_LIMIT}). This run: loaded ${LOADED_THIS_RUN}. Today: instantly_loaded ${LOADED_TODAY}/${CAP}."
  fi
  log_success "$MSG"
  post_slack_report "$MSG"
else
  handle_error "load-campaign" "Instantly load"
fi
