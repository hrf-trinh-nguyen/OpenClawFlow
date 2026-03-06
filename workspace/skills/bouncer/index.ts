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
 * - BOUNCER_BATCH_SIZE: batch size (default: 100, max: 100)
 * - SUPABASE_DB_URL: PostgreSQL connection string
 */

import { getDb, createPipelineRun, updatePipelineRun, createServiceExecution, updateServiceExecution, getLeadsByStatus, batchUpdateLeadStatus } from '../../lib/supabase-pipeline.js';

// ── Configuration ──────────────────────────────────────────────────

const BOUNCER_API_KEY = process.env.BOUNCER_API_KEY;
const BOUNCER_BATCH_SIZE = parseInt(process.env.BOUNCER_BATCH_SIZE || '100', 10);

if (!BOUNCER_API_KEY) {
  console.error('❌ BOUNCER_API_KEY not found in env');
  process.exit(1);
}

// ── Bouncer API ────────────────────────────────────────────────────

async function bouncerSubmitBatch(emails: string[]): Promise<string> {
  const url = 'https://api.usebouncer.com/v1.1/email/verify/batch';
  const body = emails.map((email) => ({ email }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': BOUNCER_API_KEY
    },
    body: JSON.stringify(body)
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
  const url = `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}`;

  const response = await fetch(url, {
    headers: { 'x-api-key': BOUNCER_API_KEY }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bouncer get batch status failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return { status: data.status || 'unknown' };
}

async function bouncerDownloadResults(batchId: string): Promise<any[]> {
  const url = `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}/download?download=all`;

  const response = await fetch(url, {
    headers: { 'x-api-key': BOUNCER_API_KEY }
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

async function bouncerPollBatch(batchId: string, maxWaitMs: number = 300000): Promise<any[]> {
  const startTime = Date.now();
  const pollInterval = 5000;

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
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Bouncer batch timed out after ${maxWaitMs / 1000}s`);
}

// ── Main Service ───────────────────────────────────────────────────

async function main() {
  console.log(`\\n🔍 Bouncer Service Starting`);
  console.log(`   Batch size: ${BOUNCER_BATCH_SIZE}\\n`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  // Check for leads pending verification
  const pendingLeads = await getLeadsByStatus(db, 'apollo_matched', 10000);
  
  if (pendingLeads.length === 0) {
    console.log('ℹ️  No leads pending verification (status=apollo_matched)\\n');
    await db.end();
    return;
  }

  console.log(`📊 Found ${pendingLeads.length} leads pending verification\\n`);

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

  try {
    // Process in batches
    for (let i = 0; i < pendingLeads.length; i += BOUNCER_BATCH_SIZE) {
      const batch = pendingLeads.slice(i, i + BOUNCER_BATCH_SIZE);
      const batchNum = Math.floor(i / BOUNCER_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pendingLeads.length / BOUNCER_BATCH_SIZE);
      
      console.log(`🔍 Processing batch ${batchNum}/${totalBatches} (${batch.length} leads)...`);

      const execId = await createServiceExecution(db, {
        pipeline_run_id: runId,
        service_name: 'bouncer',
        status: 'running',
        input_count: batch.length,
        batch_size: BOUNCER_BATCH_SIZE
      });

      try {
        // Validate: dedupe by email (no duplicate emails in batch)
        const seen = new Set<string>();
        const uniqueBatch = batch.filter((l) => {
          const e = (l.email || '').trim().toLowerCase();
          if (!e || seen.has(e)) return false;
          seen.add(e);
          return true;
        });
        const dupInBatch = batch.length - uniqueBatch.length;
        if (dupInBatch > 0) {
          console.log(`   ⚠️  Skipped ${dupInBatch} duplicate email(s) in batch`);
        }

        const emails = uniqueBatch.map(l => l.email).filter(e => e);
        
        if (emails.length === 0) {
          console.log('   ⚠️  No valid emails in batch, skipping\\n');
          await updateServiceExecution(db, execId, {
            status: 'completed',
            completed_at: new Date(),
            output_count: 0,
            failed_count: batch.length
          });
          continue;
        }

        const batchId = await bouncerSubmitBatch(emails);
        apiCallsMade++;
        console.log(`   ✅ Submitted batch: ${batchId}`);

        // Poll for results
        const results = await bouncerPollBatch(batchId);
        apiCallsMade++;

        // Process results
        const deliverableIds: string[] = [];
        const failedIds: string[] = [];

        for (const result of results) {
          const lead = uniqueBatch.find(l => l.email === result.email);
          if (!lead || !lead.id) continue;

          if (result.status === 'deliverable') {
            deliverableIds.push(lead.id);
            totalDeliverable++;
          } else {
            failedIds.push(lead.id);
            totalInvalid++;
          }
        }

        // Update lead statuses
        if (deliverableIds.length > 0) {
          await batchUpdateLeadStatus(db, deliverableIds, 'bouncer_verified');
          
          // Also update email_status column for backwards compatibility
          await db.query(
            `UPDATE leads SET email_status = 'deliverable' WHERE id = ANY($1::uuid[])`,
            [deliverableIds]
          );
        }

        if (failedIds.length > 0) {
          await batchUpdateLeadStatus(db, failedIds, 'failed', 'Email not deliverable');
          
          // Update email_status
          await db.query(
            `UPDATE leads SET email_status = 'undeliverable' WHERE id = ANY($1::uuid[])`,
            [failedIds]
          );
        }

        totalProcessed += uniqueBatch.length;

        console.log(`   ✅ Batch ${batchNum} complete: ${deliverableIds.length} deliverable, ${failedIds.length} invalid`);
        console.log(`   📊 Progress: ${totalProcessed}/${pendingLeads.length} (${Math.round(totalProcessed / pendingLeads.length * 100)}%)\\n`);

        await updateServiceExecution(db, execId, {
          status: 'completed',
          completed_at: new Date(),
          output_count: deliverableIds.length,
          failed_count: failedIds.length,
          api_calls_made: 2
        });

      } catch (error: any) {
        apiErrors++;
        console.error(`   ❌ Batch ${batchNum} failed: ${error.message}\\n`);

        await updateServiceExecution(db, execId, {
          status: 'failed',
          completed_at: new Date(),
          api_errors: 1,
          error_message: error.message
        });

        // Mark batch as failed
        const failedIds = batch.filter(l => l.id).map(l => l.id!);
        if (failedIds.length > 0) {
          await batchUpdateLeadStatus(db, failedIds, 'failed', `Bouncer error: ${error.message}`);
          totalInvalid += failedIds.length;
        }

        if (error.message.includes('402')) {
          console.log('   ⚠️  Insufficient credits, stopping\\n');
          break;
        }
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Update pipeline run
    await updatePipelineRun(db, runId, {
      status: 'completed',
      completed_at: new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalDeliverable,
      leads_failed: totalInvalid
    });

    const deliverableRate = totalProcessed > 0 
      ? (totalDeliverable / totalProcessed * 100).toFixed(1) 
      : '0.0';

    console.log(`\\n✅ Bouncer Service Complete`);
    console.log(`   Total processed: ${totalProcessed} leads`);
    console.log(`   Deliverable: ${totalDeliverable} (${deliverableRate}%)`);
    console.log(`   Invalid: ${totalInvalid}`);
    console.log(`   API calls made: ${apiCallsMade}`);
    console.log(`   API errors: ${apiErrors}\\n`);

  } catch (error: any) {
    console.error(`\\n❌ Bouncer Service Failed: ${error.message}\\n`);
    
    await updatePipelineRun(db, runId, {
      status: 'failed',
      completed_at: new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalDeliverable,
      leads_failed: totalInvalid,
      error_message: error.message
    });

    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
