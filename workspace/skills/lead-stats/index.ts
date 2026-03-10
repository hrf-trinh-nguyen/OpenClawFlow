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

const VALID_STATUSES = [
  'new',
  'apollo_matched',
  'bouncer_verified',
  'instantly_loaded',
  'replied',
  'failed'
] as const;

async function main() {
  const db = getDb();
  if (!db) {
    console.error('❌ SUPABASE_DB_URL not found in env');
    process.exit(1);
  }

  console.log('\n📊 Lead pipeline statistics\n');

  try {
    // Count by processing_status
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

    // For failed: group by processing_error
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
        const reason = (row.reason || '(no error message)').slice(0, 80);
        const step = reason.includes('Bouncer') || reason.includes('deliverable') ? 'Bouncer' : reason.includes('Apollo') ? 'Apollo' : reason.includes('Instantly') ? 'Instantly' : '?';
        console.log(`  ${row.count}: [${step}] ${reason}${reason.length >= 80 ? '...' : ''}`);
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
