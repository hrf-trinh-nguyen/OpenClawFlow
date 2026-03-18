#!/usr/bin/env bash
set -euo pipefail

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

TARGET_COUNT="${TARGET_COUNT:-100}"

log_info "Starting build-list batch (TARGET_COUNT=${TARGET_COUNT})"
start_timer

if TARGET_COUNT="$TARGET_COUNT" node workspace/skills/apollo/index.mjs; then
  log_info "Apollo completed"
else
  handle_error "build-list" "Apollo"
fi

if node workspace/skills/bouncer/index.mjs; then
  log_info "Bouncer completed"
else
  handle_error "build-list" "Bouncer"
fi

DURATION=$(get_duration)
VERIFIED=$(get_verified_count_today)

MSG="✅ Build-list batch done in ${DURATION}s. Daily bouncer_verified count: ${VERIFIED}"
log_success "$MSG"
post_slack_report "$MSG"
