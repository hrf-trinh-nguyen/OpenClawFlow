#!/usr/bin/env node

/**
 * Bouncer Service
 *
 * Verifies emails using Bouncer batch API.
 * Database-driven: reads leads with processing_status='apollo_matched'
 * Updates to 'bouncer_verified' (deliverable) or 'failed' (invalid)
 *
 * ENV variables:
 * - BOUNCER_API_KEY: Bouncer API key
 * - BOUNCER_BATCH_SIZE: emails per API batch (default: 100, max: 1000 per Bouncer)
 * - BOUNCER_LIMIT: max leads to verify this run (cron sets min(remaining daily cap, BOUNCER_PER_RUN_MAX))
 * - SUPABASE_DB_URL: PostgreSQL connection string
 */

import {
  getDb,
  createPipelineRun,
  updatePipelineRun,
  createServiceExecution,
  updateServiceExecution,
  getLeadsByStatus,
  batchUpdateLeadStatus,
} from '../../lib/supabase-pipeline.js';
import { sleep, validateRequiredEnv, clamp, parseIntSafe, dedupeByEmail } from '../../lib/utils.js';
import {
  RATE_LIMITS,
  DEFAULTS,
  LEAD_STATUS,
  EMAIL_STATUS,
  FAILURE_REASON,
} from '../../lib/constants.js';
import { postToAlertChannel } from '../../lib/slack-templates.js';
import { PipelineAbortError, getErrorMessage } from '../../lib/errors.js';
import { submitBatch, pollBatch, partitionResults } from './api.js';
import { writePauseFile, clearPauseFile } from './pause.js';

// ── Configuration ──────────────────────────────────────────────────

validateRequiredEnv(['BOUNCER_API_KEY', 'SUPABASE_DB_URL']);

const BOUNCER_API_KEY = process.env.BOUNCER_API_KEY!;
const BOUNCER_BATCH_SIZE = clamp(
  parseIntSafe(process.env.BOUNCER_BATCH_SIZE, DEFAULTS.BOUNCER_BATCH_SIZE),
  1,
  RATE_LIMITS.BOUNCER_BATCH_SIZE_MAX
);
const BOUNCER_LIMIT = process.env.BOUNCER_LIMIT ? parseIntSafe(process.env.BOUNCER_LIMIT, 0) : 0;

// ── Main Service ───────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Bouncer Service Starting`);
  console.log(`   Batch size: ${BOUNCER_BATCH_SIZE}\n`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  const fetchLimit = BOUNCER_LIMIT > 0 ? BOUNCER_LIMIT : 10000;
  if (BOUNCER_LIMIT > 0) {
    console.log(`   Daily limit: ${BOUNCER_LIMIT} (from BOUNCER_LIMIT)\n`);
  }
  const pendingLeads = await getLeadsByStatus(db, LEAD_STATUS.APOLLO_MATCHED, fetchLimit);

  if (pendingLeads.length === 0) {
    console.log('ℹ️  No leads pending verification (status=apollo_matched)\n');
    await db.end();
    return;
  }

  console.log(`📊 Found ${pendingLeads.length} leads pending verification\n`);

  const runId = await createPipelineRun(db, {
    run_type: 'bouncer_verify',
    triggered_by: 'manual',
  });

  let totalProcessed = 0;
  let totalDeliverable = 0;
  let totalInvalid = 0;
  let apiCallsMade = 0;
  let apiErrors = 0;
  let pipelineAborted = false;
  let abortReason = '';

  try {
    for (let i = 0; i < pendingLeads.length; i += BOUNCER_BATCH_SIZE) {
      if (pipelineAborted) break;

      const batch = pendingLeads.slice(i, i + BOUNCER_BATCH_SIZE);
      const batchNum = Math.floor(i / BOUNCER_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pendingLeads.length / BOUNCER_BATCH_SIZE);

      console.log(`🔍 Processing batch ${batchNum}/${totalBatches} (${batch.length} leads)...`);

      const execId = await createServiceExecution(db, {
        pipeline_run_id: runId,
        service_name: 'bouncer',
        status: 'running',
        input_count: batch.length,
        batch_size: BOUNCER_BATCH_SIZE,
      });

      try {
        const uniqueBatch = dedupeByEmail(batch);
        const dupInBatch = batch.length - uniqueBatch.length;
        if (dupInBatch > 0) {
          console.log(`   ⚠️  Skipped ${dupInBatch} duplicate email(s) in batch`);
        }

        const emails = uniqueBatch.map((l) => l.email).filter((e): e is string => !!e);

        if (emails.length === 0) {
          console.log('   ⚠️  No valid emails in batch, skipping\n');
          await updateServiceExecution(db, execId, {
            status: 'completed',
            completed_at: new Date(),
            output_count: 0,
            failed_count: batch.length,
          });
          continue;
        }

        const batchId = await submitBatch(BOUNCER_API_KEY, emails);
        apiCallsMade++;
        console.log(`   ✅ Submitted batch: ${batchId}`);

        const results = await pollBatch(BOUNCER_API_KEY, batchId, RATE_LIMITS.BOUNCER_MAX_WAIT_MS, (status) => {
          console.log(`      Status: ${status}, waiting ${RATE_LIMITS.BOUNCER_POLL_INTERVAL_MS / 1000}s...`);
        });
        apiCallsMade++;
        console.log(`   ✅ Batch completed`);

        const part = partitionResults(results, uniqueBatch, emails);
        if (!part.ok) {
          const detail = `Batch ${batchNum}/${totalBatches} — ${part.reason}`;
          console.error(`   ❌ ${detail}\n`);
          const slackText = [
            `🚨 *Bouncer STOPPED* (unexpected result — not a normal undeliverable email)`,
            detail,
            `Batch id: \`${batchId}\``,
            `_No further batches this run. Leads in this batch were not updated._`,
          ].join('\n');
          await postToAlertChannel(slackText);
          await updateServiceExecution(db, execId, {
            status: 'failed',
            completed_at: new Date(),
            api_errors: 1,
            error_message: part.reason,
          });
          abortReason = part.reason;
          pipelineAborted = true;
          break;
        }

        const { deliverableIds, failedIds } = part;

        if (deliverableIds.length > 0) {
          await batchUpdateLeadStatus(db, deliverableIds, LEAD_STATUS.BOUNCER_VERIFIED);
          await db.query(`UPDATE leads SET email_status = $1 WHERE id = ANY($2::uuid[])`, [
            EMAIL_STATUS.DELIVERABLE,
            deliverableIds,
          ]);
        }

        if (failedIds.length > 0) {
          await batchUpdateLeadStatus(db, failedIds, LEAD_STATUS.FAILED, FAILURE_REASON.EMAIL_NOT_DELIVERABLE);
          await db.query(`UPDATE leads SET email_status = $1 WHERE id = ANY($2::uuid[])`, [
            EMAIL_STATUS.UNDELIVERABLE,
            failedIds,
          ]);
        }

        totalDeliverable += deliverableIds.length;
        totalInvalid += failedIds.length;
        totalProcessed += uniqueBatch.length;

        console.log(
          `   ✅ Batch ${batchNum} complete: ${deliverableIds.length} deliverable, ${failedIds.length} undeliverable`
        );
        console.log(
          `   📊 Progress: ${totalProcessed}/${pendingLeads.length} (${Math.round((totalProcessed / pendingLeads.length) * 100)}%)\n`
        );

        await updateServiceExecution(db, execId, {
          status: 'completed',
          completed_at: new Date(),
          output_count: deliverableIds.length,
          failed_count: failedIds.length,
          api_calls_made: 2,
        });
      } catch (error: unknown) {
        apiErrors++;
        const msg = getErrorMessage(error);
        console.error(`   ❌ Batch ${batchNum} failed: ${msg}\n`);

        const slackText = [
          `🚨 *Bouncer paused* — API/technical error (submit, poll, download, timeout, 402, batch failed, …)`,
          `Batch *${batchNum}/${totalBatches}:* \`${msg}\``,
          `• Leads in this batch were *not* updated in the database.`,
          `• Cron will *skip* Bouncer until the issue is fixed (see \`state/bouncer-paused\`) or a successful run removes that file.`,
        ].join('\n');
        await postToAlertChannel(slackText);
        writePauseFile(msg);

        await updateServiceExecution(db, execId, {
          status: 'failed',
          completed_at: new Date(),
          api_errors: 1,
          error_message: msg,
        });

        abortReason = msg;
        pipelineAborted = true;
        break;
      }

      await sleep(RATE_LIMITS.BOUNCER_DELAY_BETWEEN_BATCHES_MS);
    }

    if (pipelineAborted) {
      await updatePipelineRun(db, runId, {
        status: 'failed',
        completed_at: new Date(),
        leads_processed: totalProcessed,
        leads_succeeded: totalDeliverable,
        leads_failed: totalInvalid,
        error_message: abortReason,
      });
      console.error(`\n❌ Bouncer aborted: ${abortReason}\n`);
      throw new PipelineAbortError('bouncer', abortReason);
    }

    await updatePipelineRun(db, runId, {
      status: 'completed',
      completed_at: new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalDeliverable,
      leads_failed: totalInvalid,
    });

    const deliverableRate =
      totalProcessed > 0 ? ((totalDeliverable / totalProcessed) * 100).toFixed(1) : '0.0';

    console.log(`\n✅ Bouncer Service Complete`);
    console.log(`   Total processed: ${totalProcessed} leads`);
    console.log(`   Deliverable: ${totalDeliverable} (${deliverableRate}%)`);
    console.log(`   Invalid (undeliverable): ${totalInvalid}`);
    console.log(`   API calls made: ${apiCallsMade}`);
    console.log(`   API errors: ${apiErrors}\n`);

    clearPauseFile();
    await db.end();
  } catch (error: unknown) {
    const msg = getErrorMessage(error);

    if (error instanceof PipelineAbortError) {
      await db.end();
      process.exit(1);
    }

    console.error(`\n❌ Bouncer Service Failed: ${msg}\n`);

    await updatePipelineRun(db, runId, {
      status: 'failed',
      completed_at: new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalDeliverable,
      leads_failed: totalInvalid,
      error_message: msg,
    });

    await postToAlertChannel(`🚨 *Bouncer crashed*\n${msg}`).catch(() => {});

    await db.end();
    process.exit(1);
  }
}

main();
