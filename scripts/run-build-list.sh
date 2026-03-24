#!/usr/bin/env bash
set -euo pipefail

# Bouncer: verify leads already in DB (e.g. from CSV import via Agent).
# Cron: every 10 min from ~4 AM–11:50 PM US Eastern (see cron/crontab.example, UTC on VPS).
# Each run processes at most BOUNCER_PER_RUN_MAX leads (default 100); exits early when daily cap or no pending.
# No Apollo — use Agent + csv-import to add leads, then cron verifies.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
export OPENCLAW_HOME="${OPENCLAW_HOME:-$REPO_ROOT}"
load_env
apply_limit_env_defaults

# After an API error, the skill writes state/bouncer-paused; cron skips Bouncer (no API credits) until resolved
PAUSE_FILE="$OPENCLAW_HOME/state/bouncer-paused"
if [ -f "$PAUSE_FILE" ]; then
  log_info "Bouncer paused after API error — see $PAUSE_FILE. Fix the API and remove the file, or a successful run will remove it."
  exit 0
fi

BOUNCER_DAILY_CAP="${BOUNCER_DAILY_CAP}"
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

PER_RUN="${BOUNCER_PER_RUN_MAX:-100}"
if [ "$REMAINING" -gt "$PER_RUN" ]; then
  BOUNCER_LIMIT=$PER_RUN
else
  BOUNCER_LIMIT=$REMAINING
fi
export BOUNCER_LIMIT

log_info "Starting Bouncer (pending: ${PENDING_COUNT}, this run limit: ${BOUNCER_LIMIT}, remaining cap: ${REMAINING}/${BOUNCER_DAILY_CAP})"
start_timer

if node workspace/skills/bouncer/index.mjs; then
  rm -f "$PAUSE_FILE"
  log_info "Bouncer completed"
else
  # Skill posts to SLACK_ALERT_CHANNEL on abort; avoid duplicate alert from handle_error
  log_error "Bouncer failed (exit $?). See logs/build-list.log — check Slack alert channel if configured."
  exit 1
fi

DURATION=$(get_duration)
PT_AT="$(get_pt_timestamp)"

MSG="✅ [${PT_AT}] Bouncer completed successfully (${DURATION}s)."
log_success "$MSG"
post_slack_report "$MSG"
