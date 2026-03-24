#!/usr/bin/env bash
# Move leads stuck as failed due to Bouncer timeout or HTTP 402 (credits) back to bouncer_verified.
# Clears processing_error and sets email_status = deliverable (same as a successful verify).
#
# Matches processing_error (case-insensitive) when ALL of:
#   - processing_status = 'failed'
#   - AND (
#       message contains "timed out after 300s"   (batch poll timeout)
#       OR message contains "submit batch failed: 402" / Bouncer 402 payment / "Payment Required"
#     )
#
# Usage (from repo root):
#   DRY_RUN=1 ./scripts/repair-bouncer-failed-to-verified.sh    # count + sample only
#   BATCH_SIZE=500 ./scripts/repair-bouncer-failed-to-verified.sh
#
# Env: SUPABASE_DB_URL (required), BATCH_SIZE (default 500), DRY_RUN (default 0)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "❌ SUPABASE_DB_URL is not set (.env or environment)"
  exit 1
fi

BATCH_SIZE="${BATCH_SIZE:-500}"
DRY_RUN="${DRY_RUN:-0}"

cd "$REPO_ROOT/workspace"

export REPAIR_BATCH_SIZE="$BATCH_SIZE"
export REPAIR_DRY_RUN="$DRY_RUN"

node --input-type=module <<'NODE'
import pg from 'pg';

const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
const batchSize = Math.max(1, parseInt(process.env.REPAIR_BATCH_SIZE || '500', 10) || 500);
const dryRun = /^(1|true|yes)$/i.test(String(process.env.REPAIR_DRY_RUN || '').trim());

/** Rows we repair: failed + Bouncer timeout 300s OR 402 / payment required on submit */
const matchSql = `
  processing_status = 'failed'::lead_processing_status
  AND processing_error IS NOT NULL
  AND (
    processing_error ILIKE '%timed out after 300s%'
    OR processing_error ILIKE '%submit batch failed: 402%'
    OR processing_error ILIKE '%Bouncer submit batch failed: 402%'
    OR (
      processing_error ILIKE '%402%'
      AND processing_error ILIKE '%Payment Required%'
    )
  )
`;

const pool = new pg.Pool({ connectionString: conn });

try {
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM leads WHERE ${matchSql}`
  );
  const total = countRes.rows[0]?.c ?? 0;
  console.log(`\n📊 Matching failed leads (Bouncer timeout 300s or 402 submit): ${total}\n`);

  if (total === 0) {
    await pool.end();
    process.exit(0);
  }

  const sample = await pool.query(
    `SELECT id, LEFT(processing_error, 120) AS err_preview
     FROM leads WHERE ${matchSql}
     ORDER BY updated_at ASC NULLS FIRST
     LIMIT 5`
  );
  console.log('Sample (up to 5):');
  for (const row of sample.rows) {
    console.log(`  ${row.id}  ${row.err_preview}…`);
  }
  console.log('');

  if (dryRun) {
    console.log('DRY_RUN=1 — no updates. Unset DRY_RUN to apply.\n');
    await pool.end();
    process.exit(0);
  }

  let updatedTotal = 0;
  let round = 0;
  while (true) {
    round++;
    const res = await pool.query(
      `WITH pick AS (
         SELECT id FROM leads
         WHERE ${matchSql}
         ORDER BY updated_at ASC NULLS FIRST
         LIMIT $1
       )
       UPDATE leads AS l
       SET processing_status = 'bouncer_verified'::lead_processing_status,
           processing_error = NULL,
           email_status = 'deliverable'::email_status,
           updated_at = NOW()
       FROM pick
       WHERE l.id = pick.id
       RETURNING l.id`,
      [batchSize]
    );
    const n = res.rowCount ?? 0;
    if (n === 0) break;
    updatedTotal += n;
    console.log(`  Batch ${round}: updated ${n} row(s) (running total: ${updatedTotal})`);
  }

  console.log(`\n✅ Done. Total updated: ${updatedTotal}\n`);
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await pool.end();
}
NODE
