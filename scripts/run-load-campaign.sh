#!/usr/bin/env bash
set -euo pipefail

# Load Campaign: push verified leads to Instantly.
# Runs 4x/day (5:30, 6:30, 7:30, 8:30 AM PT) to incrementally load leads.
# Daily cap: INSTANTLY_LOAD_DAILY_CAP (default 250).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

CAP="${INSTANTLY_LOAD_DAILY_CAP:-250}"
LOADED_TODAY=$(get_loaded_count_today)
REMAINING=$((CAP - LOADED_TODAY))

if [ "$REMAINING" -le 0 ]; then
  log_info "Skipping Load: daily cap reached (${LOADED_TODAY}/${CAP})"
  exit 0
fi

# Check if there are verified leads to load
VERIFIED_COUNT=$(get_verified_ready_count 2>/dev/null || echo "0")
if [ "$VERIFIED_COUNT" -eq 0 ]; then
  log_info "Skipping Load: no verified leads ready (bouncer_verified=0)"
  exit 0
fi

# Limit per run: min of remaining cap and available verified leads
LOAD_LIMIT="${LOAD_LIMIT:-100}"
if [ "$REMAINING" -lt "$LOAD_LIMIT" ]; then
  LOAD_LIMIT="$REMAINING"
fi

log_info "Starting Load (verified ready: ${VERIFIED_COUNT}, limit: ${LOAD_LIMIT}, remaining cap: ${REMAINING}/${CAP})"
start_timer

LOADED_BEFORE=$LOADED_TODAY

if LOAD_LIMIT="$LOAD_LIMIT" MODE=load node workspace/skills/instantly/index.mjs; then
  DURATION=$(get_duration)
  LOADED_AFTER=$(get_loaded_count_today)
  LOADED_THIS_RUN=$((LOADED_AFTER - LOADED_BEFORE))
  PT_AT="$(get_pt_timestamp)"
  MSG="✅ [${PT_AT}] Load done in ${DURATION}s. This run: +${LOADED_THIS_RUN} loaded. Today: ${LOADED_AFTER}/${CAP}."
  log_success "$MSG"
  post_slack_report "$MSG"
else
  handle_error "load-campaign" "Instantly load"
fi
