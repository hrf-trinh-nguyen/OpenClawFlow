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
