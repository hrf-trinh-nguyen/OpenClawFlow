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
import { RATE_LIMITS, DEFAULTS, API_ENDPOINTS } from '../../lib/constants.js';
import { postToAlertChannel } from '../../lib/slack-templates.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Bouncer API email result — only these are “expected” without human review (see docs.usebouncer.com). */
const BOUNCER_STATUS_DELIVERABLE = 'deliverable';
/** Treated as normal “bad email” → same as our DB reason `Email not deliverable`. */
const BOUNCER_STATUS_UNDELIVERABLE = 'undeliverable';

const PAUSE_FILENAME = 'bouncer-paused';

function repoRootForState(): string {
  return process.env.OPENCLAW_HOME || process.cwd();
}

/**
 * On API errors only (submit/poll/download/timeout/402/…): pauses subsequent Bouncer cron runs
 * until `run-build-list.sh` succeeds (removes file) or you delete `state/bouncer-paused` manually.
 * Not used for unexpected per-email statuses from results (partition path) — API failures only.
 */
function writeBouncerApiPauseFile(reason: string): void {
  try {
    const dir = join(repoRootForState(), 'state');
    mkdirSync(dir, { recursive: true });
    const body = [
      `paused_at=${new Date().toISOString()}`,
      `reason=${reason.replace(/\n/g, ' ')}`,
      '',
      'Auto-cleared after a successful Bouncer run, or delete this file manually.',
    ].join('\n');
    writeFileSync(join(dir, PAUSE_FILENAME), body, 'utf8');
    console.error(
      `   ⏸️  Bouncer paused: wrote ${join(dir, PAUSE_FILENAME)} — cron will skip Bouncer until resolved.`
    );
  } catch (e) {
    console.error('   ⚠️  Could not write pause file:', e);
  }
}

// ── Configuration ──────────────────────────────────────────────────

validateRequiredEnv(['BOUNCER_API_KEY', 'SUPABASE_DB_URL']);

const BOUNCER_API_KEY = process.env.BOUNCER_API_KEY!;
const BOUNCER_BATCH_SIZE = clamp(
  parseIntSafe(process.env.BOUNCER_BATCH_SIZE, DEFAULTS.BOUNCER_BATCH_SIZE),
  1,
  RATE_LIMITS.BOUNCER_BATCH_SIZE_MAX
);
/** Max leads to verify this run (e.g. remaining daily cap from cron). No env = no limit. */
const BOUNCER_LIMIT = process.env.BOUNCER_LIMIT ? parseIntSafe(process.env.BOUNCER_LIMIT, 0) : 0;

// ── Bouncer API ────────────────────────────────────────────────────

async function bouncerSubmitBatch(emails: string[]): Promise<string> {
  const body = emails.map((email) => ({ email }));

  const response = await fetch(API_ENDPOINTS.BOUNCER.SUBMIT_BATCH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': BOUNCER_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bouncer submit batch failed: ${response.status} ${text}`);
  }

  const data = await response.json();

  if (!data.batchId) {
    throw new Error('Bouncer did not return batchId');
  }

  return data.batchId;
}

async function bouncerGetBatchStatus(batchId: string): Promise<{ status: string }> {
  const response = await fetch(API_ENDPOINTS.BOUNCER.GET_STATUS(batchId), {
    headers: { 'x-api-key': BOUNCER_API_KEY },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bouncer get batch status failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return { status: data.status || 'unknown' };
}

async function bouncerDownloadResults(batchId: string): Promise<any[]> {
  const response = await fetch(API_ENDPOINTS.BOUNCER.DOWNLOAD(batchId), {
    headers: { 'x-api-key': BOUNCER_API_KEY },
  });

  if (response.status === 405) {
    throw new Error('Bouncer batch not completed yet');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bouncer download results failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function bouncerPollBatch(
  batchId: string,
  maxWaitMs: number = RATE_LIMITS.BOUNCER_MAX_WAIT_MS
): Promise<any[]> {
  const startTime = Date.now();
  const pollInterval = RATE_LIMITS.BOUNCER_POLL_INTERVAL_MS;

  console.log(`   ⏳ Polling batch ${batchId}...`);

  while (Date.now() - startTime < maxWaitMs) {
    const { status } = await bouncerGetBatchStatus(batchId);

    if (status === 'completed') {
      console.log(`   ✅ Batch completed`);
      return bouncerDownloadResults(batchId);
    }

    if (status === 'failed') {
      throw new Error('Bouncer batch failed');
    }

    console.log(`      Status: ${status}, waiting ${pollInterval / 1000}s...`);
    await sleep(pollInterval);
  }

  throw new Error(`Bouncer batch timed out after ${maxWaitMs / 1000}s`);
}

type PartitionResult =
  | { ok: true; deliverableIds: string[]; failedIds: string[] }
  | { ok: false; reason: string };

/**
 * Only `deliverable` and `undeliverable` are treated as normal outcomes.
 * `risky` / `unknown` / anything else → abort (avoid burning credits on ambiguous results).
 */
function partitionBouncerResults(
  results: any[],
  uniqueBatch: { id?: string; email?: string | null }[],
  emailsSent: string[]
): PartitionResult {
  const seen = new Set<string>();
  const deliverableIds: string[] = [];
  const failedIds: string[] = [];

  for (const result of results) {
    const email = typeof result?.email === 'string' ? result.email.trim() : '';
    if (!email) continue;
    seen.add(email);
    const norm = String(result?.status ?? '')
      .toLowerCase()
      .trim();
    const lead = uniqueBatch.find((l) => l.email === email);
    if (!lead?.id) continue;

    if (norm === BOUNCER_STATUS_DELIVERABLE) {
      deliverableIds.push(lead.id);
    } else if (norm === BOUNCER_STATUS_UNDELIVERABLE) {
      failedIds.push(lead.id);
    } else {
      return {
        ok: false,
        reason: `Unexpected Bouncer status "${norm || '(empty)'}" for \`${email}\`. Only deliverable + undeliverable are auto-handled; risky/unknown stops the run.`,
      };
    }
  }

  for (const e of emailsSent) {
    if (!seen.has(e)) {
      return { ok: false, reason: `Bouncer response missing result row for \`${e}\`` };
    }
  }

  return { ok: true, deliverableIds, failedIds };
}

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
  const pendingLeads = await getLeadsByStatus(db, 'apollo_matched', fetchLimit);

  if (pendingLeads.length === 0) {
    console.log('ℹ️  No leads pending verification (status=apollo_matched)\n');
    await db.end();
    return;
  }

  console.log(`📊 Found ${pendingLeads.length} leads pending verification\n`);

  // Create pipeline run
  const runId = await createPipelineRun(db, {
    run_type: 'bouncer_verify',
    triggered_by: 'manual'
  });

  let totalProcessed = 0;
  let totalDeliverable = 0;
  let totalInvalid = 0;
  let apiCallsMade = 0;
  let apiErrors = 0;
  let pipelineAborted = false;
  let abortReason = '';

  try {
    // Process in batches
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

        const batchId = await bouncerSubmitBatch(emails);
        apiCallsMade++;
        console.log(`   ✅ Submitted batch: ${batchId}`);

        const results = await bouncerPollBatch(batchId);
        apiCallsMade++;

        const part = partitionBouncerResults(results, uniqueBatch, emails);
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
          await batchUpdateLeadStatus(db, deliverableIds, 'bouncer_verified');
          await db.query(`UPDATE leads SET email_status = 'deliverable' WHERE id = ANY($1::uuid[])`, [
            deliverableIds,
          ]);
        }

        if (failedIds.length > 0) {
          await batchUpdateLeadStatus(db, failedIds, 'failed', 'Email not deliverable');
          await db.query(`UPDATE leads SET email_status = 'undeliverable' WHERE id = ANY($1::uuid[])`, [
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
      } catch (error: any) {
        apiErrors++;
        const msg = error?.message || String(error);
        console.error(`   ❌ Batch ${batchNum} failed: ${msg}\n`);

        const slackText = [
          `🚨 *Bouncer paused* — API/technical error (submit, poll, download, timeout, 402, batch failed, …)`,
          `Batch *${batchNum}/${totalBatches}:* \`${msg}\``,
          `• Leads in this batch were *not* updated in the database.`,
          `• Cron will *skip* Bouncer until the issue is fixed (see \`state/bouncer-paused\`) or a successful run removes that file.`,
        ].join('\n');
        await postToAlertChannel(slackText);
        writeBouncerApiPauseFile(msg);

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
      throw new Error('__BOUNCER_ABORT__');
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

    await db.end();
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (msg === '__BOUNCER_ABORT__') {
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
