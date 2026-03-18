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
function truncate(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

// skills/lead-stats/index.ts
function detectFailureStep(reason) {
  if (reason.includes("Bouncer") || reason.includes("deliverable")) return "Bouncer";
  if (reason.includes("Apollo")) return "Apollo";
  if (reason.includes("Instantly")) return "Instantly";
  return "?";
}
async function main() {
  validateRequiredEnv(["SUPABASE_DB_URL"]);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  console.log("\n\u{1F4CA} Lead pipeline statistics\n");
  try {
    const statusRes = await db.query(
      `SELECT processing_status::text, COUNT(*) as count
       FROM leads
       GROUP BY processing_status
       ORDER BY processing_status`
    );
    let total = 0;
    console.log("\u2500\u2500 By status \u2500\u2500");
    for (const row of statusRes.rows) {
      const count = parseInt(row.count, 10);
      total += count;
      console.log(`  ${row.processing_status}: ${count}`);
    }
    console.log(`  TOTAL: ${total}
`);
    const failedRes = await db.query(
      `SELECT COALESCE(processing_error, '(no error message)') as reason, COUNT(*) as count
       FROM leads
       WHERE processing_status = 'failed'
       GROUP BY processing_error
       ORDER BY count DESC`
    );
    if (failedRes.rows.length > 0) {
      console.log("\u2500\u2500 Failed leads by reason (processing_error) \u2500\u2500");
      console.log("   (Most failures are at Bouncer step: email verify)");
      for (const row of failedRes.rows) {
        const reason = row.reason || "(no error message)";
        const step = detectFailureStep(reason);
        console.log(`  ${row.count}: [${step}] ${truncate(reason, 80)}`);
      }
      console.log("");
    }
    await db.end();
    console.log("\u2705 Done\n");
  } catch (err) {
    console.error("\u274C Error:", err.message);
    process.exit(1);
  }
}
main();
