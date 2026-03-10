#!/usr/bin/env node

// lib/supabase-pipeline.ts
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

// skills/lead-delete/index.ts
var VALID_STATUSES = [
  "new",
  "apollo_matched",
  "bouncer_verified",
  "instantly_loaded",
  "replied",
  "failed"
];
function isValidStatus(s) {
  return VALID_STATUSES.includes(s);
}
async function main() {
  var _a, _b;
  const db = getDb();
  if (!db) {
    console.error("\u274C SUPABASE_DB_URL not found in env");
    process.exit(1);
  }
  const deleteStatus = (_a = process.env.DELETE_STATUS) == null ? void 0 : _a.trim().toLowerCase();
  console.log("\n\u{1F5D1}\uFE0F  Lead Delete Skill\n");
  if (!deleteStatus) {
    console.log("\u2500\u2500 Supported statuses (delete by) \u2500\u2500");
    for (const s of VALID_STATUSES) {
      console.log(`  ${s}`);
    }
    console.log("\nUsage:");
    console.log("  DELETE_STATUS=<status> node workspace/skills/lead-delete/index.mjs");
    console.log("\nExamples:");
    console.log("  # Delete all failed leads");
    console.log("  DELETE_STATUS=failed node workspace/skills/lead-delete/index.mjs");
    console.log("\n  # Delete all apollo_matched (e.g. before re-collecting)");
    console.log("  DELETE_STATUS=apollo_matched node workspace/skills/lead-delete/index.mjs");
    await db.end();
    return;
  }
  if (!isValidStatus(deleteStatus)) {
    console.error(`\u274C Invalid DELETE_STATUS: ${deleteStatus}`);
    console.error(`   Valid: ${VALID_STATUSES.join(", ")}`);
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
