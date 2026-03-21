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
async function getExistingEmails(client, emails) {
  if (emails.length === 0) return /* @__PURE__ */ new Set();
  const valid = emails.filter((e) => e && typeof e === "string").map((e) => e.trim().toLowerCase());
  if (valid.length === 0) return /* @__PURE__ */ new Set();
  const result = await client.query(
    `SELECT LOWER(TRIM(email)) as email FROM leads WHERE LOWER(TRIM(email)) = ANY($1::text[])`,
    [valid]
  );
  return new Set(result.rows.map((r) => r.email));
}
async function insertNewLeads(client, leads, options) {
  if (leads.length === 0) return { inserted: 0, skippedExisting: 0, skippedDuplicate: 0 };
  const emails = leads.map((l) => l.email).filter((e) => e && typeof e === "string");
  const existing = await getExistingEmails(client, emails);
  const blacklistRes = await client.query(
    `SELECT LOWER(TRIM(email)) as email FROM leads WHERE blacklisted = true AND email IS NOT NULL`
  );
  const blacklisted = new Set(blacklistRes.rows.map((r) => r.email));
  const newLeads = leads.filter(
    (l) => l.email && !existing.has(l.email.trim().toLowerCase()) && !blacklisted.has(l.email.trim().toLowerCase())
  );
  const skippedExisting = leads.length - newLeads.length;
  if (newLeads.length === 0) {
    return { inserted: 0, skippedExisting, skippedDuplicate: 0 };
  }
  const batchId = (options == null ? void 0 : options.batchId) ?? null;
  const priority = (options == null ? void 0 : options.priority) ?? 0;
  let inserted = 0;
  for (const lead of newLeads) {
    const res = await client.query(
      `INSERT INTO leads 
       (apollo_person_id, first_name, last_name, email, company_name, title, 
        linkedin_url, email_status, processing_status, processing_error, 
        batch_id, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        lead.apollo_person_id || null,
        lead.first_name || null,
        lead.last_name || null,
        lead.email || null,
        lead.company_name || null,
        lead.title || null,
        lead.linkedin_url || null,
        lead.email_status || null,
        lead.processing_status || "apollo_matched",
        lead.processing_error || null,
        batchId,
        priority
      ]
    );
    if (res.rowCount && res.rowCount > 0) inserted++;
  }
  return { inserted, skippedExisting, skippedDuplicate: 0 };
}

// lib/utils.ts
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
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
var LIMIT_ENV = {
  LOAD_LIMIT: "LOAD_LIMIT",
  INSTANTLY_LOAD_DAILY_CAP: "INSTANTLY_LOAD_DAILY_CAP",
  BOUNCER_DAILY_CAP: "BOUNCER_DAILY_CAP"
};
var FALLBACK_LIMITS = {
  LOAD_LIMIT: 200,
  INSTANTLY_LOAD_DAILY_CAP: 600,
  BOUNCER_DAILY_CAP: 600
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
var APOLLO_ICP_DEFAULTS = {
  PERSON_LOCATIONS: ["United States", "Canada"],
  ORGANIZATION_LOCATIONS: ["United States", "Canada"],
  ORGANIZATION_NUM_EMPLOYEES_RANGES: ["11,20", "21,50"],
  ORGANIZATION_INDUSTRY_TAG_IDS: [
    "5567cd4e7369643b70010000",
    // Computer Software
    "5567cd467369644d39040000",
    // Marketing & Advertising
    "5567ced173696450cb580000"
    // Retail
  ],
  CONTACT_EMAIL_STATUS: ["verified"],
  PERSON_TITLES: [
    "vp marketing",
    "head of marketing",
    "vp sales",
    "director of marketing",
    "director of sales"
  ]
};
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";

// skills/apollo/index.ts
validateRequiredEnv(["APOLLO_API_KEY", "SUPABASE_DB_URL"]);
var APOLLO_API_KEY = process.env.APOLLO_API_KEY;
var TARGET_COUNT = parseIntSafe(process.env.TARGET_COUNT, DEFAULTS.TARGET_COUNT);
var BATCH_ID = process.env.BATCH_ID || `apollo-${Date.now()}`;
var MAX_API_ERRORS = parseIntSafe(process.env.APOLLO_MAX_API_ERRORS, 30);
var PERSON_TITLES = process.env.PERSON_TITLES ? parseJsonSafe(
  process.env.PERSON_TITLES,
  [...APOLLO_ICP_DEFAULTS.PERSON_TITLES]
) : [...APOLLO_ICP_DEFAULTS.PERSON_TITLES];
var ORGANIZATION_INDUSTRY_TAG_IDS = process.env.ORGANIZATION_INDUSTRY_TAG_IDS ? parseJsonSafe(
  process.env.ORGANIZATION_INDUSTRY_TAG_IDS,
  [...APOLLO_ICP_DEFAULTS.ORGANIZATION_INDUSTRY_TAG_IDS]
) : [...APOLLO_ICP_DEFAULTS.ORGANIZATION_INDUSTRY_TAG_IDS];
async function apolloSearchPeople(page = 1, perPage = 100) {
  var _a, _b;
  const body = {
    page,
    per_page: perPage,
    person_titles: PERSON_TITLES,
    person_locations: APOLLO_ICP_DEFAULTS.PERSON_LOCATIONS,
    organization_locations: APOLLO_ICP_DEFAULTS.ORGANIZATION_LOCATIONS,
    organization_num_employees_ranges: APOLLO_ICP_DEFAULTS.ORGANIZATION_NUM_EMPLOYEES_RANGES,
    contact_email_status_v2: APOLLO_ICP_DEFAULTS.CONTACT_EMAIL_STATUS
  };
  if (ORGANIZATION_INDUSTRY_TAG_IDS.length > 0) {
    body.organization_industry_tag_ids = ORGANIZATION_INDUSTRY_TAG_IDS;
  }
  const response = await fetch(API_ENDPOINTS.APOLLO.SEARCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": APOLLO_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errBody = await response.text();
    let errMsg = `Apollo search failed: ${response.status} ${response.statusText}`;
    if (errBody) {
      const parsed = parseJsonSafe(errBody, null);
      errMsg += parsed ? ` \u2014 ${JSON.stringify(parsed)}` : ` \u2014 ${errBody.slice(0, 200)}`;
    }
    throw new Error(errMsg);
  }
  const data = await response.json();
  return {
    person_ids: (data.people || []).map((p) => p.id),
    total_pages: ((_a = data.pagination) == null ? void 0 : _a.total_pages) || 1,
    api_credits: ((_b = data.breadcrumb) == null ? void 0 : _b.total_results) || 0
  };
}
async function apolloBulkMatch(personIds) {
  if (personIds.length === 0) return [];
  const body = {
    details: personIds.map((id) => ({ id }))
  };
  const response = await fetch(API_ENDPOINTS.APOLLO.BULK_MATCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": APOLLO_API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errBody = await response.text();
    let errMsg = `Apollo bulk match failed: ${response.status} ${response.statusText}`;
    if (errBody) {
      const parsed = parseJsonSafe(errBody, null);
      errMsg += parsed ? ` \u2014 ${JSON.stringify(parsed)}` : ` \u2014 ${errBody.slice(0, 300)}`;
    }
    throw new Error(errMsg);
  }
  const data = await response.json();
  return (data.matches || []).map((match) => {
    var _a;
    return {
      apollo_person_id: match.id,
      first_name: match.first_name ?? "",
      last_name: match.last_name ?? "",
      email: match.email,
      company_name: ((_a = match.organization) == null ? void 0 : _a.name) ?? "",
      title: match.title ?? "",
      linkedin_url: match.linkedin_url ?? void 0,
      processing_status: "apollo_matched",
      batch_id: BATCH_ID
    };
  });
}
async function main() {
  console.log(`
\u{1F680} Apollo Service Starting`);
  console.log(`   Target: ${TARGET_COUNT} leads`);
  console.log(`   Titles: ${PERSON_TITLES.join(", ")}`);
  console.log(`   Person locations: ${APOLLO_ICP_DEFAULTS.PERSON_LOCATIONS.join(", ")}`);
  console.log(`   Company HQ: ${APOLLO_ICP_DEFAULTS.ORGANIZATION_LOCATIONS.join(", ")} | Employees: ${APOLLO_ICP_DEFAULTS.ORGANIZATION_NUM_EMPLOYEES_RANGES.join(", ")}`);
  if (ORGANIZATION_INDUSTRY_TAG_IDS.length > 0) {
    console.log(`   Industries: ${ORGANIZATION_INDUSTRY_TAG_IDS.length} tag(s)`);
  }
  console.log(`   Batch ID: ${BATCH_ID}
`);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const runId = await createPipelineRun(db, {
    run_type: "apollo_collection",
    target_count: TARGET_COUNT,
    triggered_by: "manual",
    icp_filters: {
      person_titles: PERSON_TITLES,
      person_locations: APOLLO_ICP_DEFAULTS.PERSON_LOCATIONS,
      organization_locations: APOLLO_ICP_DEFAULTS.ORGANIZATION_LOCATIONS,
      organization_num_employees_ranges: APOLLO_ICP_DEFAULTS.ORGANIZATION_NUM_EMPLOYEES_RANGES,
      organization_industry_tag_ids: ORGANIZATION_INDUSTRY_TAG_IDS
    }
  });
  console.log(`\u{1F4CA} Pipeline run created: ${runId}
`);
  let totalCollected = 0;
  let totalFailed = 0;
  let totalSkippedExisting = 0;
  let totalSkippedDuplicate = 0;
  let currentPage = 1;
  let apiCallsMade = 0;
  let apiErrors = 0;
  try {
    while (totalCollected < TARGET_COUNT) {
      const remaining = TARGET_COUNT - totalCollected;
      const perPage = Math.min(100, Math.max(1, remaining));
      console.log(`\u{1F50D} Searching page ${currentPage} (per_page=${perPage}, need ${remaining} more)...`);
      const execSearchId = await createServiceExecution(db, {
        pipeline_run_id: runId,
        service_name: "apollo",
        status: "running",
        batch_size: perPage
      });
      let searchResult;
      try {
        searchResult = await apolloSearchPeople(currentPage, perPage);
        apiCallsMade++;
        console.log(`   \u2705 Found ${searchResult.person_ids.length} person IDs`);
      } catch (error) {
        apiErrors++;
        console.error(`   \u274C Search failed: ${error.message}`);
        await updateServiceExecution(db, execSearchId, {
          status: "failed",
          completed_at: /* @__PURE__ */ new Date(),
          api_errors: 1,
          error_message: error.message
        });
        if (error.message.includes("429")) {
          console.log("   \u23F8\uFE0F  Rate limit hit, pausing 60 seconds...\n");
          await sleep(RATE_LIMITS.APOLLO_RATE_LIMIT_PAUSE_MS);
          continue;
        } else {
          break;
        }
      }
      if (searchResult.person_ids.length === 0) {
        console.log("   \u2139\uFE0F  No more results from Apollo\n");
        await updateServiceExecution(db, execSearchId, {
          status: "completed",
          completed_at: /* @__PURE__ */ new Date(),
          output_count: 0,
          api_calls_made: 1
        });
        break;
      }
      const matchBatchSize = RATE_LIMITS.APOLLO_MATCH_BATCH_SIZE;
      const neededForTarget = TARGET_COUNT - totalCollected;
      let pageLeads = [];
      for (let i = 0; i < searchResult.person_ids.length; i += matchBatchSize) {
        if (pageLeads.length >= neededForTarget) break;
        if (apiErrors >= MAX_API_ERRORS) {
          console.log(
            `   \u{1F6D1} Too many Apollo API errors (${apiErrors} >= ${MAX_API_ERRORS}). Stopping early to avoid burning credits.
`
          );
          break;
        }
        const batch = searchResult.person_ids.slice(i, i + matchBatchSize);
        console.log(`   \u{1F517} Matching batch ${Math.floor(i / matchBatchSize) + 1} (${batch.length} IDs)...`);
        const execMatchId = await createServiceExecution(db, {
          pipeline_run_id: runId,
          service_name: "apollo",
          status: "running",
          input_count: batch.length,
          batch_size: matchBatchSize
        });
        try {
          const leads = await apolloBulkMatch(batch);
          apiCallsMade++;
          pageLeads.push(...leads);
          console.log(`      \u2705 Matched ${leads.length} leads with emails`);
          await updateServiceExecution(db, execMatchId, {
            status: "completed",
            completed_at: /* @__PURE__ */ new Date(),
            output_count: leads.length,
            failed_count: batch.length - leads.length,
            api_calls_made: 1
          });
        } catch (error) {
          apiErrors++;
          console.error(`      \u274C Match failed: ${error.message}`);
          await updateServiceExecution(db, execMatchId, {
            status: "failed",
            completed_at: /* @__PURE__ */ new Date(),
            api_errors: 1,
            error_message: error.message
          });
          if (error.message.includes("429")) {
            console.log("      \u23F8\uFE0F  Rate limit hit, pausing 60 seconds...\n");
            await sleep(RATE_LIMITS.APOLLO_RATE_LIMIT_PAUSE_MS);
            i -= matchBatchSize;
            continue;
          }
          continue;
        }
        await sleep(RATE_LIMITS.APOLLO_DELAY_BETWEEN_BATCHES_MS);
      }
      if (pageLeads.length > 0) {
        const deduped = dedupeByEmail(pageLeads);
        const dupCount = pageLeads.length - deduped.length;
        totalSkippedDuplicate += dupCount;
        if (dupCount > 0) {
          console.log(`   \u26A0\uFE0F  Deduped ${dupCount} duplicate email(s) in batch`);
        }
        const needed = TARGET_COUNT - totalCollected;
        const toSave = deduped.slice(0, needed);
        const result = await insertNewLeads(db, toSave, { batchId: BATCH_ID });
        totalCollected += result.inserted;
        totalSkippedExisting += result.skippedExisting;
        console.log(
          `   \u{1F4BE} Inserted ${result.inserted} new | Skipped ${result.skippedExisting} existing (total new: ${totalCollected}/${TARGET_COUNT})`
        );
      }
      await updateServiceExecution(db, execSearchId, {
        status: "completed",
        completed_at: /* @__PURE__ */ new Date(),
        output_count: pageLeads.length,
        api_calls_made: 1
      });
      console.log(`   \u{1F4CA} Progress: ${totalCollected}/${TARGET_COUNT} (${Math.round(totalCollected / TARGET_COUNT * 100)}%)
`);
      if (totalCollected >= TARGET_COUNT) {
        console.log(`\u2705 Target reached! Collected ${totalCollected} leads.
`);
        break;
      }
      currentPage++;
      await sleep(RATE_LIMITS.APOLLO_DELAY_BETWEEN_PAGES_MS);
    }
    await updatePipelineRun(db, runId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      leads_processed: totalCollected,
      leads_succeeded: totalCollected,
      leads_failed: totalFailed
    });
    console.log(`
\u2705 Apollo Service Complete`);
    console.log(`   New leads inserted: ${totalCollected}`);
    console.log(`   Skipped (already in DB): ${totalSkippedExisting}`);
    console.log(`   Skipped (duplicate email in batch): ${totalSkippedDuplicate}`);
    console.log(`   API calls made: ${apiCallsMade}`);
    console.log(`   API errors: ${apiErrors}`);
    console.log(`   Status: apollo_matched`);
    console.log(`   Batch ID: ${BATCH_ID}
`);
  } catch (error) {
    console.error(`
\u274C Apollo Service Failed: ${error.message}
`);
    await updatePipelineRun(db, runId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      leads_processed: totalCollected,
      leads_succeeded: totalCollected,
      leads_failed: totalFailed,
      error_message: error.message
    });
    process.exit(1);
  } finally {
    await db.end();
  }
}
main();
