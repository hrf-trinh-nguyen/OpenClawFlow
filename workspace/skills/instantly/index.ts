#!/usr/bin/env node

/**
 * Instantly Service (Consolidated)
 *
 * Modes:
 * - load:    Push verified leads to Instantly campaign
 * - fetch:   Pull replies from Instantly inbox, classify via LLM, auto-reply hot leads
 * - all:     Run both load + fetch
 *
 * ENV variables:
 * - INSTANTLY_API_KEY: Instantly API key (required)
 * - INSTANTLY_CAMPAIGN_ID: Campaign ID (required)
 * - OPENAI_API_KEY: OpenAI API key for reply classification (required for fetch mode)
 * - SUPABASE_DB_URL: PostgreSQL connection string (required)
 * - MODE: 'load' | 'fetch' | 'all' (default: 'all')
 * - LOAD_LIMIT: Max verified leads to load per run (default: 200)
 * - INSTANTLY_LOAD_DAILY_CAP: Max leads to push per calendar day (US Eastern) (default: 600)
 * - FETCH_DATE: Single day YYYY-MM-DD (optional, defaults to today)
 * - FETCH_DATE_FROM + FETCH_DATE_TO: Date range (optional)
 * - PROCESS_REPLIES_SLACK_REPORT: set to 1/true for fetch mode to post the Process Replies template to
 *   SLACK_REPORT_CHANNEL (default: off — use evening cron only)
 */

import {
  getDb,
  createPipelineRun,
  updatePipelineRun,
} from '../../lib/supabase-pipeline.js';
import { validateRequiredEnv } from '../../lib/utils.js';
import { buildProcessRepliesMessage, postToReportChannel } from '../../lib/slack-templates.js';
import { runLoadService, type LoadResult } from './load.js';
import { runFetchAndClassifyService, type FetchResult } from './fetch.js';

// ── Configuration ──────────────────────────────────────────────────

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;
const INSTANTLY_CAMPAIGN_ID = process.env.INSTANTLY_CAMPAIGN_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODE = process.env.MODE || 'all';

// ── Validation ─────────────────────────────────────────────────────

function shouldPostProcessRepliesSlackReport(): boolean {
  return /^(1|true|yes)$/i.test(String(process.env.PROCESS_REPLIES_SLACK_REPORT || '').trim());
}

function validateEnv(): void {
  validateRequiredEnv(['INSTANTLY_API_KEY', 'INSTANTLY_CAMPAIGN_ID', 'SUPABASE_DB_URL']);
  if ((MODE === 'fetch' || MODE === 'all') && !OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY required for fetch/classify mode');
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnv();

  console.log(`\n🚀 Instantly Service Starting (MODE: ${MODE})\n`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  const runId = await createPipelineRun(db, {
    run_type: `instantly_${MODE}`,
    triggered_by: 'manual',
  });

  try {
    let totalProcessed = 0,
      totalSucceeded = 0,
      totalFailed = 0;
    let fetchResult: FetchResult | null = null;
    let fetchStartMs = Date.now();

    if (MODE === 'load' || MODE === 'all') {
      const result = await runLoadService(db, runId, INSTANTLY_API_KEY!, INSTANTLY_CAMPAIGN_ID!);
      totalProcessed += result.processed;
      totalSucceeded += result.succeeded;
      totalFailed += result.failed;
    }

    if (MODE === 'fetch' || MODE === 'all') {
      fetchStartMs = Date.now();
      const result = await runFetchAndClassifyService(
        db,
        runId,
        INSTANTLY_API_KEY!,
        INSTANTLY_CAMPAIGN_ID!,
        OPENAI_API_KEY!
      );
      fetchResult = result;
      totalProcessed += result.processed;
      totalSucceeded += result.processed;
    }

    await updatePipelineRun(db, runId, {
      status: 'completed',
      completed_at: new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalSucceeded,
      leads_failed: totalFailed,
    });

    // Post Process Replies report to Slack only when PROCESS_REPLIES_SLACK_REPORT=1 (evening cron)
    if (fetchResult && process.env.SLACK_REPORT_CHANNEL && shouldPostProcessRepliesSlackReport()) {
      const dateForReport =
        process.env.FETCH_DATE || process.env.REPORT_DATE || new Date().toISOString().split('T')[0];
      const durationSec = Math.round((Date.now() - fetchStartMs) / 1000);
      const runAtET =
        new Date().toLocaleString('en-US', {
          timeZone: 'America/New_York',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }) + ' ET';
      const msg = buildProcessRepliesMessage({
        date: dateForReport,
        unreadCount: fetchResult.unreadCount,
        repliesFetched: fetchResult.processed,
        hot: fetchResult.hot,
        soft: fetchResult.soft,
        objection: fetchResult.objection,
        negative: fetchResult.negative,
        outOfOffice: fetchResult.out_of_office,
        autoReply: fetchResult.auto_reply,
        notAReply: fetchResult.not_a_reply,
        autoReplied: fetchResult.hot,
        runAtET,
        durationSec,
      });
      await postToReportChannel(msg);
    }

    console.log(`✅ Instantly Service Complete\n`);
  } catch (error: any) {
    console.error(`\n❌ Instantly Service Failed: ${error.message}\n`);

    await updatePipelineRun(db, runId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error.message,
    });

    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
