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

// skills/lead-stats/index.ts
async function main() {
  const db = getDb();
  if (!db) {
    console.error("\u274C SUPABASE_DB_URL not found in env");
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
        const reason = (row.reason || "(no error message)").slice(0, 80);
        const step = reason.includes("Bouncer") || reason.includes("deliverable") ? "Bouncer" : reason.includes("Apollo") ? "Apollo" : reason.includes("Instantly") ? "Instantly" : "?";
        console.log(`  ${row.count}: [${step}] ${reason}${reason.length >= 80 ? "..." : ""}`);
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
