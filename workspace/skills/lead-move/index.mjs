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
var LEAD_STATUS = {
  NEW: "new",
  APOLLO_MATCHED: "apollo_matched",
  BOUNCER_VERIFIED: "bouncer_verified",
  INSTANTLY_LOADED: "instantly_loaded",
  REPLIED: "replied",
  FAILED: "failed"
};
var LEAD_STATUSES = Object.values(LEAD_STATUS);
function isValidLeadStatus(status) {
  return LEAD_STATUSES.includes(status);
}
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

// skills/lead-move/index.ts
function printUsage() {
  console.log("\u2500\u2500 Supported statuses \u2500\u2500");
  for (const s of LEAD_STATUSES) {
    console.log(`  ${s}`);
  }
  console.log("\nUsage:");
  console.log("  FROM_STATUS=<from> TO_STATUS=<to> node workspace/skills/lead-move/index.mjs");
  console.log("\nExamples:");
  console.log("  # Move failed leads back to apollo_matched (retry Bouncer)");
  console.log("  FROM_STATUS=failed TO_STATUS=apollo_matched node workspace/skills/lead-move/index.mjs");
  console.log("\n  # Reset failed to new");
  console.log("  FROM_STATUS=failed TO_STATUS=new node workspace/skills/lead-move/index.mjs");
}
async function main() {
  var _a, _b, _c;
  validateRequiredEnv(["SUPABASE_DB_URL"]);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const fromStatus = (_a = process.env.FROM_STATUS) == null ? void 0 : _a.trim().toLowerCase();
  const toStatus = (_b = process.env.TO_STATUS) == null ? void 0 : _b.trim().toLowerCase();
  console.log("\n\u{1F4E6} Lead Move Skill\n");
  if (!fromStatus || !toStatus) {
    printUsage();
    await db.end();
    return;
  }
  if (!isValidLeadStatus(fromStatus)) {
    console.error(`\u274C Invalid FROM_STATUS: ${fromStatus}`);
    console.error(`   Valid: ${LEAD_STATUSES.join(", ")}`);
    process.exit(1);
  }
  if (!isValidLeadStatus(toStatus)) {
    console.error(`\u274C Invalid TO_STATUS: ${toStatus}`);
    console.error(`   Valid: ${LEAD_STATUSES.join(", ")}`);
    process.exit(1);
  }
  if (fromStatus === toStatus) {
    console.error("\u274C FROM_STATUS and TO_STATUS must be different");
    process.exit(1);
  }
  const limit = process.env.LIMIT ? parseIntSafe(process.env.LIMIT, 0) : null;
  const effectiveLimit = limit && limit > 0 ? limit : null;
  try {
    const countRes = await db.query(
      `SELECT COUNT(*) as c FROM leads WHERE processing_status = $1::lead_processing_status`,
      [fromStatus]
    );
    const count = parseInt(((_c = countRes.rows[0]) == null ? void 0 : _c.c) ?? "0", 10);
    if (count === 0) {
      console.log(`\u2139\uFE0F  No leads with status '${fromStatus}'
`);
      await db.end();
      return;
    }
    const updateRes = await db.query(
      effectiveLimit != null ? `UPDATE leads
           SET processing_status = $1::lead_processing_status, updated_at = NOW()
           WHERE id IN (
             SELECT id FROM leads
             WHERE processing_status = $2::lead_processing_status
             ORDER BY updated_at ASC
             LIMIT $3
           )
           RETURNING id` : `UPDATE leads
           SET processing_status = $1::lead_processing_status, updated_at = NOW()
           WHERE processing_status = $2::lead_processing_status
           RETURNING id`,
      effectiveLimit != null ? [toStatus, fromStatus, effectiveLimit] : [toStatus, fromStatus]
    );
    const updated = updateRes.rowCount ?? 0;
    console.log(`\u2705 Moved ${updated} lead(s) from '${fromStatus}' \u2192 '${toStatus}'
`);
    await db.end();
  } catch (err) {
    console.error("\u274C Error:", err.message);
    process.exit(1);
  }
}
main();
