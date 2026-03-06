#!/usr/bin/env node

/**
 * report-build — aggregate metrics from DB and save daily report
 *
 * Reads:  pipeline_runs, service_executions, replies, reply_classifications (by date)
 * Writes: daily_reports table, state/daily_report.json, state/daily_report_text
 *
 * Run from ~/.openclaw: node workspace/skills/report-build/index.mjs
 *
 * ENV: REPORT_DATE (optional, default: today, format YYYY-MM-DD)
 */

import { stateSet } from '../../lib/state.js';
import {
  getDb,
  getMetricsForReport,
  upsertDailyReport,
} from '../../lib/supabase-pipeline.js';

async function main() {
  const startTime = Date.now();
  const reportDate =
    process.env.REPORT_DATE || new Date().toISOString().split('T')[0];
  console.log(`Report Build – aggregating metrics for ${reportDate}`);

  const db = getDb();
  if (!db) {
    console.error('❌ SUPABASE_DB_URL not set; cannot read from DB');
    process.exit(1);
  }

  const metrics = await getMetricsForReport(db, reportDate);

  const person_ids_count = metrics.person_ids_count ?? 0;
  const leads_pulled = metrics.leads_pulled ?? 0;
  const leads_validated = metrics.leads_validated ?? 0;
  const leads_removed = metrics.leads_removed ?? 0;
  const pushed_ok = metrics.pushed_ok ?? 0;
  const pushed_failed = metrics.pushed_failed ?? 0;
  const replies_fetched = metrics.replies_fetched ?? 0;
  const hot_count = metrics.hot_count ?? 0;
  const soft_count = metrics.soft_count ?? 0;
  const objection_count = metrics.objection_count ?? 0;
  const negative_count = metrics.negative_count ?? 0;
  const dr = Number(metrics.deliverable_rate) || 0;
  const br = Number(metrics.bounce_rate) || 0;
  const nr = replies_fetched > 0 ? Math.round((negative_count / replies_fetched) * 10000) / 100 : 0;

  const report = {
    date: reportDate,
    apollo: {
      person_ids: person_ids_count,
      leads_with_email: leads_pulled,
    },
    bouncer: {
      validated: leads_validated,
      removed: leads_removed,
      deliverable_rate: `${dr.toFixed(1)}%`,
      bounce_rate: `${br.toFixed(2)}%`,
    },
    instantly: { pushed_ok, pushed_failed },
    replies: {
      fetched: replies_fetched,
      hot: hot_count,
      soft: soft_count,
      objection: objection_count,
      negative: negative_count,
      negative_rate: `${nr.toFixed(2)}%`,
    },
  };

  const text = [
    `*OpenClaw Daily Report — ${reportDate}*`,
    '',
    '*Lead Pipeline*',
    `• Apollo IDs found: ${person_ids_count}`,
    `• Leads with email: ${leads_pulled}`,
    `• Bouncer verified: ${leads_validated} (${dr.toFixed(1)}% deliverable)`,
    `• Removed: ${leads_removed} (bounce/invalid ≈ ${br.toFixed(2)}%)`,
    `• Pushed to Instantly: ${pushed_ok} ok / ${pushed_failed} failed`,
    '',
    '*Reply Processing*',
    `• Fetched: ${replies_fetched}`,
    `• Hot: ${hot_count}  |  Soft: ${soft_count}  |  Objection: ${objection_count}  |  Negative: ${negative_count} (rate ≈ ${nr.toFixed(2)}%)`,
  ].join('\n');

  await upsertDailyReport(db, reportDate, metrics, report);
  stateSet('daily_report', report);
  stateSet('daily_report_text', text);

  console.log('  [DB] Saved daily report.');
  console.log('  Report built and saved to state');
  console.log(`\n${text}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
