#!/usr/bin/env bash
# Run Supabase migration via connection string (SUPABASE_DB_URL).
# Use single-quoted value in .env if password has $ & ^ e.g. SUPABASE_DB_URL='postgresql://...'

set -e
cd "$(dirname "$0")/.."

# Load SUPABASE_DB_URL from .env (strip optional single quotes so $ & in password are preserved)
if [ -f .env ]; then
  line=$(grep -E '^SUPABASE_DB_URL=' .env | head -1)
  if [ -n "$line" ]; then
    val="${line#SUPABASE_DB_URL=}"
    val="${val#\'}"
    val="${val%\'}"
    export SUPABASE_DB_URL="$val"
  fi
fi

if [ -z "$SUPABASE_DB_URL" ]; then
  echo "Error: SUPABASE_DB_URL not set in .env"
  echo "Use: SUPABASE_DB_URL='postgresql://postgres:PASSWORD@host:5432/postgres' (single quotes if password has \$ or &)"
  exit 1
fi

MIGRATION="supabase/migrations/002_rule_tracking_fields.sql"
if [ ! -f "$MIGRATION" ]; then
  echo "Error: $MIGRATION not found"
  exit 1
fi

echo "Running migration: $MIGRATION"
psql "$SUPABASE_DB_URL" -f "$MIGRATION"
echo "Done. Migration applied."
