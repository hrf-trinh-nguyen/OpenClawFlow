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
function parseIntSafe(value, fallback) {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
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
var CUSTOMER_REPLY_CATEGORIES = ["hot", "soft", "objection", "negative"];
var NON_REPLY_CATEGORIES = ["out_of_office", "auto_reply", "not_a_reply"];
var REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES
];
function isValidReplyCategory(category) {
  return REPLY_CATEGORIES.includes(category);
}
function isCustomerReplyCategory(category) {
  return CUSTOMER_REPLY_CATEGORIES.includes(category);
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
    /** GET — paginate with `limit` + `starting_after` (see Instantly API list campaigns) */
    CAMPAIGNS_LIST: "https://api.instantly.ai/api/v2/campaigns",
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
  BOOK_NOW_URL: "https://meet.designpickle.com/campaign/ob-demo-response",
  COMPARE_URL: "https://designpickle.com/comparison"
};
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";
var HOT_REPLY_GENERATION_MODEL = process.env.HOT_REPLY_GENERATION_MODEL || process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o-mini";
var HOT_REPLY_SIGN_OFF = process.env.HOT_REPLY_SIGN_OFF || "- Bryan Butvidas";

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
var InstantlyApiError = class extends ApiError {
  constructor(operation, statusCode, message) {
    super("Instantly", statusCode, `${operation}: ${message}`);
    this.operation = operation;
    this.name = "InstantlyApiError";
  }
  /** IDs of leads successfully processed before the error (for partial recovery) */
  partialSuccessIds = [];
  /** Attach IDs of leads that were successfully processed before the error */
  withPartialSuccess(ids) {
    this.partialSuccessIds = [...ids];
    return this;
  }
};

// skills/instantly/api.ts
async function replyToEmail(apiKey, params) {
  const replyToUuid = String(params.reply_to_uuid ?? "").trim();
  const eaccount = String(params.eaccount ?? "").trim();
  const bodyHtml = String(params.body_html ?? "").trim();
  const bodyText = String(params.body_text ?? "").trim();
  const subject = String(params.subject ?? "").trim() || "Re: Your inquiry";
  if (!replyToUuid || !eaccount) {
    throw new InstantlyApiError("reply", 400, "Missing or empty reply_to_uuid or eaccount");
  }
  if (!bodyHtml || !bodyText) {
    throw new InstantlyApiError("reply", 400, "Missing or empty body_html or body_text");
  }
  if (!String(apiKey ?? "").trim()) {
    throw new InstantlyApiError("reply", 401, "Missing or empty API key");
  }
  const response = await fetch(API_ENDPOINTS.INSTANTLY.REPLY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      reply_to_uuid: replyToUuid,
      eaccount,
      subject,
      body: { html: bodyHtml, text: bodyText }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new InstantlyApiError("reply", response.status, `${response.status} ${text}`);
  }
}

// skills/instantly/templates.ts
function hotReplyBodiesReadyForSend(html, text, opts) {
  var _a, _b;
  const bookUrl = ((_a = (opts == null ? void 0 : opts.bookUrl) ?? HOT_REPLY_TEMPLATE.BOOK_NOW_URL) == null ? void 0 : _a.trim()) ?? "";
  const compareUrl = ((_b = (opts == null ? void 0 : opts.compareUrl) ?? HOT_REPLY_TEMPLATE.COMPARE_URL) == null ? void 0 : _b.trim()) ?? "";
  if (!bookUrl || !compareUrl) return false;
  const h = (html ?? "").trim();
  const t = (text ?? "").trim();
  if (h.length < 10 || t.length < 10) return false;
  return h.includes(bookUrl) && h.includes(compareUrl) && t.includes(bookUrl) && t.includes(compareUrl);
}
function buildHotReplyTemplate(firstName) {
  var _a, _b;
  const bookUrl = ((_a = HOT_REPLY_TEMPLATE.BOOK_NOW_URL) == null ? void 0 : _a.trim()) ?? "";
  const compareUrl = ((_b = HOT_REPLY_TEMPLATE.COMPARE_URL) == null ? void 0 : _b.trim()) ?? "";
  if (!bookUrl || !compareUrl) {
    throw new Error("HOT_REPLY_TEMPLATE: BOOK_NOW_URL and COMPARE_URL must be non-empty strings");
  }
  const name = (firstName || "there").trim() || "there";
  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${bookUrl}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>\u{1F449} <a href="${compareUrl}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},

You can schedule here: Book now
${bookUrl}

Have a look at this before we connect. Quickly covers us vs. alternatives.
\u{1F449} Compare Design Pickle
${compareUrl}

See you then.
-Bryan Butvidas`;
  return { html, text };
}

// skills/reply-by-category/index.ts
validateRequiredEnv(["INSTANTLY_API_KEY", "SUPABASE_DB_URL"]);
var INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;
var REPLY_CATEGORY = (process.env.REPLY_CATEGORY || "hot").trim();
var REPLY_LIMIT = parseIntSafe(process.env.REPLY_LIMIT, 50);
var categories = REPLY_CATEGORY.split(",").map((c) => c.trim().toLowerCase()).filter((c) => c && isValidReplyCategory(c) && isCustomerReplyCategory(c));
if (categories.length === 0) {
  console.error("\u274C REPLY_CATEGORY must be one or more of: hot, soft, objection, negative");
  process.exit(1);
}
async function main() {
  var _a, _b;
  console.log(`
\u{1F4E4} Reply By Category`);
  console.log(`   Categories: ${categories.join(", ")}`);
  console.log(`   Limit: ${REPLY_LIMIT}
`);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const res = await db.query(
    `SELECT id, from_email, subject, thread_id, email_id, eaccount
     FROM replies
     WHERE reply_category = ANY($1::reply_category[])
       AND replied_at IS NULL
       AND email_id IS NOT NULL
       AND eaccount IS NOT NULL
       AND eaccount != ''
     ORDER BY classified_at DESC NULLS LAST
     LIMIT $2`,
    [categories, REPLY_LIMIT]
  );
  const rows = res.rows;
  if (rows.length === 0) {
    console.log("\u2139\uFE0F  No unreplied replies found for those categories (with email_id/eaccount).");
    console.log("   Tip: Only replies fetched after migration 011 have email_id stored.\n");
    await db.end();
    return;
  }
  console.log(`\u{1F4CA} Found ${rows.length} replies to send
`);
  let sent = 0;
  let failed = 0;
  const apiKey = String(INSTANTLY_API_KEY).trim();
  if (!apiKey) {
    console.error("\u274C INSTANTLY_API_KEY is empty after trim");
    await db.end();
    process.exit(1);
  }
  for (const row of rows) {
    try {
      const emailId = String(row.email_id ?? "").trim();
      const eaccount = String(row.eaccount ?? "").trim();
      if (!emailId || !eaccount) {
        failed++;
        console.error(`   \u274C Skip ${row.from_email}: missing email_id or eaccount`);
        continue;
      }
      const leadRes = await db.query(
        `SELECT first_name FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
        [row.from_email]
      );
      const firstName = ((_b = (_a = leadRes.rows[0]) == null ? void 0 : _a.first_name) == null ? void 0 : _b.trim()) || "";
      const { html, text } = buildHotReplyTemplate(firstName);
      if (!hotReplyBodiesReadyForSend(html, text)) {
        failed++;
        console.error(`   \u274C Skip ${row.from_email}: reply body failed validation (check HOT_REPLY_TEMPLATE URLs)`);
        continue;
      }
      const subjRaw = String(row.subject ?? "").trim();
      const subject = subjRaw.length > 0 ? subjRaw.startsWith("Re:") ? subjRaw : `Re: ${subjRaw}` : "Re: Your inquiry";
      await replyToEmail(apiKey, {
        reply_to_uuid: emailId,
        eaccount,
        subject,
        body_html: html.trim(),
        body_text: text.trim()
      });
      await db.query(`UPDATE replies SET replied_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
      sent++;
      console.log(`   \u2705 Replied to ${row.from_email}`);
      await sleep(300);
    } catch (err) {
      failed++;
      console.error(`   \u274C Failed ${row.from_email}: ${err.message}`);
    }
    await sleep(RATE_LIMITS.INSTANTLY_DELAY_MS);
  }
  console.log(`
\u2705 Done: ${sent} sent, ${failed} failed
`);
  await db.end();
}
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
