#!/usr/bin/env bash
set -euo pipefail

# Bouncer: verify leads already in DB (e.g. from CSV import via Agent).
# Runs 4x/day (5, 6, 7, 8 AM PT) to incrementally verify leads.
# No Apollo — use Agent + csv-import to add leads, then cron verifies.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

BOUNCER_DAILY_CAP="${BOUNCER_DAILY_CAP:-300}"
VERIFIED_TODAY=$(get_verified_count_today)
REMAINING=$((BOUNCER_DAILY_CAP - VERIFIED_TODAY))

if [ "$REMAINING" -le 0 ]; then
  log_info "Skipping Bouncer: daily cap reached (${VERIFIED_TODAY}/${BOUNCER_DAILY_CAP})"
  exit 0
fi

# Check if there are leads to verify
PENDING_COUNT=$(get_pending_verify_count 2>/dev/null || echo "0")
if [ "$PENDING_COUNT" -eq 0 ]; then
  log_info "Skipping Bouncer: no leads pending verification (apollo_matched=0)"
  exit 0
fi

log_info "Starting Bouncer (pending: ${PENDING_COUNT}, remaining cap: ${REMAINING}/${BOUNCER_DAILY_CAP})"
start_timer

VERIFIED_BEFORE=$VERIFIED_TODAY

if BOUNCER_LIMIT="$REMAINING" node workspace/skills/bouncer/index.mjs; then
  log_info "Bouncer completed"
else
  handle_error "bouncer" "Bouncer"
fi

DURATION=$(get_duration)
VERIFIED_AFTER=$(get_verified_count_today)
VERIFIED_THIS_RUN=$((VERIFIED_AFTER - VERIFIED_BEFORE))
PT_AT="$(get_pt_timestamp)"

MSG="✅ [${PT_AT}] Bouncer done in ${DURATION}s. This run: +${VERIFIED_THIS_RUN} verified. Today: ${VERIFIED_AFTER}/${BOUNCER_DAILY_CAP}."
log_success "$MSG"
post_slack_report "$MSG"
