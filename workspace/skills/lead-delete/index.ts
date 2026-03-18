#!/usr/bin/env node

/**
 * Lead Delete Skill
 *
 * Delete leads by processing_status.
 * Shows available statuses when run without params.
 *
 * ENV: SUPABASE_DB_URL, DELETE_STATUS
 *
 * Run:
 *   node workspace/skills/lead-delete/index.mjs
 *   DELETE_STATUS=failed node workspace/skills/lead-delete/index.mjs
 */

import { getDb } from '../../lib/supabase-pipeline.js';
import { validateRequiredEnv } from '../../lib/utils.js';
import { LEAD_STATUSES, isValidLeadStatus } from '../../lib/constants.js';

function printUsage(): void {
  console.log('── Supported statuses (delete by) ──');
  for (const s of LEAD_STATUSES) {
    console.log(`  ${s}`);
  }
  console.log('\nUsage:');
  console.log('  DELETE_STATUS=<status> node workspace/skills/lead-delete/index.mjs');
  console.log('\nExamples:');
  console.log('  # Delete all failed leads');
  console.log('  DELETE_STATUS=failed node workspace/skills/lead-delete/index.mjs');
  console.log('\n  # Delete all apollo_matched (e.g. before re-collecting)');
  console.log('  DELETE_STATUS=apollo_matched node workspace/skills/lead-delete/index.mjs');
}

async function main() {
  validateRequiredEnv(['SUPABASE_DB_URL']);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  const deleteStatus = process.env.DELETE_STATUS?.trim().toLowerCase();

  console.log('\n🗑️  Lead Delete Skill\n');

  if (!deleteStatus) {
    printUsage();
    await db.end();
    return;
  }

  if (!isValidLeadStatus(deleteStatus)) {
    console.error(`❌ Invalid DELETE_STATUS: ${deleteStatus}`);
    console.error(`   Valid: ${LEAD_STATUSES.join(', ')}`);
    process.exit(1);
  }

  try {
    // Count before
    const countRes = await db.query(
      `SELECT COUNT(*) as c FROM leads WHERE processing_status = $1::lead_processing_status`,
      [deleteStatus]
    );
    const count = parseInt(countRes.rows[0]?.c ?? '0', 10);

    if (count === 0) {
      console.log(`ℹ️  No leads with status '${deleteStatus}'\n`);
      await db.end();
      return;
    }

    // Delete
    await db.query(
      `DELETE FROM leads WHERE processing_status = $1::lead_processing_status`,
      [deleteStatus]
    );

    console.log(`✅ Deleted ${count} lead(s) with status '${deleteStatus}'\n`);
    await db.end();
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
