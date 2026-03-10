#!/usr/bin/env bash
# Check pipeline: leads by status + latest runs
# Run from repo root: ./scripts/check-pipeline-status.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "⚠️  SUPABASE_DB_URL not set in .env"
  exit 1
fi

echo "=== Lead pipeline status ==="
psql "$SUPABASE_DB_URL" -t -c "
  SELECT '  ' || processing_status || ': ' || COUNT(*)
  FROM leads
  GROUP BY processing_status
  ORDER BY processing_status;
"

echo ""
echo "=== Latest pipeline runs ==="
psql "$SUPABASE_DB_URL" -c "
  SELECT run_type, status, leads_succeeded, leads_failed,
         to_char(started_at, 'HH24:MI') as started
  FROM pipeline_runs
  ORDER BY started_at DESC
  LIMIT 5;
"
