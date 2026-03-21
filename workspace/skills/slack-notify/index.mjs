// lib/state.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
function getStateDir() {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  for (const levels of [2, 3]) {
    const root = resolve(scriptDir, ...Array(levels).fill(".."));
    const statePath = resolve(root, "state");
    if (existsSync(statePath)) return statePath;
  }
  return resolve(scriptDir, "../../..", "state");
}
var STATE_DIR = getStateDir();
function stateGet(key) {
  try {
    return JSON.parse(readFileSync(resolve(STATE_DIR, `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

// lib/utils.ts
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
var CUSTOMER_REPLY_CATEGORIES = ["hot", "soft", "objection", "negative"];
var NON_REPLY_CATEGORIES = ["out_of_office", "auto_reply", "not_a_reply"];
var REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES
];
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
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";

// skills/slack-notify/index.ts
async function main() {
  validateRequiredEnv(["SLACK_BOT_TOKEN", "SLACK_REPORT_CHANNEL"]);
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_REPORT_CHANNEL;
  const text = stateGet("daily_report_text") ?? "";
  if (!text) {
    console.error("\u274C No daily_report_text in state \u2014 run report-build first");
    process.exit(1);
  }
  console.log(`Slack Notify \u2013 sending report to channel ${channel}`);
  try {
    const resp = await fetch(API_ENDPOINTS.SLACK.POST_MESSAGE, {
      method: "POST",
      headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text })
    });
    if (!resp.ok) throw new Error(`Slack API ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(`Slack error: ${json.error}`);
    console.log(`  Report sent to channel ${channel}`);
    console.log("Done: report sent to Slack");
  } catch (err) {
    console.error(`\u274C Slack send failed: ${err.message}`);
    process.exit(1);
  }
}
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
