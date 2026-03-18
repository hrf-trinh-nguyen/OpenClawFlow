#!/usr/bin/env node

/**
 * Lead Stats Skill
 *
 * Queries DB and aggregates lead counts by processing_status.
 * For failed leads: groups by processing_error (reason).
 *
 * ENV: SUPABASE_DB_URL
 *
 * Run: node workspace/skills/lead-stats/index.mjs
 */

import { getDb } from '../../lib/supabase-pipeline.js';
import { validateRequiredEnv, truncate } from '../../lib/utils.js';
import { LEAD_STATUSES } from '../../lib/constants.js';

function detectFailureStep(reason: string): string {
  if (reason.includes('Bouncer') || reason.includes('deliverable')) return 'Bouncer';
  if (reason.includes('Apollo')) return 'Apollo';
  if (reason.includes('Instantly')) return 'Instantly';
  return '?';
}

async function main() {
  validateRequiredEnv(['SUPABASE_DB_URL']);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  console.log('\n📊 Lead pipeline statistics\n');

  try {
    const statusRes = await db.query(
      `SELECT processing_status::text, COUNT(*) as count
       FROM leads
       GROUP BY processing_status
       ORDER BY processing_status`
    );

    let total = 0;
    console.log('── By status ──');
    for (const row of statusRes.rows) {
      const count = parseInt(row.count, 10);
      total += count;
      console.log(`  ${row.processing_status}: ${count}`);
    }
    console.log(`  TOTAL: ${total}\n`);

    const failedRes = await db.query(
      `SELECT COALESCE(processing_error, '(no error message)') as reason, COUNT(*) as count
       FROM leads
       WHERE processing_status = 'failed'
       GROUP BY processing_error
       ORDER BY count DESC`
    );

    if (failedRes.rows.length > 0) {
      console.log('── Failed leads by reason (processing_error) ──');
      console.log('   (Most failures are at Bouncer step: email verify)');
      for (const row of failedRes.rows) {
        const reason = row.reason || '(no error message)';
        const step = detectFailureStep(reason);
        console.log(`  ${row.count}: [${step}] ${truncate(reason, 80)}`);
      }
      console.log('');
    }

    await db.end();
    console.log('✅ Done\n');
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
