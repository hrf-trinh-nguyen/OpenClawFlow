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
var LEAD_STATUSES = [
  "new",
  "apollo_matched",
  "bouncer_verified",
  "instantly_loaded",
  "replied",
  "failed"
];
function isValidLeadStatus(status) {
  return LEAD_STATUSES.includes(status);
}
var CUSTOMER_REPLY_CATEGORIES = ["hot", "soft", "objection", "negative"];
var NON_REPLY_CATEGORIES = ["out_of_office", "auto_reply", "not_a_reply"];
var REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES
];
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
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";

// skills/lead-delete/index.ts
function printUsage() {
  console.log("\u2500\u2500 Supported statuses (delete by) \u2500\u2500");
  for (const s of LEAD_STATUSES) {
    console.log(`  ${s}`);
  }
  console.log("\nUsage:");
  console.log("  DELETE_STATUS=<status> node workspace/skills/lead-delete/index.mjs");
  console.log("\nExamples:");
  console.log("  # Delete all failed leads");
  console.log("  DELETE_STATUS=failed node workspace/skills/lead-delete/index.mjs");
  console.log("\n  # Delete all apollo_matched (e.g. before re-collecting)");
  console.log("  DELETE_STATUS=apollo_matched node workspace/skills/lead-delete/index.mjs");
}
async function main() {
  var _a, _b;
  validateRequiredEnv(["SUPABASE_DB_URL"]);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const deleteStatus = (_a = process.env.DELETE_STATUS) == null ? void 0 : _a.trim().toLowerCase();
  console.log("\n\u{1F5D1}\uFE0F  Lead Delete Skill\n");
  if (!deleteStatus) {
    printUsage();
    await db.end();
    return;
  }
  if (!isValidLeadStatus(deleteStatus)) {
    console.error(`\u274C Invalid DELETE_STATUS: ${deleteStatus}`);
    console.error(`   Valid: ${LEAD_STATUSES.join(", ")}`);
    process.exit(1);
  }
  try {
    const countRes = await db.query(
      `SELECT COUNT(*) as c FROM leads WHERE processing_status = $1::lead_processing_status`,
      [deleteStatus]
    );
    const count = parseInt(((_b = countRes.rows[0]) == null ? void 0 : _b.c) ?? "0", 10);
    if (count === 0) {
      console.log(`\u2139\uFE0F  No leads with status '${deleteStatus}'
`);
      await db.end();
      return;
    }
    await db.query(
      `DELETE FROM leads WHERE processing_status = $1::lead_processing_status`,
      [deleteStatus]
    );
    console.log(`\u2705 Deleted ${count} lead(s) with status '${deleteStatus}'
`);
    await db.end();
  } catch (err) {
    console.error("\u274C Error:", err.message);
    process.exit(1);
  }
}
main();
