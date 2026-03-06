#!/usr/bin/env node

/**
 * Test Script for Flexible Pipeline Architecture
 * 
 * Verifies:
 * 1. Database schema (tables, enums, functions exist)
 * 2. Service executables exist and are built
 * 3. Basic DB operations work
 */

import { getDb, getPipelineStats, createPipelineRun, updatePipelineRun, getLeadsByStatus } from '../lib/supabase-pipeline.js';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n🧪 Testing Flexible Pipeline Architecture\n');

let testsPassed = 0;
let testsFailed = 0;

function pass(msg) {
  console.log(`✅ ${msg}`);
  testsPassed++;
}

function fail(msg, error = null) {
  console.log(`❌ ${msg}`);
  if (error) console.log(`   Error: ${error.message || error}`);
  testsFailed++;
}

// ── Test 1: Database Connection ────────────────────────────────────

console.log('📊 Test 1: Database Connection');

const db = getDb();
if (db) {
  pass('Database connection pool created');
} else {
  fail('Failed to create database connection pool');
  process.exit(1);
}

// ── Test 2: Schema Verification ────────────────────────────────────

console.log('\n📊 Test 2: Schema Verification');

try {
  // Check enum exists
  const enumResult = await db.query(
    `SELECT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'lead_processing_status'
    )`
  );
  
  if (enumResult.rows[0].exists) {
    pass('Enum lead_processing_status exists');
  } else {
    fail('Enum lead_processing_status not found');
  }

  // Check tables exist
  const tables = ['leads', 'pipeline_runs', 'service_executions'];
  for (const table of tables) {
    const tableResult = await db.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = $1
      )`,
      [table]
    );
    
    if (tableResult.rows[0].exists) {
      pass(`Table ${table} exists`);
    } else {
      fail(`Table ${table} not found`);
    }
  }

  // Check columns exist
  const leadsColumnsResult = await db.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'leads' 
     AND column_name IN ('processing_status', 'processing_error', 'batch_id', 'priority')`
  );
  
  if (leadsColumnsResult.rows.length === 4) {
    pass('All new columns in leads table exist');
  } else {
    fail(`Missing columns in leads table (found ${leadsColumnsResult.rows.length}/4)`);
  }

  // Check functions exist
  const functions = ['get_leads_by_status', 'update_lead_status', 'batch_update_lead_status', 'get_pipeline_stats'];
  for (const func of functions) {
    const funcResult = await db.query(
      `SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = $1
      )`,
      [func]
    );
    
    if (funcResult.rows[0].exists) {
      pass(`Function ${func} exists`);
    } else {
      fail(`Function ${func} not found`);
    }
  }

} catch (error) {
  fail('Schema verification failed', error);
}

// ── Test 3: Skill Files Exist ───────────────────────────────────────

console.log('\n📊 Test 3: Skill Files Exist');

const skillFiles = [
  '../skills/apollo/index.mjs',
  '../skills/bouncer/index.mjs',
  '../skills/instantly/index.mjs'
];

for (const file of skillFiles) {
  const fullPath = resolve(__dirname, file);
  if (existsSync(fullPath)) {
    pass(`Skill built: ${file}`);
  } else {
    fail(`Skill not built: ${file}`);
  }
}

// ── Test 4: Database Operations ────────────────────────────────────

console.log('\n📊 Test 4: Database Operations');

try {
  // Test getPipelineStats
  const stats = await getPipelineStats(db);
  pass(`getPipelineStats returned ${stats.length} status groups`);

  // Test createPipelineRun
  const runId = await createPipelineRun(db, {
    run_type: 'test_run',
    target_count: 100,
    triggered_by: 'test_script'
  });
  pass(`createPipelineRun created run: ${runId}`);

  // Test updatePipelineRun
  await updatePipelineRun(db, runId, {
    status: 'completed',
    completed_at: new Date(),
    leads_processed: 100,
    leads_succeeded: 95,
    leads_failed: 5
  });
  pass('updatePipelineRun succeeded');

  // Test getLeadsByStatus
  const leads = await getLeadsByStatus(db, 'apollo_matched', 10);
  pass(`getLeadsByStatus returned ${leads.length} leads`);

} catch (error) {
  fail('Database operations failed', error);
}

// ── Test 5: Library Imports ─────────────────────────────────────────

console.log('\n📊 Test 5: Library Imports');

try {
  const { getDb: getDbImport, createPipelineRun: createRunImport } = await import('../lib/supabase-pipeline.js');
  pass('supabase-pipeline.js imports successfully');
} catch (error) {
  fail('supabase-pipeline.js import failed', error);
}

try {
  const { createWorkflowRun } = await import('../lib/supabase-legacy.js');
  pass('supabase-legacy.js imports successfully');
} catch (error) {
  fail('supabase-legacy.js import failed', error);
}

// ── Summary ─────────────────────────────────────────────────────────

await db.end();

console.log('\n' + '='.repeat(60));
console.log(`📊 Test Summary: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(60) + '\n');

if (testsFailed > 0) {
  console.log('❌ Some tests failed. Please review the errors above.\n');
  process.exit(1);
} else {
  console.log('✅ All tests passed! Pipeline architecture is ready.\n');
  process.exit(0);
}
