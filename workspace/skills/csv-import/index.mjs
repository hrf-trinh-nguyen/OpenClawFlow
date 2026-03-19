#!/usr/bin/env node

// skills/csv-import/index.ts
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

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

// lib/db/leads.ts
async function getExistingEmails(client, emails) {
  if (emails.length === 0) return /* @__PURE__ */ new Set();
  const valid = emails.filter((e) => e && typeof e === "string").map((e) => e.trim().toLowerCase());
  if (valid.length === 0) return /* @__PURE__ */ new Set();
  const result = await client.query(
    `SELECT LOWER(TRIM(email)) as email FROM leads WHERE LOWER(TRIM(email)) = ANY($1::text[])`,
    [valid]
  );
  return new Set(result.rows.map((r) => r.email));
}

// skills/csv-import/index.ts
var CSV_SOURCE = process.env.CSV_SOURCE || "";
var BATCH_SIZE = parseInt(process.env.CSV_BATCH_SIZE || "50", 10);
var BATCH_DELAY = parseInt(process.env.CSV_BATCH_DELAY || "500", 10);
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isLikelyEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isGoogleSheetUrl(url) {
  return url.includes("docs.google.com/spreadsheets");
}
function extractGoogleSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
function getGoogleSheetCsvUrl(sheetId, gid = "0") {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}
function extractGid(url) {
  const match = url.match(/[#&?]gid=(\d+)/);
  return match ? match[1] : "0";
}
async function fetchGoogleSheetAsCsv(url) {
  const sheetId = extractGoogleSheetId(url);
  if (!sheetId) {
    throw new Error(`Invalid Google Sheet URL: ${url}`);
  }
  const gid = extractGid(url);
  const csvUrl = getGoogleSheetCsvUrl(sheetId, gid);
  console.log(`   Fetching Google Sheet as CSV...`);
  console.log(`   Sheet ID: ${sheetId}, GID: ${gid}
`);
  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google Sheet: ${response.status} ${response.statusText}. Make sure the sheet is publicly accessible (Anyone with the link can view).`
    );
  }
  return await response.text();
}
function mapCsvRowToLead(row, batchId) {
  const email = (row.Email || row.email || "").trim().toLowerCase();
  if (!email || !isLikelyEmail(email)) return null;
  return {
    first_name: (row["First Name"] || row["first_name"] || row["FirstName"] || "").trim() || "Unknown",
    last_name: (row["Last Name"] || row["last_name"] || row["LastName"] || "").trim() || "Unknown",
    title: (row.Title || row.title || "").trim() || "Unknown",
    company_name: (row["Company Name"] || row["company_name"] || row["CompanyName"] || row.Company || "").trim() || "Unknown",
    email,
    linkedin_url: (row["Person Linkedin Url"] || row["linkedin_url"] || row["LinkedIn"] || "").trim() || null,
    processing_status: "apollo_matched",
    source: "import",
    email_status: "unknown",
    batch_id: batchId,
    priority: 0
  };
}
async function insertLeadsBatch(db, leads) {
  if (leads.length === 0) {
    return {
      inserted: 0,
      skippedExisting: 0,
      skippedDuplicateInBatch: 0,
      skippedInsertConflictOrFailed: 0
    };
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  let skippedDuplicateInBatch = 0;
  for (const l of leads) {
    const e = l.email.trim().toLowerCase();
    if (seen.has(e)) {
      skippedDuplicateInBatch++;
      continue;
    }
    seen.add(e);
    deduped.push({ ...l, email: e });
  }
  const emails = deduped.map((l) => l.email);
  const existing = await getExistingEmails(db, emails);
  const newLeads = deduped.filter((l) => !existing.has(l.email));
  const skippedExisting = deduped.length - newLeads.length;
  if (newLeads.length === 0) {
    return {
      inserted: 0,
      skippedExisting,
      skippedDuplicateInBatch,
      skippedInsertConflictOrFailed: 0
    };
  }
  let inserted = 0;
  let skippedInsertConflictOrFailed = 0;
  for (const lead of newLeads) {
    try {
      const res = await db.query(
        `INSERT INTO leads 
         (first_name, last_name, title, company_name, email, linkedin_url,
          processing_status, source, email_status, batch_id, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::lead_source, $9::email_status, $10, $11)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [
          lead.first_name,
          lead.last_name,
          lead.title,
          lead.company_name,
          lead.email,
          lead.linkedin_url,
          lead.processing_status,
          lead.source,
          lead.email_status,
          lead.batch_id,
          lead.priority
        ]
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
      else skippedInsertConflictOrFailed++;
    } catch (err) {
      console.error(`   Error inserting ${lead.email}: ${err.message}`);
      skippedInsertConflictOrFailed++;
    }
  }
  return {
    inserted,
    skippedExisting,
    skippedDuplicateInBatch,
    skippedInsertConflictOrFailed
  };
}
async function main() {
  console.log(`
\u{1F680} CSV Import Service Starting
`);
  if (!CSV_SOURCE) {
    console.error("\u274C CSV_SOURCE not set. Provide a file path or Google Sheet URL.");
    console.error('   Example: CSV_SOURCE="csv/leads.csv" node skills/csv-import/index.mjs');
    console.error(
      '   Example: CSV_SOURCE="https://docs.google.com/spreadsheets/d/..." node skills/csv-import/index.mjs'
    );
    process.exit(1);
  }
  const db = getDb();
  if (!db) {
    console.error("\u274C SUPABASE_DB_URL not set");
    process.exit(1);
  }
  console.log(`\u2705 PostgreSQL connection pool created
`);
  let csvContent;
  let sourceLabel;
  let batchIdPrefix;
  if (isGoogleSheetUrl(CSV_SOURCE)) {
    sourceLabel = CSV_SOURCE;
    batchIdPrefix = "gsheet";
    csvContent = await fetchGoogleSheetAsCsv(CSV_SOURCE);
  } else {
    if (!fs.existsSync(CSV_SOURCE)) {
      console.error(`\u274C File not found: ${CSV_SOURCE}`);
      process.exit(1);
    }
    sourceLabel = CSV_SOURCE;
    const filename = path.basename(CSV_SOURCE, ".csv");
    batchIdPrefix = filename.slice(0, 20);
    csvContent = fs.readFileSync(CSV_SOURCE, "utf-8");
  }
  const ts = Math.floor(Date.now() / 1e3);
  const batchId = process.env.BATCH_ID || `csv-${batchIdPrefix.replace(/[^a-zA-Z0-9_-]/g, "")}-${ts}`.slice(0, 50);
  console.log(`=== CSV Import Service ===`);
  console.log(`   Source: ${sourceLabel}`);
  console.log(`   Batch ID: ${batchId}`);
  console.log(`   Batch size: ${BATCH_SIZE}, delay: ${BATCH_DELAY}ms
`);
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });
  console.log(`   Total rows in source: ${rows.length}`);
  const leads = [];
  let skippedInvalidEmail = 0;
  for (const row of rows) {
    const lead = mapCsvRowToLead(row, batchId);
    if (lead) leads.push(lead);
    else skippedInvalidEmail++;
  }
  console.log(`   Valid leads (with email): ${leads.length}`);
  if (skippedInvalidEmail > 0) {
    console.log(`   Skipped invalid/missing email rows: ${skippedInvalidEmail}`);
  }
  console.log("");
  if (leads.length === 0) {
    console.log("\u2139\uFE0F  No valid leads to import.\n");
    await db.end();
    return;
  }
  const totalBatches = Math.ceil(leads.length / BATCH_SIZE);
  let totalInserted = 0;
  let totalSkippedExisting = 0;
  let totalSkippedDup = 0;
  let totalSkippedInsert = 0;
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = leads.slice(i, i + BATCH_SIZE);
    const { inserted, skippedExisting, skippedDuplicateInBatch, skippedInsertConflictOrFailed } = await insertLeadsBatch(db, batch);
    totalInserted += inserted;
    totalSkippedExisting += skippedExisting;
    totalSkippedDup += skippedDuplicateInBatch;
    totalSkippedInsert += skippedInsertConflictOrFailed;
    console.log(
      `[batch ${batchNum}/${totalBatches}] inserted: ${inserted}, skipped_existing: ${skippedExisting}, skipped_dup: ${skippedDuplicateInBatch}, skipped_insert: ${skippedInsertConflictOrFailed}`
    );
    if (i + BATCH_SIZE < leads.length) {
      await sleep(BATCH_DELAY);
    }
  }
  console.log(
    `
=== Done: ${totalInserted} inserted | skipped_existing ${totalSkippedExisting} | skipped_dup ${totalSkippedDup} | skipped_invalid_email ${skippedInvalidEmail} | skipped_insert ${totalSkippedInsert} ===
`
  );
  console.log(`\u2705 CSV Import Service Complete`);
  console.log(`   Batch ID: ${batchId}`);
  console.log(`   Next step: run Bouncer to verify emails`);
  console.log(`   node workspace/skills/bouncer/index.mjs
`);
  await db.end();
}
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
