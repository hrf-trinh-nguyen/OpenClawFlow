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
var LEAD_STATUS = {
  NEW: "new",
  APOLLO_MATCHED: "apollo_matched",
  BOUNCER_VERIFIED: "bouncer_verified",
  INSTANTLY_LOADED: "instantly_loaded",
  REPLIED: "replied",
  FAILED: "failed"
};
var LEAD_STATUSES = Object.values(LEAD_STATUS);
var BOUNCER_RESULT = {
  /** Email is valid and deliverable */
  DELIVERABLE: "deliverable",
  /** Email is invalid or does not exist */
  UNDELIVERABLE: "undeliverable",
  /** Email may be valid but has risk factors (catch-all, disposable, etc.) */
  RISKY: "risky",
  /** Bouncer could not determine status */
  UNKNOWN: "unknown"
};
var BOUNCER_AUTO_HANDLED = [BOUNCER_RESULT.DELIVERABLE, BOUNCER_RESULT.UNDELIVERABLE];
var EMAIL_STATUS = {
  DELIVERABLE: "deliverable",
  UNDELIVERABLE: "undeliverable",
  /** Bouncer `risky` — not treated as undeliverable; still `bouncer_verified`. */
  RISKY: "risky",
  /** Bouncer `unknown` or unrecognized status. */
  UNKNOWN: "unknown"
};
var FAILURE_REASON = {
  EMAIL_NOT_DELIVERABLE: "Email not deliverable",
  API_ERROR: "API error",
  TIMEOUT: "Timeout"
};
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
var LIMIT_ENV = {
  LOAD_LIMIT: "LOAD_LIMIT",
  INSTANTLY_LOAD_DAILY_CAP: "INSTANTLY_LOAD_DAILY_CAP",
  BOUNCER_DAILY_CAP: "BOUNCER_DAILY_CAP",
  /** Bouncer API chunk size (emails per submit). */
  BOUNCER_BATCH_SIZE: "BOUNCER_BATCH_SIZE",
  /** Max leads verified per cron run (shell `run-build-list.sh`; should align with batch size). */
  BOUNCER_PER_RUN_MAX: "BOUNCER_PER_RUN_MAX"
};
var FALLBACK_LIMITS = {
  LOAD_LIMIT: 200,
  INSTANTLY_LOAD_DAILY_CAP: 600,
  BOUNCER_DAILY_CAP: 600,
  /** Emails per Bouncer batch submit (API + cron pacing). */
  BOUNCER_BATCH_SIZE: 100,
  /** Max leads per `run-build-list.sh` invocation (cron retries every 10 min until daily cap). */
  BOUNCER_PER_RUN_MAX: 100
};
var DEFAULTS = {
  TARGET_COUNT: 5,
  /** Max verified leads per Instantly run — from `process.env.LOAD_LIMIT` or FALLBACK_LIMITS */
  LOAD_LIMIT: parseIntSafe(process.env[LIMIT_ENV.LOAD_LIMIT], FALLBACK_LIMITS.LOAD_LIMIT),
  /** Max pushes to Instantly per Eastern calendar day */
  INSTANTLY_LOAD_DAILY_CAP: parseIntSafe(
    process.env[LIMIT_ENV.INSTANTLY_LOAD_DAILY_CAP],
    FALLBACK_LIMITS.INSTANTLY_LOAD_DAILY_CAP
  ),
  /** Max bouncer_verified counted per Eastern day (shell/cron enforces) */
  BOUNCER_DAILY_CAP: parseIntSafe(
    process.env[LIMIT_ENV.BOUNCER_DAILY_CAP],
    FALLBACK_LIMITS.BOUNCER_DAILY_CAP
  ),
  BOUNCER_BATCH_SIZE: parseIntSafe(
    process.env[LIMIT_ENV.BOUNCER_BATCH_SIZE],
    FALLBACK_LIMITS.BOUNCER_BATCH_SIZE
  ),
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

// lib/slack-templates.ts
async function postSlackMessage(channel, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channel) return false;
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ channel, text })
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json.ok === true;
  } catch {
    return false;
  }
}
function postToAlertChannel(text) {
  const channel = process.env.SLACK_ALERT_CHANNEL || "";
  return postSlackMessage(channel, text);
}

// lib/errors.ts
var OpenClawError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OpenClawError";
  }
};
var ApiError = class extends OpenClawError {
  constructor(service, statusCode, message) {
    super(`[${service}] ${message}`);
    this.service = service;
    this.statusCode = statusCode;
    this.name = "ApiError";
  }
};
var BouncerApiError = class extends ApiError {
  constructor(operation, statusCode, message) {
    super("Bouncer", statusCode, `${operation}: ${message}`);
    this.operation = operation;
    this.name = "BouncerApiError";
  }
};
var PipelineAbortError = class extends OpenClawError {
  constructor(service, reason) {
    super(`Pipeline aborted in ${service}: ${reason}`);
    this.service = service;
    this.reason = reason;
    this.name = "PipelineAbortError";
  }
};
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

// skills/bouncer/api.ts
async function submitBatch(apiKey, emails) {
  const body = emails.map((email) => ({ email }));
  const response = await fetch(API_ENDPOINTS.BOUNCER.SUBMIT_BATCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new BouncerApiError("submit", response.status, `${response.status} ${text}`);
  }
  const data = await response.json();
  if (!data.batchId) {
    throw new BouncerApiError("submit", null, "Response missing batchId");
  }
  return data.batchId;
}
async function getBatchStatus(apiKey, batchId) {
  const response = await fetch(API_ENDPOINTS.BOUNCER.GET_STATUS(batchId), {
    headers: { "x-api-key": apiKey }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new BouncerApiError("poll", response.status, `${response.status} ${text}`);
  }
  const data = await response.json();
  return data.status || "unknown";
}
async function downloadResults(apiKey, batchId) {
  const response = await fetch(API_ENDPOINTS.BOUNCER.DOWNLOAD(batchId), {
    headers: { "x-api-key": apiKey }
  });
  if (response.status === 405) {
    throw new BouncerApiError("download", 405, "Batch not completed yet");
  }
  if (!response.ok) {
    const text = await response.text();
    throw new BouncerApiError("download", response.status, `${response.status} ${text}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}
async function pollBatch(apiKey, batchId, maxWaitMs = RATE_LIMITS.BOUNCER_MAX_WAIT_MS, onStatus) {
  const startTime = Date.now();
  const pollInterval = RATE_LIMITS.BOUNCER_POLL_INTERVAL_MS;
  while (Date.now() - startTime < maxWaitMs) {
    const status = await getBatchStatus(apiKey, batchId);
    if (status === "completed") {
      return downloadResults(apiKey, batchId);
    }
    if (status === "failed") {
      throw new BouncerApiError("poll", null, "Batch failed");
    }
    onStatus == null ? void 0 : onStatus(status);
    await sleep(pollInterval);
  }
  throw new BouncerApiError("timeout", null, `Batch timed out after ${maxWaitMs / 1e3}s`);
}
function partitionResults(results, batch, emailsSent) {
  const seen = /* @__PURE__ */ new Set();
  const deliverableIds = [];
  const failedIds = [];
  const riskyIds = [];
  const unknownIds = [];
  for (const result of results) {
    const email = typeof (result == null ? void 0 : result.email) === "string" ? result.email.trim() : "";
    if (!email) continue;
    seen.add(email);
    const status = String((result == null ? void 0 : result.status) ?? "").toLowerCase().trim();
    const lead = batch.find((l) => l.email === email);
    if (!(lead == null ? void 0 : lead.id)) continue;
    if (status === BOUNCER_RESULT.DELIVERABLE) {
      deliverableIds.push(lead.id);
    } else if (status === BOUNCER_RESULT.UNDELIVERABLE) {
      failedIds.push(lead.id);
    } else if (status === BOUNCER_RESULT.RISKY) {
      riskyIds.push(lead.id);
    } else if (status === BOUNCER_RESULT.UNKNOWN || status === "") {
      unknownIds.push(lead.id);
    } else {
      unknownIds.push(lead.id);
    }
  }
  for (const e of emailsSent) {
    if (!seen.has(e)) {
      return { ok: false, reason: `Response missing result row for \`${e}\`` };
    }
  }
  return { ok: true, deliverableIds, failedIds, riskyIds, unknownIds };
}

// skills/bouncer/pause.ts
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
var PAUSE_FILENAME = "bouncer-paused";
function getStateDir() {
  const root = process.env.OPENCLAW_HOME || process.cwd();
  return join(root, "state");
}
function getPauseFilePath() {
  return join(getStateDir(), PAUSE_FILENAME);
}
function writePauseFile(reason) {
  try {
    const dir = getStateDir();
    mkdirSync(dir, { recursive: true });
    const body = [
      `paused_at=${(/* @__PURE__ */ new Date()).toISOString()}`,
      `reason=${reason.replace(/\n/g, " ")}`,
      "",
      "Auto-cleared after a successful Bouncer run, or delete this file manually."
    ].join("\n");
    writeFileSync(getPauseFilePath(), body, "utf8");
    console.error(`   \u23F8\uFE0F  Bouncer paused: wrote ${getPauseFilePath()} \u2014 cron will skip until resolved.`);
  } catch (e) {
    console.error("   \u26A0\uFE0F  Could not write pause file:", e);
  }
}
function clearPauseFile() {
  try {
    const path = getPauseFilePath();
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`   \u2705 Cleared pause file: ${path}`);
    }
  } catch (e) {
    console.error("   \u26A0\uFE0F  Could not clear pause file:", e);
  }
}

// skills/bouncer/index.ts
validateRequiredEnv(["BOUNCER_API_KEY", "SUPABASE_DB_URL"]);
var BOUNCER_API_KEY = process.env.BOUNCER_API_KEY;
var BOUNCER_BATCH_SIZE = clamp(
  parseIntSafe(process.env.BOUNCER_BATCH_SIZE, DEFAULTS.BOUNCER_BATCH_SIZE),
  1,
  RATE_LIMITS.BOUNCER_BATCH_SIZE_MAX
);
var BOUNCER_LIMIT = process.env.BOUNCER_LIMIT ? parseIntSafe(process.env.BOUNCER_LIMIT, 0) : 0;
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
  const pendingLeads = await getLeadsByStatus(db, LEAD_STATUS.APOLLO_MATCHED, fetchLimit);
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
  let totalRisky = 0;
  let totalUnknown = 0;
  let totalInvalid = 0;
  let apiCallsMade = 0;
  let apiErrors = 0;
  let pipelineAborted = false;
  let abortReason = "";
  try {
    for (let i = 0; i < pendingLeads.length; i += BOUNCER_BATCH_SIZE) {
      if (pipelineAborted) break;
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
        const batchId = await submitBatch(BOUNCER_API_KEY, emails);
        apiCallsMade++;
        console.log(`   \u2705 Submitted batch: ${batchId}`);
        const results = await pollBatch(BOUNCER_API_KEY, batchId, RATE_LIMITS.BOUNCER_MAX_WAIT_MS, (status) => {
          console.log(`      Status: ${status}, waiting ${RATE_LIMITS.BOUNCER_POLL_INTERVAL_MS / 1e3}s...`);
        });
        apiCallsMade++;
        console.log(`   \u2705 Batch completed`);
        const part = partitionResults(results, uniqueBatch, emails);
        if (!part.ok) {
          const detail = `Batch ${batchNum}/${totalBatches} \u2014 ${part.reason}`;
          console.error(`   \u274C ${detail}
`);
          const slackText = [
            `\u{1F6A8} *Bouncer STOPPED* \u2014 incomplete Bouncer response (missing result row)`,
            detail,
            `Batch id: \`${batchId}\``,
            `_No further batches this run. Leads in this batch were not updated._`
          ].join("\n");
          await postToAlertChannel(slackText);
          await updateServiceExecution(db, execId, {
            status: "failed",
            completed_at: /* @__PURE__ */ new Date(),
            api_errors: 1,
            error_message: part.reason
          });
          abortReason = part.reason;
          pipelineAborted = true;
          break;
        }
        const { deliverableIds, failedIds, riskyIds, unknownIds } = part;
        if (deliverableIds.length > 0) {
          await batchUpdateLeadStatus(db, deliverableIds, LEAD_STATUS.BOUNCER_VERIFIED);
          await db.query(`UPDATE leads SET email_status = $1::email_status WHERE id = ANY($2::uuid[])`, [
            EMAIL_STATUS.DELIVERABLE,
            deliverableIds
          ]);
        }
        if (riskyIds.length > 0) {
          await batchUpdateLeadStatus(db, riskyIds, LEAD_STATUS.BOUNCER_VERIFIED);
          await db.query(`UPDATE leads SET email_status = $1::email_status WHERE id = ANY($2::uuid[])`, [
            EMAIL_STATUS.RISKY,
            riskyIds
          ]);
        }
        if (unknownIds.length > 0) {
          await batchUpdateLeadStatus(db, unknownIds, LEAD_STATUS.BOUNCER_VERIFIED);
          await db.query(`UPDATE leads SET email_status = $1::email_status WHERE id = ANY($2::uuid[])`, [
            EMAIL_STATUS.UNKNOWN,
            unknownIds
          ]);
        }
        if (failedIds.length > 0) {
          await batchUpdateLeadStatus(db, failedIds, LEAD_STATUS.FAILED, FAILURE_REASON.EMAIL_NOT_DELIVERABLE);
          await db.query(`UPDATE leads SET email_status = $1::email_status WHERE id = ANY($2::uuid[])`, [
            EMAIL_STATUS.UNDELIVERABLE,
            failedIds
          ]);
        }
        totalDeliverable += deliverableIds.length;
        totalRisky += riskyIds.length;
        totalUnknown += unknownIds.length;
        totalInvalid += failedIds.length;
        totalProcessed += uniqueBatch.length;
        console.log(
          `   \u2705 Batch ${batchNum} complete: ${deliverableIds.length} deliverable, ${riskyIds.length} risky, ${unknownIds.length} unknown, ${failedIds.length} undeliverable`
        );
        console.log(
          `   \u{1F4CA} Progress: ${totalProcessed}/${pendingLeads.length} (${Math.round(totalProcessed / pendingLeads.length * 100)}%)
`
        );
        await updateServiceExecution(db, execId, {
          status: "completed",
          completed_at: /* @__PURE__ */ new Date(),
          output_count: deliverableIds.length + riskyIds.length + unknownIds.length,
          failed_count: failedIds.length,
          api_calls_made: 2
        });
      } catch (error) {
        apiErrors++;
        const msg = getErrorMessage(error);
        console.error(`   \u274C Batch ${batchNum} failed: ${msg}
`);
        const slackText = [
          `\u{1F6A8} *Bouncer paused* \u2014 API/technical error (submit, poll, download, timeout, 402, batch failed, \u2026)`,
          `Batch *${batchNum}/${totalBatches}:* \`${msg}\``,
          `\u2022 Leads in this batch were *not* updated in the database.`,
          `\u2022 Cron will *skip* Bouncer until the issue is fixed (see \`state/bouncer-paused\`) or a successful run removes that file.`
        ].join("\n");
        await postToAlertChannel(slackText);
        writePauseFile(msg);
        await updateServiceExecution(db, execId, {
          status: "failed",
          completed_at: /* @__PURE__ */ new Date(),
          api_errors: 1,
          error_message: msg
        });
        abortReason = msg;
        pipelineAborted = true;
        break;
      }
      await sleep(RATE_LIMITS.BOUNCER_DELAY_BETWEEN_BATCHES_MS);
    }
    if (pipelineAborted) {
      await updatePipelineRun(db, runId, {
        status: "failed",
        completed_at: /* @__PURE__ */ new Date(),
        leads_processed: totalProcessed,
        leads_succeeded: totalDeliverable + totalRisky + totalUnknown,
        leads_failed: totalInvalid,
        error_message: abortReason
      });
      console.error(`
\u274C Bouncer aborted: ${abortReason}
`);
      throw new PipelineAbortError("bouncer", abortReason);
    }
    await updatePipelineRun(db, runId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalDeliverable + totalRisky + totalUnknown,
      leads_failed: totalInvalid
    });
    const verifiedTotal = totalDeliverable + totalRisky + totalUnknown;
    const deliverableRate = totalProcessed > 0 ? (totalDeliverable / totalProcessed * 100).toFixed(1) : "0.0";
    console.log(`
\u2705 Bouncer Service Complete`);
    console.log(`   Total processed: ${totalProcessed} leads`);
    console.log(`   Deliverable: ${totalDeliverable} (${deliverableRate}%)`);
    console.log(`   Risky (verified): ${totalRisky}`);
    console.log(`   Unknown (verified): ${totalUnknown}`);
    console.log(`   Verified total (deliverable+risky+unknown): ${verifiedTotal}`);
    console.log(`   Invalid (undeliverable): ${totalInvalid}`);
    console.log(`   API calls made: ${apiCallsMade}`);
    console.log(`   API errors: ${apiErrors}
`);
    clearPauseFile();
    await db.end();
  } catch (error) {
    const msg = getErrorMessage(error);
    if (error instanceof PipelineAbortError) {
      await db.end();
      process.exit(1);
    }
    console.error(`
\u274C Bouncer Service Failed: ${msg}
`);
    await updatePipelineRun(db, runId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalDeliverable + totalRisky + totalUnknown,
      leads_failed: totalInvalid,
      error_message: msg
    });
    await postToAlertChannel(`\u{1F6A8} *Bouncer crashed*
${msg}`).catch(() => {
    });
    await db.end();
    process.exit(1);
  }
}
main();
