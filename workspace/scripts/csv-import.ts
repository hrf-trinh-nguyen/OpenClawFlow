#!/usr/bin/env node

/**
 * CSV Import Tool
 *
 * Import leads from a CSV file into the database.
 * Sets processing_status = 'apollo_matched' so leads are ready for Bouncer.
 *
 * Usage:
 *   node scripts/csv-import.mjs path/to/file.csv
 *
 * ENV:
 *   SUPABASE_DB_URL - PostgreSQL connection string (required)
 *   CSV_BATCH_SIZE  - Rows per batch (default: 50)
 *   CSV_BATCH_DELAY - Delay between batches in ms (default: 500)
 */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { getDb, getExistingEmails } from '../lib/supabase-pipeline.js';

// ── Configuration ──────────────────────────────────────────────────

const BATCH_SIZE = parseInt(process.env.CSV_BATCH_SIZE || '50', 10);
const BATCH_DELAY = parseInt(process.env.CSV_BATCH_DELAY || '500', 10);

// ── Helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyEmail(email: string): boolean {
  // Pragmatic validator: good enough for import filtering.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

interface CsvRow {
  'First Name': string;
  'Last Name': string;
  Title: string;
  'Company Name': string;
  Email: string;
  'Person Linkedin Url'?: string;
  Website?: string;
  'Company Linkedin Url'?: string;
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
  const email = (row.Email || '').trim().toLowerCase();
  if (!email || !isLikelyEmail(email)) return null;

  return {
    first_name: (row['First Name'] || '').trim() || 'Unknown',
    last_name: (row['Last Name'] || '').trim() || 'Unknown',
    title: (row.Title || '').trim() || 'Unknown',
    company_name: (row['Company Name'] || '').trim() || 'Unknown',
    email,
    linkedin_url: (row['Person Linkedin Url'] || '').trim() || null,
    processing_status: 'apollo_matched',
    source: 'import',
    email_status: 'unknown',
    batch_id: batchId,
    priority: 0,
  };
}

async function insertLeadsBatch(
  db: any,
  leads: Lead[]
): Promise<{
  inserted: number;
  skippedExisting: number;
  skippedDuplicateInBatch: number;
  skippedInsertConflictOrFailed: number;
}> {
  if (leads.length === 0) {
    return {
      inserted: 0,
      skippedExisting: 0,
      skippedDuplicateInBatch: 0,
      skippedInsertConflictOrFailed: 0,
    };
  }

  // Deduplicate within this batch (case-insensitive) to reduce DB work.
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
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node csv-import.mjs <path-to-csv>');
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const db = getDb();
  if (!db) {
    console.error('SUPABASE_DB_URL not set');
    process.exit(1);
  }

  const filename = path.basename(csvPath, '.csv');
  const ts = Math.floor(Date.now() / 1000);
  const shortName = filename.slice(0, 30);
  const batchId = `csv-${shortName}-${ts}`.slice(0, 50);

  console.log(`\n=== Importing ${csvPath} ===`);
  console.log(`   Batch ID: ${batchId}`);
  console.log(`   Batch size: ${BATCH_SIZE}, delay: ${BATCH_DELAY}ms\n`);

  const content = fs.readFileSync(csvPath, 'utf-8');
  const rows: CsvRow[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`   Total rows in CSV: ${rows.length}\n`);

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
    console.log('   No valid leads to import.\n');
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

    const {
      inserted,
      skippedExisting,
      skippedDuplicateInBatch,
      skippedInsertConflictOrFailed,
    } = await insertLeadsBatch(db, batch);
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

  await db.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
