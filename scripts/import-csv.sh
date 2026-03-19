#!/usr/bin/env bash
# Import leads from CSV files in csv/ folder into the database.
# Usage: ./scripts/import-csv.sh [optional-specific-file.csv]
#
# If no argument is given, imports all *.csv files in csv/ folder.
# Sets processing_status = 'apollo_matched' so leads are ready for Bouncer.

set -euo pipefail

REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

# Load environment
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.env"
  set +a
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL not set in .env"
  exit 1
fi

echo ""
echo "=== CSV Import Tool ==="
echo ""

# If specific file provided, import only that file
if [ -n "${1:-}" ]; then
  if [ ! -f "$1" ]; then
    echo "ERROR: File not found: $1"
    exit 1
  fi
  echo "Importing single file: $1"
  node workspace/scripts/csv-import.mjs "$1"
  exit 0
fi

# Otherwise, import all CSV files in csv/ folder
CSV_DIR="$REPO_ROOT/csv"
if [ ! -d "$CSV_DIR" ]; then
  echo "ERROR: csv/ folder not found"
  exit 1
fi

CSV_FILES=("$CSV_DIR"/*.csv)
if [ ${#CSV_FILES[@]} -eq 0 ] || [ ! -f "${CSV_FILES[0]}" ]; then
  echo "No CSV files found in csv/ folder"
  exit 0
fi

echo "Found ${#CSV_FILES[@]} CSV file(s) in csv/"
echo ""

TOTAL_IMPORTED=0
TOTAL_FILES=0

for csv_file in "${CSV_FILES[@]}"; do
  if [ -f "$csv_file" ]; then
    TOTAL_FILES=$((TOTAL_FILES + 1))
    echo "────────────────────────────────────────"
    node workspace/scripts/csv-import.mjs "$csv_file"
  fi
done

echo "────────────────────────────────────────"
echo ""
echo "=== All done: processed $TOTAL_FILES file(s) ==="
echo ""
echo "Next step: run Bouncer to verify emails:"
echo "  node workspace/skills/bouncer/index.mjs"
echo ""
