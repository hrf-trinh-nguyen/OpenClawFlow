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

// skills/lead-move/index.ts
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
  var _a, _b, _c, _d;
  const db = getDb();
  if (!db) {
    console.error("\u274C SUPABASE_DB_URL not found in env");
    process.exit(1);
  }
  const fromStatus = (_a = process.env.FROM_STATUS) == null ? void 0 : _a.trim().toLowerCase();
  const toStatus = (_b = process.env.TO_STATUS) == null ? void 0 : _b.trim().toLowerCase();
  console.log("\n\u{1F4E6} Lead Move Skill\n");
  if (!fromStatus || !toStatus) {
    console.log("\u2500\u2500 Supported statuses \u2500\u2500");
    for (const s of VALID_STATUSES) {
      console.log(`  ${s}`);
    }
    console.log("\nUsage:");
    console.log("  FROM_STATUS=<from> TO_STATUS=<to> node workspace/skills/lead-move/index.mjs");
    console.log("\nExamples:");
    console.log("  # Move failed leads back to apollo_matched (retry Bouncer)");
    console.log("  FROM_STATUS=failed TO_STATUS=apollo_matched node workspace/skills/lead-move/index.mjs");
    console.log("\n  # Reset failed to new");
    console.log("  FROM_STATUS=failed TO_STATUS=new node workspace/skills/lead-move/index.mjs");
    await db.end();
    return;
  }
  if (!isValidStatus(fromStatus)) {
    console.error(`\u274C Invalid FROM_STATUS: ${fromStatus}`);
    console.error(`   Valid: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }
  if (!isValidStatus(toStatus)) {
    console.error(`\u274C Invalid TO_STATUS: ${toStatus}`);
    console.error(`   Valid: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }
  if (fromStatus === toStatus) {
    console.error("\u274C FROM_STATUS and TO_STATUS must be different");
    process.exit(1);
  }
  const limitRaw = (_c = process.env.LIMIT) == null ? void 0 : _c.trim();
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 0) : null;
  try {
    const countRes = await db.query(
      `SELECT COUNT(*) as c FROM leads WHERE processing_status = $1::lead_processing_status`,
      [fromStatus]
    );
    const count = parseInt(((_d = countRes.rows[0]) == null ? void 0 : _d.c) ?? "0", 10);
    if (count === 0) {
      console.log(`\u2139\uFE0F  No leads with status '${fromStatus}'
`);
      await db.end();
      return;
    }
    const updateRes = await db.query(
      limit != null ? `UPDATE leads
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
      limit != null ? [toStatus, fromStatus, limit] : [toStatus, fromStatus]
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
