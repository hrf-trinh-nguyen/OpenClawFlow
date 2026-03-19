#!/usr/bin/env node

// lib/db/connection.ts
import { Pool } from "pg";
var pool = null;
function getDb() {
  if (!process.env.SUPABASE_DB_URL) {
    console.warn("\u26A0\uFE0F  SUPABASE_DB_URL not found in env");
    return null;
  }
  if (!pool) {
    const connString = process.env.SUPABASE_DB_URL.trim().replace(/^['"]|['"]$/g, "");
    pool = new Pool({ connectionString: connString });
    console.log("\u2705 PostgreSQL connection pool created");
  }
  return pool;
}

// lib/db/pipeline-runs.ts
async function createPipelineRun(client, run) {
  const result = await client.query(
    `INSERT INTO pipeline_runs 
     (run_type, target_count, status, triggered_by, icp_filters)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      run.run_type,
      run.target_count || null,
      run.status || "running",
      run.triggered_by || "manual",
      run.icp_filters ? JSON.stringify(run.icp_filters) : null
    ]
  );
  return result.rows[0].id;
}
async function updatePipelineRun(client, runId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;
  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== void 0) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.leads_processed !== void 0) {
    fields.push(`leads_processed = $${idx++}`);
    values.push(updates.leads_processed);
  }
  if (updates.leads_succeeded !== void 0) {
    fields.push(`leads_succeeded = $${idx++}`);
    values.push(updates.leads_succeeded);
  }
  if (updates.leads_failed !== void 0) {
    fields.push(`leads_failed = $${idx++}`);
    values.push(updates.leads_failed);
  }
  if (updates.error_message) {
    fields.push(`error_message = $${idx++}`);
    values.push(updates.error_message);
  }
  fields.push(`updated_at = NOW()`);
  values.push(runId);
  await client.query(
    `UPDATE pipeline_runs SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}
async function createServiceExecution(client, exec) {
  const result = await client.query(
    `INSERT INTO service_executions 
     (pipeline_run_id, service_name, status, input_count, batch_size)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      exec.pipeline_run_id || null,
      exec.service_name,
      exec.status || "running",
      exec.input_count || 0,
      exec.batch_size || null
    ]
  );
  return result.rows[0].id;
}
async function updateServiceExecution(client, execId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;
  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== void 0) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.output_count !== void 0) {
    fields.push(`output_count = $${idx++}`);
    values.push(updates.output_count);
  }
  if (updates.failed_count !== void 0) {
    fields.push(`failed_count = $${idx++}`);
    values.push(updates.failed_count);
  }
  if (updates.api_calls_made !== void 0) {
    fields.push(`api_calls_made = $${idx++}`);
    values.push(updates.api_calls_made);
  }
  if (updates.api_errors !== void 0) {
    fields.push(`api_errors = $${idx++}`);
    values.push(updates.api_errors);
  }
  if (updates.rate_limit_hits !== void 0) {
    fields.push(`rate_limit_hits = $${idx++}`);
    values.push(updates.rate_limit_hits);
  }
  if (updates.error_message) {
    fields.push(`error_message = $${idx++}`);
    values.push(updates.error_message);
  }
  if (updates.execution_metadata) {
    fields.push(`execution_metadata = $${idx++}`);
    values.push(JSON.stringify(updates.execution_metadata));
  }
  values.push(execId);
  await client.query(
    `UPDATE service_executions SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}

// lib/db/leads.ts
async function getLeadsByStatus(client, status, limit = 100) {
  const result = await client.query(
    `SELECT id, apollo_person_id, first_name, last_name, email, company_name, 
            title, linkedin_url, email_status, processing_status, 
            processing_error, batch_id, priority
     FROM leads
     WHERE processing_status = $1
     ORDER BY priority DESC, created_at ASC
     LIMIT $2`,
    [status, limit]
  );
  return result.rows;
}
async function batchUpdateLeadStatus(client, leadIds, newStatus, errorMessage) {
  if (leadIds.length === 0) return 0;
  const result = await client.query(
    `UPDATE leads 
     SET processing_status = $1, processing_error = $2, updated_at = NOW()
     WHERE id = ANY($3::uuid[])`,
    [newStatus, errorMessage || null, leadIds]
  );
  return result.rowCount || 0;
}

// lib/utils.ts
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function checkRequiredEnv(keys) {
  const missing = keys.filter((key) => !process.env[key]);
  return { valid: missing.length === 0, missing };
}
function validateRequiredEnv(keys) {
  const { valid, missing } = checkRequiredEnv(keys);
  if (!valid) {
    console.error(`\u274C Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}
function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function parseIntSafe(value, fallback) {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}
function dedupeByKey(items, keyFn) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function dedupeByEmail(items) {
  return dedupeByKey(items, (item) => normalizeEmail(item.email || ""));
}

// lib/constants.ts
var CUSTOMER_REPLY_CATEGORIES = ["hot", "soft", "objection", "negative"];
var NON_REPLY_CATEGORIES = ["out_of_office", "auto_reply", "not_a_reply"];
var REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES
];
var RATE_LIMITS = {
  INSTANTLY_BULK_ADD_MAX: 1e3,
  INSTANTLY_DELAY_MS: 500,
  APOLLO_MATCH_BATCH_SIZE: 10,
  APOLLO_DELAY_BETWEEN_PAGES_MS: 1e3,
  APOLLO_DELAY_BETWEEN_BATCHES_MS: 500,
  APOLLO_RATE_LIMIT_PAUSE_MS: 6e4,
  BOUNCER_BATCH_SIZE_MAX: 1e3,
  BOUNCER_POLL_INTERVAL_MS: 5e3,
  BOUNCER_MAX_WAIT_MS: 3e5,
  BOUNCER_DELAY_BETWEEN_BATCHES_MS: 1e3
};
var DEFAULTS = {
  TARGET_COUNT: 5,
  LOAD_LIMIT: 100,
  /** Max leads to push to Instantly per calendar day (PT). Env: INSTANTLY_LOAD_DAILY_CAP */
  INSTANTLY_LOAD_DAILY_CAP: 250,
  BOUNCER_BATCH_SIZE: 1e3,
  FETCH_LIMIT: 100
};
var SLACK_CHANNELS = {
  REPORT: process.env.SLACK_REPORT_CHANNEL || "",
  ALERT: process.env.SLACK_ALERT_CHANNEL || ""
};
var API_ENDPOINTS = {
  APOLLO: {
    SEARCH: "https://api.apollo.io/api/v1/mixed_people/api_search",
    BULK_MATCH: "https://api.apollo.io/api/v1/people/bulk_match"
  },
  BOUNCER: {
    SUBMIT_BATCH: "https://api.usebouncer.com/v1.1/email/verify/batch",
    GET_STATUS: (batchId) => `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}`,
    DOWNLOAD: (batchId) => `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}/download?download=all`
  },
  INSTANTLY: {
    ADD_LEADS: "https://api.instantly.ai/api/v2/leads/add",
    EMAILS: "https://api.instantly.ai/api/v2/emails",
    UNREAD_COUNT: (campaignId) => `https://api.instantly.ai/api/v2/emails/unread/count?campaign_id=${campaignId}`,
    REPLY: "https://api.instantly.ai/api/v2/emails/reply",
    ANALYTICS_DAILY: "https://api.instantly.ai/api/v2/campaigns/analytics/daily"
  },
  OPENAI: {
    CHAT_COMPLETIONS: "https://api.openai.com/v1/chat/completions"
  },
  SLACK: {
    POST_MESSAGE: "https://slack.com/api/chat.postMessage"
  }
};
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";

// skills/bouncer/index.ts
validateRequiredEnv(["BOUNCER_API_KEY", "SUPABASE_DB_URL"]);
var BOUNCER_API_KEY = process.env.BOUNCER_API_KEY;
var BOUNCER_BATCH_SIZE = clamp(
  parseIntSafe(process.env.BOUNCER_BATCH_SIZE, DEFAULTS.BOUNCER_BATCH_SIZE),
  1,
  RATE_LIMITS.BOUNCER_BATCH_SIZE_MAX
);
var BOUNCER_LIMIT = process.env.BOUNCER_LIMIT ? parseIntSafe(process.env.BOUNCER_LIMIT, 0) : 0;
async function bouncerSubmitBatch(emails) {
  const body = emails.map((email) => ({ email }));
  const response = await fetch(API_ENDPOINTS.BOUNCER.SUBMIT_BATCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": BOUNCER_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bouncer submit batch failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  if (!data.batchId) {
    throw new Error("Bouncer did not return batchId");
  }
  return data.batchId;
}
async function bouncerGetBatchStatus(batchId) {
  const response = await fetch(API_ENDPOINTS.BOUNCER.GET_STATUS(batchId), {
    headers: { "x-api-key": BOUNCER_API_KEY }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bouncer get batch status failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return { status: data.status || "unknown" };
}
async function bouncerDownloadResults(batchId) {
  const response = await fetch(API_ENDPOINTS.BOUNCER.DOWNLOAD(batchId), {
    headers: { "x-api-key": BOUNCER_API_KEY }
  });
  if (response.status === 405) {
    throw new Error("Bouncer batch not completed yet");
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bouncer download results failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}
async function bouncerPollBatch(batchId, maxWaitMs = RATE_LIMITS.BOUNCER_MAX_WAIT_MS) {
  const startTime = Date.now();
  const pollInterval = RATE_LIMITS.BOUNCER_POLL_INTERVAL_MS;
  console.log(`   \u23F3 Polling batch ${batchId}...`);
  while (Date.now() - startTime < maxWaitMs) {
    const { status } = await bouncerGetBatchStatus(batchId);
    if (status === "completed") {
      console.log(`   \u2705 Batch completed`);
      return bouncerDownloadResults(batchId);
    }
    if (status === "failed") {
      throw new Error("Bouncer batch failed");
    }
    console.log(`      Status: ${status}, waiting ${pollInterval / 1e3}s...`);
    await sleep(pollInterval);
  }
  throw new Error(`Bouncer batch timed out after ${maxWaitMs / 1e3}s`);
}
async function main() {
  console.log(`
\u{1F50D} Bouncer Service Starting`);
  console.log(`   Batch size: ${BOUNCER_BATCH_SIZE}
`);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const fetchLimit = BOUNCER_LIMIT > 0 ? BOUNCER_LIMIT : 1e4;
  if (BOUNCER_LIMIT > 0) {
    console.log(`   Daily limit: ${BOUNCER_LIMIT} (from BOUNCER_LIMIT)
`);
  }
  const pendingLeads = await getLeadsByStatus(db, "apollo_matched", fetchLimit);
  if (pendingLeads.length === 0) {
    console.log("\u2139\uFE0F  No leads pending verification (status=apollo_matched)\n");
    await db.end();
    return;
  }
  console.log(`\u{1F4CA} Found ${pendingLeads.length} leads pending verification
`);
  const runId = await createPipelineRun(db, {
    run_type: "bouncer_verify",
    triggered_by: "manual"
  });
  let totalProcessed = 0;
  let totalDeliverable = 0;
  let totalInvalid = 0;
  let apiCallsMade = 0;
  let apiErrors = 0;
  try {
    for (let i = 0; i < pendingLeads.length; i += BOUNCER_BATCH_SIZE) {
      const batch = pendingLeads.slice(i, i + BOUNCER_BATCH_SIZE);
      const batchNum = Math.floor(i / BOUNCER_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(pendingLeads.length / BOUNCER_BATCH_SIZE);
      console.log(`\u{1F50D} Processing batch ${batchNum}/${totalBatches} (${batch.length} leads)...`);
      const execId = await createServiceExecution(db, {
        pipeline_run_id: runId,
        service_name: "bouncer",
        status: "running",
        input_count: batch.length,
        batch_size: BOUNCER_BATCH_SIZE
      });
      try {
        const uniqueBatch = dedupeByEmail(batch);
        const dupInBatch = batch.length - uniqueBatch.length;
        if (dupInBatch > 0) {
          console.log(`   \u26A0\uFE0F  Skipped ${dupInBatch} duplicate email(s) in batch`);
        }
        const emails = uniqueBatch.map((l) => l.email).filter((e) => !!e);
        if (emails.length === 0) {
          console.log("   \u26A0\uFE0F  No valid emails in batch, skipping\n");
          await updateServiceExecution(db, execId, {
            status: "completed",
            completed_at: /* @__PURE__ */ new Date(),
            output_count: 0,
            failed_count: batch.length
          });
          continue;
        }
        const batchId = await bouncerSubmitBatch(emails);
        apiCallsMade++;
        console.log(`   \u2705 Submitted batch: ${batchId}`);
        const results = await bouncerPollBatch(batchId);
        apiCallsMade++;
        const deliverableIds = [];
        const failedIds = [];
        for (const result of results) {
          const lead = uniqueBatch.find((l) => l.email === result.email);
          if (!lead || !lead.id) continue;
          if (result.status === "deliverable") {
            deliverableIds.push(lead.id);
            totalDeliverable++;
          } else {
            failedIds.push(lead.id);
            totalInvalid++;
          }
        }
        if (deliverableIds.length > 0) {
          await batchUpdateLeadStatus(db, deliverableIds, "bouncer_verified");
          await db.query(
            `UPDATE leads SET email_status = 'deliverable' WHERE id = ANY($1::uuid[])`,
            [deliverableIds]
          );
        }
        if (failedIds.length > 0) {
          await batchUpdateLeadStatus(db, failedIds, "failed", "Email not deliverable");
          await db.query(
            `UPDATE leads SET email_status = 'undeliverable' WHERE id = ANY($1::uuid[])`,
            [failedIds]
          );
        }
        totalProcessed += uniqueBatch.length;
        console.log(
          `   \u2705 Batch ${batchNum} complete: ${deliverableIds.length} deliverable, ${failedIds.length} invalid`
        );
        console.log(
          `   \u{1F4CA} Progress: ${totalProcessed}/${pendingLeads.length} (${Math.round(totalProcessed / pendingLeads.length * 100)}%)
`
        );
        await updateServiceExecution(db, execId, {
          status: "completed",
          completed_at: /* @__PURE__ */ new Date(),
          output_count: deliverableIds.length,
          failed_count: failedIds.length,
          api_calls_made: 2
        });
      } catch (error) {
        apiErrors++;
        console.error(`   \u274C Batch ${batchNum} failed: ${error.message}
`);
        await updateServiceExecution(db, execId, {
          status: "failed",
          completed_at: /* @__PURE__ */ new Date(),
          api_errors: 1,
          error_message: error.message
        });
        const failedIds = batch.filter((l) => l.id).map((l) => l.id);
        if (failedIds.length > 0) {
          await batchUpdateLeadStatus(db, failedIds, "failed", `Bouncer error: ${error.message}`);
          totalInvalid += failedIds.length;
        }
        if (error.message.includes("402")) {
          console.log("   \u26A0\uFE0F  Insufficient credits, stopping\n");
          break;
        }
      }
      await sleep(RATE_LIMITS.BOUNCER_DELAY_BETWEEN_BATCHES_MS);
    }
    await updatePipelineRun(db, runId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalDeliverable,
      leads_failed: totalInvalid
    });
    const deliverableRate = totalProcessed > 0 ? (totalDeliverable / totalProcessed * 100).toFixed(1) : "0.0";
    console.log(`
\u2705 Bouncer Service Complete`);
    console.log(`   Total processed: ${totalProcessed} leads`);
    console.log(`   Deliverable: ${totalDeliverable} (${deliverableRate}%)`);
    console.log(`   Invalid: ${totalInvalid}`);
    console.log(`   API calls made: ${apiCallsMade}`);
    console.log(`   API errors: ${apiErrors}
`);
  } catch (error) {
    console.error(`
\u274C Bouncer Service Failed: ${error.message}
`);
    await updatePipelineRun(db, runId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
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
