#!/usr/bin/env bash
# Send sample Process Replies + Daily Report to Slack channel C0ALRRHK61X (test only).
# Usage (from repo root): ./scripts/test-report-slack.sh

set -euo pipefail

REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.env"
  set +a
fi

echo "Building and sending sample reports to C0ALRRHK61X..."
(cd "$REPO_ROOT/workspace" && node scripts/test-report-slack.mjs)
