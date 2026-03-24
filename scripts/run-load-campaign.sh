#!/usr/bin/env bash
set -euo pipefail

# Load Campaign: push verified leads to Instantly.
# Cron: every 10 min from ~6 AM–11:55 PM US Eastern (+5 min vs Bouncer minutes — see crontab).
# Each run pushes at most LOAD_LIMIT leads (default 200); exits early when daily cap or no verified leads.
# Daily cap: INSTANTLY_LOAD_DAILY_CAP (default 600).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env
apply_limit_env_defaults

CAP="${INSTANTLY_LOAD_DAILY_CAP}"
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

# Limit per run: min of remaining cap and available verified leads (from .env / FALLBACK_LIMITS)
LOAD_LIMIT="${LOAD_LIMIT}"
if [ "$REMAINING" -lt "$LOAD_LIMIT" ]; then
  LOAD_LIMIT="$REMAINING"
fi

log_info "Starting Load (verified ready: ${VERIFIED_COUNT}, limit: ${LOAD_LIMIT}, remaining cap: ${REMAINING}/${CAP})"
start_timer

if LOAD_LIMIT="$LOAD_LIMIT" MODE=load node workspace/skills/instantly/index.mjs; then
  DURATION=$(get_duration)
  PT_AT="$(get_pt_timestamp)"
  MSG="✅ [${PT_AT}] Instantly load completed successfully (${DURATION}s)."
  log_success "$MSG"
  post_slack_report "$MSG"
else
  # Skill posts to SLACK_ALERT_CHANNEL on load failure; avoid duplicate from handle_error
  log_error "Instantly load failed (exit $?). See logs/load-campaign.log — check Slack alert channel if configured."
  exit 1
fi
