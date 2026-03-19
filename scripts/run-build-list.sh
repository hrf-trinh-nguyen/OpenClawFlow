#!/usr/bin/env bash
set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

DAILY_CAP="${APOLLO_DAILY_CAP:-300}"
MAX_RUNS_PER_DAY="${APOLLO_MAX_RUNS_PER_DAY:-3}"

GUARD="$(apollo_run_guard "$MAX_RUNS_PER_DAY")"
if [ "$GUARD" = "SKIP" ]; then
  log_info "Skipping build-list: Apollo max runs/day reached (${MAX_RUNS_PER_DAY})"
  exit 0
fi

ALREADY_TODAY="$(get_apollo_inserted_count_today)"
REMAINING=$(( DAILY_CAP - ALREADY_TODAY ))
if [ "$REMAINING" -le 0 ]; then
  log_info "Skipping build-list: Apollo daily cap reached (${ALREADY_TODAY}/${DAILY_CAP})"
  exit 0
fi

TARGET_COUNT="${TARGET_COUNT:-100}"
if [ "$TARGET_COUNT" -gt "$REMAINING" ]; then
  TARGET_COUNT="$REMAINING"
fi

# Use one Apollo batch_id for this whole build-list run so we can report per-run counts.
BATCH_ID="${BATCH_ID:-apollo-$(date +%s)}"

log_info "Starting build-list batch (TARGET_COUNT=${TARGET_COUNT}, BATCH_ID=${BATCH_ID})"
start_timer

APOLLO_OK=1
if TARGET_COUNT="$TARGET_COUNT" BATCH_ID="$BATCH_ID" node workspace/skills/apollo/index.mjs; then
  log_info "Apollo completed"
else
  APOLLO_OK=0
  log_error "[build-list] Apollo had errors (continuing to Bouncer to process any apollo_matched leads)."
  post_slack_alert "[build-list] Apollo had errors (continuing). Check logs/build-list.log for details."
fi

if node workspace/skills/bouncer/index.mjs; then
  log_info "Bouncer completed"
else
  handle_error "build-list" "Bouncer"
fi

DURATION=$(get_duration)
INSERTED_THIS_RUN=$(BATCH_ID="$BATCH_ID" get_apollo_inserted_count_for_batch "$BATCH_ID")
VERIFIED_THIS_RUN=$(BATCH_ID="$BATCH_ID" get_bouncer_verified_count_for_batch "$BATCH_ID")
VERIFIED=$(get_verified_count_today)
APOLLO_TODAY=$(get_apollo_inserted_count_today)
PT_AT="$(get_pt_timestamp)"

MSG="✅ [${PT_AT}] Build-list done in ${DURATION}s. This run: inserted ${INSERTED_THIS_RUN}, verified ${VERIFIED_THIS_RUN}. Today: apollo_inserted ${APOLLO_TODAY}/${DAILY_CAP}, bouncer_verified ${VERIFIED}."
log_success "$MSG"
post_slack_report "$MSG"

if [ "$APOLLO_OK" -eq 0 ]; then
  exit 0
fi
