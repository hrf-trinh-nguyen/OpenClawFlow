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
async function getInstantlyLoadedCountToday(client) {
  var _a;
  const result = await client.query(
    `SELECT COUNT(*)::int AS c FROM leads
     WHERE processing_status = 'instantly_loaded'
       AND (updated_at AT TIME ZONE 'America/New_York')::date =
           (NOW() AT TIME ZONE 'America/New_York')::date`
  );
  return Number(((_a = result.rows[0]) == null ? void 0 : _a.c) ?? 0);
}
async function getLeadsReadyForCampaign(client, limit = 1e4) {
  const result = await client.query(
    `SELECT id, apollo_person_id, first_name, last_name, email, company_name,
            title, linkedin_url, email_status, processing_status,
            processing_error, batch_id, priority
     FROM leads
     WHERE processing_status = 'bouncer_verified'
       AND (blacklisted = false OR blacklisted IS NULL)
     ORDER BY priority DESC, created_at ASC
     LIMIT $1`,
    [limit]
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
function parseIntSafe(value, fallback) {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}
var REPORT_TIMEZONE = "America/New_York";
function getTodayDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(/* @__PURE__ */ new Date());
}
function getDateRange(fromEnv, toEnv, singleEnv) {
  if (fromEnv && toEnv) {
    const [y1, m1, d1] = fromEnv.split("-").map(Number);
    const [y2, m2, d2] = toEnv.split("-").map(Number);
    const minDate = new Date(Date.UTC(y1, (m1 || 1) - 1, d1 || 1));
    const maxDate = new Date(Date.UTC(y2, (m2 || 1) - 1, d2 || 1));
    maxDate.setUTCDate(maxDate.getUTCDate() + 1);
    return { min: minDate.toISOString(), max: maxDate.toISOString() };
  }
  if (singleEnv) {
    const [y2, m2, d2] = singleEnv.split("-").map(Number);
    const dayStart = new Date(Date.UTC(y2, (m2 || 1) - 1, d2 || 1));
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    return { min: dayStart.toISOString(), max: dayEnd.toISOString() };
  }
  const todayEastern = getTodayDateString();
  const [y, m, d] = todayEastern.split("-").map(Number);
  const localStart = new Date(y, (m || 1) - 1, d || 1);
  const localEnd = new Date(y, (m || 1) - 1, (d || 1) + 1);
  return { min: localStart.toISOString(), max: localEnd.toISOString() };
}

// lib/constants.ts
var CUSTOMER_REPLY_CATEGORIES = ["hot", "soft", "objection", "negative"];
var NON_REPLY_CATEGORIES = ["out_of_office", "auto_reply", "not_a_reply"];
var REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES
];
function isValidReplyCategory(category) {
  return REPLY_CATEGORIES.includes(category);
}
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
var HOT_REPLY_TEMPLATE = {
  BOOK_NOW_URL: "https://meet.designpickle.com/campaign/ob-demo?ref=outbound",
  COMPARE_URL: "https://designpickle.com/comparison"
};
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";
var PROMPTS = {
  CLASSIFICATION: `You are a strict classifier for outbound sales email replies. Your output must be precise and consistent.

## Step 1 \u2013 Is this a real reply from the prospect?
- If the message is an automatic reply (out of office, vacation, delivery receipt, "I'm away"), use: out_of_office or auto_reply.
- If it is a system/bounce or not a real message from a human prospect, use: not_a_reply.
- Only if it is a genuine human reply from the person we emailed, continue to Step 2.

## Step 2 \u2013 For real prospect replies only, choose ONE category:

**hot** \u2013 Prospect shows interest and is open to more conversation or next steps.
- Any expression of wanting more information or a conversation = hot.
- Examples that MUST be classified as hot: "I'd love to hear more", "Tell me more", "Interested", "Would like to learn more", "Sounds interesting", "Let's talk", "When can we chat?", "Send me more info", "Happy to discuss", "Reach out", "I'd like to know more", "Hear more about it".
- Rule: If the reply asks for more info, expresses interest, or invites contact \u2192 hot. Do NOT use objection for these.

**soft** \u2013 Prospect is interested but indicates a timing issue only (e.g. "reach out next month", "try me in Q3", "not right now but later", "we're busy until X").

**objection** \u2013 Prospect explicitly declines or says it is not a fit. No interest expressed.
- Examples: "Not a fit", "We use someone else", "Not interested", "No thanks", "We're all set", "Don't need this", "Won't work for us".
- Rule: Use objection ONLY when there is a clear decline. If the message contains interest phrases (hear more, tell me more, interested, learn more), it is hot, not objection.

**negative** \u2013 Unsubscribe, hard no, or explicit request to stop all contact.

## Examples (follow these strictly):
- "I'd love to hear more about it from you." \u2192 hot (expresses interest)
- "Tell me more about your offering." \u2192 hot
- "Not a fit for us right now." \u2192 objection (decline, no interest)
- "Reach out next quarter." \u2192 soft (timing)
- "Unsubscribe" or "Remove me" \u2192 negative

## Email to classify
Subject: {SUBJECT}
Body: {REPLY_TEXT}

Respond with a single JSON object only. No other text.
{ "category": "<one of: hot, soft, objection, negative, out_of_office, auto_reply, not_a_reply>", "confidence": <0-1 number>, "reason": "<one short line explaining why>" }`
};
var HOT_SIGNAL_PHRASES = [
  "love to hear more",
  "would love to hear more",
  "tell me more",
  "interested to hear more",
  "interested to learn",
  "would like to learn more",
  "would like to hear more",
  "sounds interesting",
  "let's talk",
  "when can we chat",
  "send me more",
  "i'm interested",
  "happy to discuss",
  "would like to know more",
  "reach out",
  "hear more about it"
];

// lib/slack-templates.ts
function buildProcessRepliesMessage(p) {
  const totalClassified = p.hot + p.soft + p.objection + p.negative + (p.outOfOffice ?? 0) + (p.autoReply ?? 0) + (p.notAReply ?? 0);
  const customerTotal = p.hot + p.soft + p.objection + p.negative;
  const notCustomer = (p.outOfOffice ?? 0) + (p.autoReply ?? 0) + (p.notAReply ?? 0);
  const lines = [
    `\u{1F4EC} *Process Replies Report*`,
    `Date: ${p.date}${p.runAtET ? `  \xB7  Run: ${p.runAtET}` : ""}${p.durationSec !== void 0 ? `  \xB7  ${p.durationSec}s` : ""}`,
    `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`,
    ``,
    `*Inbox*`,
    `\u2022 Unread (API): ${p.unreadCount ?? "\u2014"}`,
    `\u2022 Fetched this run: ${p.repliesFetched}`,
    `\u2022 Total classified: ${totalClassified}`,
    ``,
    `*Customer reply (classified)*`,
    `\u2022 Hot: ${p.hot}  \xB7  Soft: ${p.soft}  \xB7  Objection: ${p.objection}  \xB7  Negative: ${p.negative}`,
    `\u2022 Subtotal: ${customerTotal}`,
    ``,
    `*Not customer reply*`,
    `\u2022 Out of office: ${p.outOfOffice ?? 0}  \xB7  Auto-reply: ${p.autoReply ?? 0}  \xB7  Not a reply: ${p.notAReply ?? 0}`,
    `\u2022 Subtotal: ${notCustomer}`,
    ``,
    `*Actions*`,
    `\u2022 Auto-replied (hot): ${p.autoReplied}`,
    `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`
  ];
  return lines.join("\n");
}
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
function postToReportChannel(text) {
  const channel = process.env.SLACK_REPORT_CHANNEL || "";
  return postSlackMessage(channel, text);
}

// skills/instantly/index.ts
var INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;
var INSTANTLY_CAMPAIGN_ID = process.env.INSTANTLY_CAMPAIGN_ID;
var OPENAI_API_KEY = process.env.OPENAI_API_KEY;
var MODE = process.env.MODE || "all";
var LOAD_LIMIT = parseIntSafe(process.env.LOAD_LIMIT, DEFAULTS.LOAD_LIMIT);
var LOAD_DAILY_CAP = parseIntSafe(
  process.env.INSTANTLY_LOAD_DAILY_CAP,
  DEFAULTS.INSTANTLY_LOAD_DAILY_CAP
);
function validateEnv() {
  validateRequiredEnv(["INSTANTLY_API_KEY", "INSTANTLY_CAMPAIGN_ID", "SUPABASE_DB_URL"]);
  if ((MODE === "fetch" || MODE === "all") && !OPENAI_API_KEY) {
    console.error("\u274C OPENAI_API_KEY required for fetch/classify mode");
    process.exit(1);
  }
}
function getFetchDateRange() {
  return getDateRange(
    process.env.FETCH_DATE_FROM,
    process.env.FETCH_DATE_TO,
    process.env.FETCH_DATE || process.env.REPORT_DATE
  );
}
async function instantlyAddLeads(leads) {
  var _a;
  if (leads.length === 0) return { success: 0, failed: 0, successIds: [] };
  let totalSuccess = 0;
  let totalFailed = 0;
  const successIds = [];
  const batchSize = RATE_LIMITS.INSTANTLY_BULK_ADD_MAX;
  const totalBatches = Math.ceil(leads.length / batchSize);
  for (let offset = 0; offset < leads.length; offset += batchSize) {
    const batch = leads.slice(offset, offset + batchSize);
    const batchNum = Math.floor(offset / batchSize) + 1;
    const body = {
      campaign_id: INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      leads: batch.map((l) => ({
        email: l.email,
        first_name: l.first_name || null,
        last_name: l.last_name || null,
        company_name: l.company_name || null,
        personalization: l.title || null
      }))
    };
    try {
      const response = await fetch(API_ENDPOINTS.INSTANTLY.ADD_LEADS, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${INSTANTLY_API_KEY}`
        },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const uploaded = data.leads_uploaded ?? 0;
        const created = data.created_leads ?? [];
        totalSuccess += uploaded;
        const seen = /* @__PURE__ */ new Set();
        for (const c of created) {
          let leadId;
          if (typeof c.index === "number" && ((_a = batch[c.index]) == null ? void 0 : _a.id)) {
            leadId = batch[c.index].id;
          } else if (c.email) {
            const match = batch.find((l) => l.email && String(l.email).toLowerCase() === String(c.email).toLowerCase());
            leadId = match == null ? void 0 : match.id;
          }
          if (leadId && !seen.has(leadId)) {
            seen.add(leadId);
            successIds.push(leadId);
          }
        }
        const skipped = data.skipped_count ?? 0;
        const duped = data.duplicated_leads ?? 0;
        const invalid = data.invalid_email_count ?? 0;
        totalFailed += Math.max(0, batch.length - uploaded);
        if (successIds.length > 0 && successIds.length !== created.length) {
          console.log(`   \u26A0\uFE0F  Mapping: ${successIds.length} lead IDs from ${created.length} created_leads (deduped by id)`);
        }
        console.log(
          `   \u2705 Batch ${batchNum}/${totalBatches}: ${uploaded} uploaded (${successIds.length} confirmed for DB), ${skipped} skipped, ${duped} duped, ${invalid} invalid`
        );
      } else {
        totalFailed += batch.length;
        const msg = data.message || data.error || "";
        console.error(`   \u274C Batch ${batchNum}/${totalBatches} failed: ${response.status} ${msg}`);
      }
    } catch (error) {
      totalFailed += batch.length;
      console.error(`   \u274C Batch ${batchNum}/${totalBatches} error: ${error.message}`);
    }
    if (offset + batchSize < leads.length) {
      await sleep(RATE_LIMITS.INSTANTLY_DELAY_MS);
    }
  }
  return { success: totalSuccess, failed: totalFailed, successIds };
}
async function instantlyFetchReplies(limit = DEFAULTS.FETCH_LIMIT) {
  const params = new URLSearchParams({
    campaign_id: INSTANTLY_CAMPAIGN_ID || "",
    email_type: "received",
    sort_order: "asc",
    limit: String(limit)
  });
  const { min, max } = getFetchDateRange();
  params.set("min_timestamp_created", min);
  params.set("max_timestamp_created", max);
  const url = `${API_ENDPOINTS.INSTANTLY.EMAILS}?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${INSTANTLY_API_KEY}` }
  });
  if (!response.ok) {
    throw new Error(`Instantly fetch replies failed: ${response.status}`);
  }
  const data = await response.json();
  const raw = data.items || data.emails || [];
  return raw.map((e) => {
    var _a, _b;
    return {
      email_id: e.id,
      eaccount: e.eaccount || process.env.INSTANTLY_EACCOUNT || "",
      from_email: e.from_address_email || e.lead || e.from_email,
      body: (((_a = e.body) == null ? void 0 : _a.text) || ((_b = e.body) == null ? void 0 : _b.html) || "").trim(),
      subject: e.subject || "",
      thread_id: e.thread_id || e.id
    };
  });
}
async function instantlyGetUnreadCount() {
  const url = API_ENDPOINTS.INSTANTLY.UNREAD_COUNT(INSTANTLY_CAMPAIGN_ID || "");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${INSTANTLY_API_KEY}` }
  });
  if (!response.ok) {
    throw new Error(`Instantly unread count failed: ${response.status}`);
  }
  const data = await response.json();
  return typeof data.count === "number" ? data.count : data.unread_count ?? 0;
}
async function instantlyReplyToEmail(params) {
  const response = await fetch(API_ENDPOINTS.INSTANTLY.REPLY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INSTANTLY_API_KEY}`
    },
    body: JSON.stringify({
      reply_to_uuid: params.reply_to_uuid,
      eaccount: params.eaccount,
      subject: params.subject || "Re: Your inquiry",
      body: { html: params.body_html, text: params.body_text }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly reply failed: ${response.status} ${text}`);
  }
}
var OOO_SUBJECT_PATTERNS = /out of office|ooo|automatic reply|abwesenheit|réponse automatique/i;
var OOO_BODY_PATTERNS = /out of (the )?office|away from (my )?office|I am currently out|I will be out|back on \d|returning on \d|limited access to (my )?email/i;
var AUTO_REPLY_PATTERNS = /automatic reply|auto.reply|vacation reply|I'm away|I am away|delivery receipt|read receipt|this is an automated/i;
function getNonReplyCategory(subject, body) {
  const sub = (subject || "").trim();
  const text = (body || "").trim();
  const combined = `${sub} ${text}`.toLowerCase();
  if (OOO_SUBJECT_PATTERNS.test(sub) || OOO_BODY_PATTERNS.test(combined)) {
    return "out_of_office";
  }
  if (AUTO_REPLY_PATTERNS.test(combined)) {
    return "auto_reply";
  }
  return null;
}
async function classifyReply(subject, replyText) {
  var _a, _b, _c;
  const prompt = PROMPTS.CLASSIFICATION.replace("{SUBJECT}", subject || "(no subject)").replace("{REPLY_TEXT}", replyText || "(empty)");
  const response = await fetch(API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: CLASSIFICATION_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI API failed: ${response.status}`);
  }
  const data = await response.json();
  const content = ((_c = (_b = (_a = data.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) || "";
  const parsed = parseJsonSafe(content, {});
  let rawCategory = (parsed.category || "").trim().toLowerCase();
  if (!isValidReplyCategory(rawCategory)) rawCategory = "not_a_reply";
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  if (parsed.reason && (rawCategory === "objection" || rawCategory === "hot")) {
    console.log(`   [classify] ${rawCategory} (${confidence}): ${parsed.reason}`);
  }
  const bodyLower = (replyText || "").toLowerCase();
  const hasHotSignal = HOT_SIGNAL_PHRASES.some((phrase) => bodyLower.includes(phrase.toLowerCase()));
  const category = hasHotSignal && (rawCategory === "objection" || rawCategory === "soft") ? "hot" : rawCategory;
  return {
    category,
    confidence
  };
}
function buildHotReplyTemplate(firstName) {
  const name = firstName || "there";
  const { BOOK_NOW_URL, COMPARE_URL } = HOT_REPLY_TEMPLATE;
  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${BOOK_NOW_URL}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>\u{1F449} <a href="${COMPARE_URL}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},

You can schedule here: Book now
${BOOK_NOW_URL}

Have a look at this before we connect. Quickly covers us vs. alternatives.
\u{1F449} Compare Design Pickle
${COMPARE_URL}

See you then.
-Bryan Butvidas`;
  return { html, text };
}
async function runLoadService(db, runId) {
  console.log(`
\u{1F4E4} Load Service: Pushing verified leads to Instantly...
`);
  const loadedToday = await getInstantlyLoadedCountToday(db);
  const remainingDaily = Math.max(0, LOAD_DAILY_CAP - loadedToday);
  const limit = Math.min(LOAD_LIMIT, remainingDaily);
  if (limit === 0) {
    console.log(
      `\u2139\uFE0F  Daily cap reached: ${loadedToday}/${LOAD_DAILY_CAP} loaded today. Skipping load.
`
    );
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  const verifiedLeads = await getLeadsReadyForCampaign(db, limit);
  if (verifiedLeads.length === 0) {
    console.log("\u2139\uFE0F  No verified leads to load\n");
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  console.log(
    `\u{1F4CA} Found ${verifiedLeads.length} verified leads (limit ${limit}, daily cap ${LOAD_DAILY_CAP}, already loaded today: ${loadedToday})
`
  );
  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: "instantly",
    status: "running",
    input_count: verifiedLeads.length
  });
  try {
    const { success, failed, successIds } = await instantlyAddLeads(verifiedLeads);
    if (successIds.length > 0) {
      await batchUpdateLeadStatus(db, successIds, "instantly_loaded");
      await db.query(
        `UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [successIds]
      );
    }
    await updateServiceExecution(db, execId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      output_count: success,
      failed_count: failed
    });
    console.log(`
\u2705 Load complete: ${success} loaded, ${failed} failed
`);
    return { processed: verifiedLeads.length, succeeded: success, failed };
  } catch (error) {
    console.error(`
\u274C Load failed: ${error.message}
`);
    await updateServiceExecution(db, execId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      error_message: error.message
    });
    throw error;
  }
}
async function runFetchAndClassifyService(db, runId) {
  const { min, max } = getFetchDateRange();
  const dateLabel = process.env.FETCH_DATE_FROM && process.env.FETCH_DATE_TO ? `${process.env.FETCH_DATE_FROM} \u2192 ${process.env.FETCH_DATE_TO}` : process.env.FETCH_DATE || process.env.REPORT_DATE || "today";
  console.log(`
\u{1F4E5} Fetch & Classify: Processing replies (${dateLabel})...
`);
  let unreadCount;
  try {
    unreadCount = await instantlyGetUnreadCount();
    console.log(`   \u{1F4EC} Unread count: ${unreadCount}
`);
  } catch {
  }
  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: "instantly",
    status: "running"
  });
  try {
    const replies = await instantlyFetchReplies(100);
    if (replies.length === 0) {
      console.log(`\u2139\uFE0F  No replies for ${dateLabel}
`);
      await updateServiceExecution(db, execId, {
        status: "completed",
        completed_at: /* @__PURE__ */ new Date(),
        output_count: 0
      });
      return {
        processed: 0,
        hot: 0,
        soft: 0,
        objection: 0,
        negative: 0,
        out_of_office: 0,
        auto_reply: 0,
        not_a_reply: 0,
        unreadCount,
        dateLabel
      };
    }
    console.log(`\u{1F4CA} Found ${replies.length} replies
`);
    const threadIds = replies.map((r) => r.thread_id).filter(Boolean);
    const alreadyRepliedRes = threadIds.length > 0 ? await db.query(
      `SELECT thread_id FROM replies WHERE thread_id = ANY($1::text[]) AND replied_at IS NOT NULL`,
      [threadIds]
    ) : { rows: [] };
    const alreadyReplied = new Set(alreadyRepliedRes.rows.map((r) => r.thread_id));
    const toProcess = replies.filter((r) => !alreadyReplied.has(r.thread_id));
    if (alreadyReplied.size > 0) {
      console.log(`   \u23ED\uFE0F  Skipping ${alreadyReplied.size} already auto-replied
`);
    }
    if (toProcess.length === 0) {
      console.log(`\u2139\uFE0F  No new replies to process
`);
      await updateServiceExecution(db, execId, {
        status: "completed",
        completed_at: /* @__PURE__ */ new Date(),
        output_count: 0
      });
      return {
        processed: 0,
        hot: 0,
        soft: 0,
        objection: 0,
        negative: 0,
        out_of_office: 0,
        auto_reply: 0,
        not_a_reply: 0,
        unreadCount,
        dateLabel
      };
    }
    let hot = 0, soft = 0, objection = 0, negative = 0, out_of_office = 0, auto_reply = 0, not_a_reply = 0;
    for (const reply of toProcess) {
      try {
        const subject = reply.subject || "";
        const body = reply.body || "";
        const nonReply = getNonReplyCategory(subject, body);
        const classification = nonReply ? { category: nonReply, confidence: 1 } : await classifyReply(subject, body);
        console.log(`   ${reply.from_email}: ${classification.category} (${classification.confidence})`);
        const bodySnippet = body.substring(0, 500);
        const threadId = reply.thread_id || `thread-${Date.now()}`;
        await db.query(
          `INSERT INTO replies 
           (from_email, subject, body_snippet, thread_id, reply_category, category_confidence, 
            reply_text, timestamp, fetched_at, classified_at, email_id, eaccount)
           VALUES ($1, $2, $3, $4, $5::reply_category, $6, $3, NOW(), NOW(), NOW(), $7, $8)
           ON CONFLICT (thread_id) DO UPDATE SET
             reply_category = EXCLUDED.reply_category,
             category_confidence = EXCLUDED.category_confidence,
             classified_at = EXCLUDED.classified_at,
             email_id = COALESCE(EXCLUDED.email_id, replies.email_id),
             eaccount = COALESCE(EXCLUDED.eaccount, replies.eaccount),
             updated_at = NOW()`,
          [
            reply.from_email,
            subject,
            bodySnippet,
            threadId,
            classification.category,
            classification.confidence,
            reply.email_id || null,
            reply.eaccount || null
          ]
        );
        switch (classification.category) {
          case "hot":
            hot++;
            await handleHotLead(db, reply);
            break;
          case "soft":
            soft++;
            break;
          case "objection":
            objection++;
            break;
          case "negative":
            negative++;
            await blacklistLead(db, reply.from_email);
            break;
          case "out_of_office":
            out_of_office++;
            break;
          case "auto_reply":
            auto_reply++;
            break;
          case "not_a_reply":
            not_a_reply++;
            break;
        }
      } catch (error) {
        console.error(`   \u274C Error processing ${reply.from_email}: ${error.message}`);
      }
      await sleep(RATE_LIMITS.INSTANTLY_DELAY_MS);
    }
    await updateServiceExecution(db, execId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      output_count: toProcess.length
    });
    console.log(`
\u2705 Classification complete:`);
    console.log(
      `   Customer replies: Hot ${hot}, Soft ${soft}, Objection ${objection}, Negative ${negative}`
    );
    console.log(`   Not customer reply: Out of office ${out_of_office}, Auto-reply ${auto_reply}, Not a reply ${not_a_reply}
`);
    return {
      processed: toProcess.length,
      hot,
      soft,
      objection,
      negative,
      out_of_office,
      auto_reply,
      not_a_reply,
      unreadCount,
      dateLabel
    };
  } catch (error) {
    console.error(`
\u274C Fetch & classify failed: ${error.message}
`);
    await updateServiceExecution(db, execId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      error_message: error.message
    });
    throw error;
  }
}
async function handleHotLead(db, reply) {
  var _a, _b, _c;
  if (!reply.email_id || !reply.eaccount) {
    console.log(`   \u26A0\uFE0F  Skip reply (missing email_id/eaccount): ${reply.from_email}`);
    return;
  }
  try {
    const leadRes = await db.query(
      `SELECT first_name FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
      [reply.from_email]
    );
    const firstName = ((_b = (_a = leadRes.rows[0]) == null ? void 0 : _a.first_name) == null ? void 0 : _b.trim()) || "";
    const { html, text } = buildHotReplyTemplate(firstName);
    const subject = ((_c = reply.subject) == null ? void 0 : _c.startsWith("Re:")) ? reply.subject : `Re: ${reply.subject || "Your inquiry"}`;
    await instantlyReplyToEmail({
      reply_to_uuid: reply.email_id,
      eaccount: reply.eaccount,
      subject,
      body_html: html,
      body_text: text
    });
    await db.query(`UPDATE replies SET replied_at = NOW(), updated_at = NOW() WHERE thread_id = $1`, [reply.thread_id]);
    console.log(`   \u{1F4E4} Replied to hot lead: ${reply.from_email}`);
    await sleep(300);
  } catch (err) {
    console.error(`   \u274C Reply failed for ${reply.from_email}: ${err.message}`);
  }
}
async function blacklistLead(db, email) {
  const leadRes = await db.query(`SELECT id FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`, [email]);
  if (leadRes.rows.length > 0) {
    await db.query(
      `UPDATE leads SET blacklisted = true, blacklist_reason = 'negative_reply', updated_at = NOW() WHERE id = $1`,
      [leadRes.rows[0].id]
    );
    console.log(`   \u26D4 Blacklisted lead: ${email}`);
  }
}
async function main() {
  validateEnv();
  console.log(`
\u{1F680} Instantly Service Starting (MODE: ${MODE})
`);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const runId = await createPipelineRun(db, {
    run_type: `instantly_${MODE}`,
    triggered_by: "manual"
  });
  try {
    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0;
    let fetchResult = null;
    let fetchStartMs = Date.now();
    if (MODE === "load" || MODE === "all") {
      const result = await runLoadService(db, runId);
      totalProcessed += result.processed;
      totalSucceeded += result.succeeded;
      totalFailed += result.failed;
    }
    if (MODE === "fetch" || MODE === "all") {
      fetchStartMs = Date.now();
      const result = await runFetchAndClassifyService(db, runId);
      fetchResult = result;
      totalProcessed += result.processed;
      totalSucceeded += result.processed;
    }
    await updatePipelineRun(db, runId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalSucceeded,
      leads_failed: totalFailed
    });
    if (fetchResult && process.env.SLACK_REPORT_CHANNEL) {
      const dateForReport = process.env.FETCH_DATE || process.env.REPORT_DATE || (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const durationSec = Math.round((Date.now() - fetchStartMs) / 1e3);
      const runAtET = (/* @__PURE__ */ new Date()).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }) + " ET";
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
        durationSec
      });
      await postToReportChannel(msg);
    }
    console.log(`\u2705 Instantly Service Complete
`);
  } catch (error) {
    console.error(`
\u274C Instantly Service Failed: ${error.message}
`);
    await updatePipelineRun(db, runId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      error_message: error.message
    });
    process.exit(1);
  } finally {
    await db.end();
  }
}
main();
