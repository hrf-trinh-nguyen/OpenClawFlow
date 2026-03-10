#!/usr/bin/env node
/**
 * Run Supabase migration using connection string.
 * Usage: from repo root: node workspace/scripts/run-supabase-migration.mjs
 *        or from workspace: npm run db:migrate
 * Requires in .env (at repo root): SUPABASE_DB_URL
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const envPath = join(repoRoot, '.env');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const migrationArg = process.argv[2] || '009';

function loadEnv() {
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      out[m[1].trim()] = v;
    }
  }
  return out;
}

const env = loadEnv();
const url = process.env.SUPABASE_DB_URL || env.SUPABASE_DB_URL;

if (!url) {
  console.error('Missing SUPABASE_DB_URL.');
  console.error('Add to .env (repo root):');
  console.error('  SUPABASE_DB_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres');
  console.error('Get it from: Supabase Dashboard → Settings → Database → Connection string (URI).');
  process.exit(1);
}

// Resolve migration: 009 -> 009_replies_auto_replied.sql
let migrationFile = migrationArg;
if (!migrationFile.endsWith('.sql')) {
  const files = readdirSync(migrationsDir).filter((f) => f.startsWith(migrationArg + '_') && f.endsWith('.sql'));
  migrationFile = files[0] || migrationArg + '.sql';
}
const migrationPath = join(migrationsDir, migrationFile);

if (!existsSync(migrationPath)) {
  console.error('Migration file not found:', migrationPath);
  process.exit(1);
}

const sql = readFileSync(migrationPath, 'utf8');
const client = new pg.Client({ connectionString: url });

async function run() {
  try {
    await client.connect();
    await client.query(sql);
    console.log('Migration applied:', migrationFile);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
