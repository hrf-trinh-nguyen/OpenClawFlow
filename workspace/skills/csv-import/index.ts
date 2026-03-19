#!/usr/bin/env node

/**
 * CSV Import Skill
 *
 * Import leads from CSV file or Google Sheet public link into the database.
 * Sets processing_status = 'apollo_matched' so leads are ready for Bouncer.
 *
 * Usage:
 *   CSV_SOURCE="path/to/file.csv" node skills/csv-import/index.mjs
 *   CSV_SOURCE="https://docs.google.com/spreadsheets/d/SHEET_ID/..." node skills/csv-import/index.mjs
 *
 * ENV:
 *   CSV_SOURCE      - Local file path OR Google Sheet public URL (required)
 *   SUPABASE_DB_URL - PostgreSQL connection string (required)
 *   CSV_BATCH_SIZE  - Rows per batch (default: 50)
 *   CSV_BATCH_DELAY - Delay between batches in ms (default: 500)
 *   BATCH_ID        - Optional batch identifier
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { getDb, getExistingEmails } from '../../lib/supabase-pipeline.js';

// ── Configuration ──────────────────────────────────────────────────

const CSV_SOURCE = process.env.CSV_SOURCE || '';
const BATCH_SIZE = parseInt(process.env.CSV_BATCH_SIZE || '50', 10);
const BATCH_DELAY = parseInt(process.env.CSV_BATCH_DELAY || '500', 10);

// ── Helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isGoogleSheetUrl(url: string): boolean {
  return url.includes('docs.google.com/spreadsheets');
}

function extractGoogleSheetId(url: string): string | null {
  // Matches: /spreadsheets/d/SHEET_ID/...
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function getGoogleSheetCsvUrl(sheetId: string, gid: string = '0'): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

function extractGid(url: string): string {
  const match = url.match(/[#&?]gid=(\d+)/);
  return match ? match[1] : '0';
}

async function fetchGoogleSheetAsCsv(url: string): Promise<string> {
  const sheetId = extractGoogleSheetId(url);
  if (!sheetId) {
    throw new Error(`Invalid Google Sheet URL: ${url}`);
  }

  const gid = extractGid(url);
  const csvUrl = getGoogleSheetCsvUrl(sheetId, gid);

  console.log(`   Fetching Google Sheet as CSV...`);
  console.log(`   Sheet ID: ${sheetId}, GID: ${gid}\n`);

  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google Sheet: ${response.status} ${response.statusText}. ` +
        `Make sure the sheet is publicly accessible (Anyone with the link can view).`
    );
  }

  return await response.text();
}

// ── Lead Types ─────────────────────────────────────────────────────

interface CsvRow {
  'First Name'?: string;
  'Last Name'?: string;
  Title?: string;
  'Company Name'?: string;
  Email?: string;
  'Person Linkedin Url'?: string;
  [key: string]: string | undefined;
}

interface Lead {
  first_name: string;
  last_name: string;
  title: string;
  company_name: string;
  email: string;
  linkedin_url: string | null;
  processing_status: string;
  source: string;
  email_status: string;
  batch_id: string;
  priority: number;
}

function mapCsvRowToLead(row: CsvRow, batchId: string): Lead | null {
  const email = (row.Email || row.email || '').trim().toLowerCase();
  if (!email || !isLikelyEmail(email)) return null;

  return {
    first_name:
      (row['First Name'] || row['first_name'] || row['FirstName'] || '').trim() || 'Unknown',
    last_name:
      (row['Last Name'] || row['last_name'] || row['LastName'] || '').trim() || 'Unknown',
    title: (row.Title || row.title || '').trim() || 'Unknown',
    company_name:
      (row['Company Name'] || row['company_name'] || row['CompanyName'] || row.Company || '')
        .trim() || 'Unknown',
    email,
    linkedin_url:
      (row['Person Linkedin Url'] || row['linkedin_url'] || row['LinkedIn'] || '').trim() || null,
    processing_status: 'apollo_matched',
    source: 'import',
    email_status: 'unknown',
    batch_id: batchId,
    priority: 0,
  };
}

// ── Batch Insert ───────────────────────────────────────────────────

interface BatchResult {
  inserted: number;
  skippedExisting: number;
  skippedDuplicateInBatch: number;
  skippedInsertConflictOrFailed: number;
}

async function insertLeadsBatch(db: any, leads: Lead[]): Promise<BatchResult> {
  if (leads.length === 0) {
    return {
      inserted: 0,
      skippedExisting: 0,
      skippedDuplicateInBatch: 0,
      skippedInsertConflictOrFailed: 0,
    };
  }

  // Deduplicate within this batch
  const seen = new Set<string>();
  const deduped: Lead[] = [];
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
      skippedInsertConflictOrFailed: 0,
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
          lead.priority,
        ]
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
      else skippedInsertConflictOrFailed++;
    } catch (err: any) {
      console.error(`   Error inserting ${lead.email}: ${err.message}`);
      skippedInsertConflictOrFailed++;
    }
  }

  return {
    inserted,
    skippedExisting,
    skippedDuplicateInBatch,
    skippedInsertConflictOrFailed,
  };
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 CSV Import Service Starting\n`);

  if (!CSV_SOURCE) {
    console.error('❌ CSV_SOURCE not set. Provide a file path or Google Sheet URL.');
    console.error('   Example: CSV_SOURCE="csv/leads.csv" node skills/csv-import/index.mjs');
    console.error(
      '   Example: CSV_SOURCE="https://docs.google.com/spreadsheets/d/..." node skills/csv-import/index.mjs'
    );
    process.exit(1);
  }

  const db = getDb();
  if (!db) {
    console.error('❌ SUPABASE_DB_URL not set');
    process.exit(1);
  }

  console.log(`✅ PostgreSQL connection pool created\n`);

  // Determine source type and fetch content
  let csvContent: string;
  let sourceLabel: string;
  let batchIdPrefix: string;

  if (isGoogleSheetUrl(CSV_SOURCE)) {
    sourceLabel = CSV_SOURCE;
    batchIdPrefix = 'gsheet';
    csvContent = await fetchGoogleSheetAsCsv(CSV_SOURCE);
  } else {
    // Local file
    if (!fs.existsSync(CSV_SOURCE)) {
      console.error(`❌ File not found: ${CSV_SOURCE}`);
      process.exit(1);
    }
    sourceLabel = CSV_SOURCE;
    const filename = path.basename(CSV_SOURCE, '.csv');
    batchIdPrefix = filename.slice(0, 20);
    csvContent = fs.readFileSync(CSV_SOURCE, 'utf-8');
  }

  const ts = Math.floor(Date.now() / 1000);
  const batchId =
    process.env.BATCH_ID || `csv-${batchIdPrefix.replace(/[^a-zA-Z0-9_-]/g, '')}-${ts}`.slice(0, 50);

  console.log(`=== CSV Import Service ===`);
  console.log(`   Source: ${sourceLabel}`);
  console.log(`   Batch ID: ${batchId}`);
  console.log(`   Batch size: ${BATCH_SIZE}, delay: ${BATCH_DELAY}ms\n`);

  // Parse CSV
  const rows: CsvRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  console.log(`   Total rows in source: ${rows.length}`);

  // Map to leads
  const leads: Lead[] = [];
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
  console.log('');

  if (leads.length === 0) {
    console.log('ℹ️  No valid leads to import.\n');
    await db.end();
    return;
  }

  // Batch insert
  const totalBatches = Math.ceil(leads.length / BATCH_SIZE);
  let totalInserted = 0;
  let totalSkippedExisting = 0;
  let totalSkippedDup = 0;
  let totalSkippedInsert = 0;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = leads.slice(i, i + BATCH_SIZE);

    const { inserted, skippedExisting, skippedDuplicateInBatch, skippedInsertConflictOrFailed } =
      await insertLeadsBatch(db, batch);

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
    `\n=== Done: ${totalInserted} inserted | skipped_existing ${totalSkippedExisting} | skipped_dup ${totalSkippedDup} | skipped_invalid_email ${skippedInvalidEmail} | skipped_insert ${totalSkippedInsert} ===\n`
  );

  console.log(`✅ CSV Import Service Complete`);
  console.log(`   Batch ID: ${batchId}`);
  console.log(`   Next step: run Bouncer to verify emails`);
  console.log(`   node workspace/skills/bouncer/index.mjs\n`);

  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
