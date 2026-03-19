#!/usr/bin/env bash
set -euo pipefail

# Bouncer only: verify leads already in DB (e.g. from CSV import via Agent).
# No Apollo — use Agent + csv-import to add leads, then this runs daily to verify.

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
  post_slack_report "⏭️ [$(get_pt_timestamp)] Bouncer skipped: daily cap reached (${VERIFIED_TODAY}/${BOUNCER_DAILY_CAP})."
  exit 0
fi

log_info "Starting Bouncer (verify leads from DB, limit ${REMAINING}/${BOUNCER_DAILY_CAP})"
start_timer

VERIFIED_BEFORE=$(get_verified_count_today)

if BOUNCER_LIMIT="$REMAINING" node workspace/skills/bouncer/index.mjs; then
  log_info "Bouncer completed"
else
  handle_error "bouncer" "Bouncer"
fi

DURATION=$(get_duration)
VERIFIED_AFTER=$(get_verified_count_today)
VERIFIED_THIS_RUN=$((VERIFIED_AFTER - VERIFIED_BEFORE))
PT_AT="$(get_pt_timestamp)"

MSG="✅ [${PT_AT}] Bouncer done in ${DURATION}s. This run: verified ${VERIFIED_THIS_RUN}. Today: bouncer_verified ${VERIFIED_AFTER}/${BOUNCER_DAILY_CAP}."
log_success "$MSG"
post_slack_report "$MSG"
