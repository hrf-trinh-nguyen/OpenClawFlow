#!/usr/bin/env node

/**
 * Monthly Report — aggregate daily_reports for a month
 *
 * Usage:
 *   REPORT_YEAR=2026 REPORT_MONTH=3 node workspace/scripts/monthly-report.mjs
 *   (defaults to current year/month)
 */

import { getDb, getDailyReportsByMonth } from '../lib/supabase-pipeline.js';

async function main() {
  const year = parseInt(process.env.REPORT_YEAR || String(new Date().getFullYear()), 10);
  const month = parseInt(process.env.REPORT_MONTH || String(new Date().getMonth() + 1), 10);

  const db = getDb();
  if (!db) {
    console.error('❌ SUPABASE_DB_URL not set');
    process.exit(1);
  }

  const reports = await getDailyReportsByMonth(db, year, month);

  if (reports.length === 0) {
    console.log(`\n📊 Monthly Report — ${year}-${String(month).padStart(2, '0')}`);
    console.log('   No daily reports for this month.\n');
    return;
  }

  const totals = reports.reduce(
    (acc, r) => ({
      person_ids_count: acc.person_ids_count + (r.person_ids_count || 0),
      leads_pulled: acc.leads_pulled + (r.leads_pulled || 0),
      leads_validated: acc.leads_validated + (r.leads_validated || 0),
      leads_removed: acc.leads_removed + (r.leads_removed || 0),
      pushed_ok: acc.pushed_ok + (r.pushed_ok || 0),
      pushed_failed: acc.pushed_failed + (r.pushed_failed || 0),
      replies_fetched: acc.replies_fetched + (r.replies_fetched || 0),
      hot_count: acc.hot_count + (r.hot_count || 0),
      soft_count: acc.soft_count + (r.soft_count || 0),
      objection_count: acc.objection_count + (r.objection_count || 0),
      negative_count: acc.negative_count + (r.negative_count || 0),
    }),
    { person_ids_count: 0, leads_pulled: 0, leads_validated: 0, leads_removed: 0, pushed_ok: 0, pushed_failed: 0, replies_fetched: 0, hot_count: 0, soft_count: 0, objection_count: 0, negative_count: 0 }
  );

  const dr = totals.leads_pulled > 0 ? Math.round((totals.leads_validated / totals.leads_pulled) * 1000) / 10 : 0;
  const br = totals.leads_validated + totals.leads_removed > 0 ? Math.round((totals.leads_removed / (totals.leads_validated + totals.leads_removed)) * 10000) / 100 : 0;
  const nr = totals.replies_fetched > 0 ? Math.round((totals.negative_count / totals.replies_fetched) * 10000) / 100 : 0;

  const text = [
    `*OpenClaw Monthly Report — ${year}-${String(month).padStart(2, '0')}*`,
    `(${reports.length} days with data)`,
    '',
    '*Lead Pipeline (total)*',
    `• Apollo IDs found: ${totals.person_ids_count}`,
    `• Leads with email: ${totals.leads_pulled}`,
    `• Bouncer verified: ${totals.leads_validated} (${dr.toFixed(1)}% deliverable)`,
    `• Removed: ${totals.leads_removed} (bounce ≈ ${br.toFixed(2)}%)`,
    `• Pushed to Instantly: ${totals.pushed_ok} ok / ${totals.pushed_failed} failed`,
    '',
    '*Reply Processing (total)*',
    `• Fetched: ${totals.replies_fetched}`,
    `• Hot: ${totals.hot_count}  |  Soft: ${totals.soft_count}  |  Objection: ${totals.objection_count}  |  Negative: ${totals.negative_count} (rate ≈ ${nr.toFixed(2)}%)`,
  ].join('\n');

  console.log('\n' + text + '\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
