#!/usr/bin/env node

/**
 * Lead Move Skill
 *
 * Move leads from one processing_status to another.
 * Shows available statuses when run without params.
 *
 * ENV: SUPABASE_DB_URL, FROM_STATUS, TO_STATUS
 *
 * Run:
 *   node workspace/skills/lead-move/index.mjs
 *   FROM_STATUS=failed TO_STATUS=apollo_matched node workspace/skills/lead-move/index.mjs
 */

import { getDb } from '../../lib/supabase-pipeline.js';

const VALID_STATUSES = [
  'new',
  'apollo_matched',
  'bouncer_verified',
  'instantly_loaded',
  'replied',
  'failed'
] as const;

type Status = (typeof VALID_STATUSES)[number];

function isValidStatus(s: string): s is Status {
  return VALID_STATUSES.includes(s as Status);
}

async function main() {
  const db = getDb();
  if (!db) {
    console.error('❌ SUPABASE_DB_URL not found in env');
    process.exit(1);
  }

  const fromStatus = process.env.FROM_STATUS?.trim().toLowerCase();
  const toStatus = process.env.TO_STATUS?.trim().toLowerCase();

  console.log('\n📦 Lead Move Skill\n');

  // List statuses if no params
  if (!fromStatus || !toStatus) {
    console.log('── Supported statuses ──');
    for (const s of VALID_STATUSES) {
      console.log(`  ${s}`);
    }
    console.log('\nUsage:');
    console.log('  FROM_STATUS=<from> TO_STATUS=<to> node workspace/skills/lead-move/index.mjs');
    console.log('\nExamples:');
    console.log('  # Move failed leads back to apollo_matched (retry Bouncer)');
    console.log('  FROM_STATUS=failed TO_STATUS=apollo_matched node workspace/skills/lead-move/index.mjs');
    console.log('\n  # Reset failed to new');
    console.log('  FROM_STATUS=failed TO_STATUS=new node workspace/skills/lead-move/index.mjs');
    await db.end();
    return;
  }

  if (!isValidStatus(fromStatus)) {
    console.error(`❌ Invalid FROM_STATUS: ${fromStatus}`);
    console.error(`   Valid: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }
  if (!isValidStatus(toStatus)) {
    console.error(`❌ Invalid TO_STATUS: ${toStatus}`);
    console.error(`   Valid: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  if (fromStatus === toStatus) {
    console.error('❌ FROM_STATUS and TO_STATUS must be different');
    process.exit(1);
  }

  const limitRaw = process.env.LIMIT?.trim();
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : null;

  try {
    // Count before
    const countRes = await db.query(
      `SELECT COUNT(*) as c FROM leads WHERE processing_status = $1::lead_processing_status`,
      [fromStatus]
    );
    const count = parseInt(countRes.rows[0]?.c ?? '0', 10);

    if (count === 0) {
      console.log(`ℹ️  No leads with status '${fromStatus}'\n`);
      await db.end();
      return;
    }

    // Update (with optional LIMIT via subquery)
    const updateRes = await db.query(
      limit != null
        ? `UPDATE leads
           SET processing_status = $1::lead_processing_status, updated_at = NOW()
           WHERE id IN (
             SELECT id FROM leads
             WHERE processing_status = $2::lead_processing_status
             ORDER BY updated_at ASC
             LIMIT $3
           )
           RETURNING id`
        : `UPDATE leads
           SET processing_status = $1::lead_processing_status, updated_at = NOW()
           WHERE processing_status = $2::lead_processing_status
           RETURNING id`,
      limit != null ? [toStatus, fromStatus, limit] : [toStatus, fromStatus]
    );

    const updated = updateRes.rowCount ?? 0;
    console.log(`✅ Moved ${updated} lead(s) from '${fromStatus}' → '${toStatus}'\n`);
    await db.end();
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
