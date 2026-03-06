#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// lib/supabase-pipeline.ts
var supabase_pipeline_exports = {};
__export(supabase_pipeline_exports, {
  batchUpdateLeadStatus: () => batchUpdateLeadStatus,
  createPipelineRun: () => createPipelineRun,
  createServiceExecution: () => createServiceExecution,
  getDb: () => getDb,
  getLeadsByStatus: () => getLeadsByStatus,
  getPipelineStats: () => getPipelineStats,
  getSupabaseClient: () => getSupabaseClient,
  getSupabaseEnv: () => getSupabaseEnv,
  updateLeadStatus: () => updateLeadStatus,
  updatePipelineRun: () => updatePipelineRun,
  updateServiceExecution: () => updateServiceExecution,
  upsertLeads: () => upsertLeads
});
import { Pool } from "pg";
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
async function createPipelineRun(client, run) {
  const result = await client.query(
    `INSERT INTO pipeline_runs 
     (run_type, target_count, status, triggered_by, icp_filters)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      run.run_type,
      run.target_count || null,
      run.status || "running",
      run.triggered_by || "manual",
      run.icp_filters ? JSON.stringify(run.icp_filters) : null
    ]
  );
  return result.rows[0].id;
}
async function updatePipelineRun(client, runId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;
  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== void 0) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.leads_processed !== void 0) {
    fields.push(`leads_processed = $${idx++}`);
    values.push(updates.leads_processed);
  }
  if (updates.leads_succeeded !== void 0) {
    fields.push(`leads_succeeded = $${idx++}`);
    values.push(updates.leads_succeeded);
  }
  if (updates.leads_failed !== void 0) {
    fields.push(`leads_failed = $${idx++}`);
    values.push(updates.leads_failed);
  }
  if (updates.error_message) {
    fields.push(`error_message = $${idx++}`);
    values.push(updates.error_message);
  }
  fields.push(`updated_at = NOW()`);
  values.push(runId);
  await client.query(
    `UPDATE pipeline_runs SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}
async function createServiceExecution(client, exec) {
  const result = await client.query(
    `INSERT INTO service_executions 
     (pipeline_run_id, service_name, status, input_count, batch_size)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      exec.pipeline_run_id || null,
      exec.service_name,
      exec.status || "running",
      exec.input_count || 0,
      exec.batch_size || null
    ]
  );
  return result.rows[0].id;
}
async function updateServiceExecution(client, execId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;
  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== void 0) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.output_count !== void 0) {
    fields.push(`output_count = $${idx++}`);
    values.push(updates.output_count);
  }
  if (updates.failed_count !== void 0) {
    fields.push(`failed_count = $${idx++}`);
    values.push(updates.failed_count);
  }
  if (updates.api_calls_made !== void 0) {
    fields.push(`api_calls_made = $${idx++}`);
    values.push(updates.api_calls_made);
  }
  if (updates.api_errors !== void 0) {
    fields.push(`api_errors = $${idx++}`);
    values.push(updates.api_errors);
  }
  if (updates.rate_limit_hits !== void 0) {
    fields.push(`rate_limit_hits = $${idx++}`);
    values.push(updates.rate_limit_hits);
  }
  if (updates.error_message) {
    fields.push(`error_message = $${idx++}`);
    values.push(updates.error_message);
  }
  if (updates.execution_metadata) {
    fields.push(`execution_metadata = $${idx++}`);
    values.push(JSON.stringify(updates.execution_metadata));
  }
  values.push(execId);
  await client.query(
    `UPDATE service_executions SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}
async function upsertLeads(client, leads) {
  if (leads.length === 0) return 0;
  let upsertedCount = 0;
  for (const lead of leads) {
    await client.query(
      `INSERT INTO leads 
       (apollo_person_id, first_name, last_name, email, company_name, title, 
        linkedin_url, email_status, processing_status, processing_error, 
        batch_id, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (email) 
       DO UPDATE SET
         apollo_person_id = COALESCE(EXCLUDED.apollo_person_id, leads.apollo_person_id),
         first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
         last_name = COALESCE(EXCLUDED.last_name, leads.last_name),
         company_name = COALESCE(EXCLUDED.company_name, leads.company_name),
         title = COALESCE(EXCLUDED.title, leads.title),
         linkedin_url = COALESCE(EXCLUDED.linkedin_url, leads.linkedin_url),
         email_status = COALESCE(EXCLUDED.email_status, leads.email_status),
         processing_status = COALESCE(EXCLUDED.processing_status, leads.processing_status),
         processing_error = COALESCE(EXCLUDED.processing_error, leads.processing_error),
         batch_id = COALESCE(EXCLUDED.batch_id, leads.batch_id),
         priority = COALESCE(EXCLUDED.priority, leads.priority),
         updated_at = NOW()`,
      [
        lead.apollo_person_id || null,
        lead.first_name || null,
        lead.last_name || null,
        lead.email || null,
        lead.company_name || null,
        lead.title || null,
        lead.linkedin_url || null,
        lead.email_status || null,
        lead.processing_status || "new",
        lead.processing_error || null,
        lead.batch_id || null,
        lead.priority || 0
      ]
    );
    upsertedCount++;
  }
  return upsertedCount;
}
async function getLeadsByStatus(client, status, limit = 100) {
  const result = await client.query(
    `SELECT id, apollo_person_id, first_name, last_name, email, company_name, 
            title, linkedin_url, email_status, processing_status, 
            processing_error, batch_id, priority
     FROM leads
     WHERE processing_status = $1
     ORDER BY priority DESC, created_at ASC
     LIMIT $2`,
    [status, limit]
  );
  return result.rows;
}
async function updateLeadStatus(client, leadId, newStatus, errorMessage) {
  await client.query(
    `UPDATE leads 
     SET processing_status = $1, processing_error = $2, updated_at = NOW()
     WHERE id = $3`,
    [newStatus, errorMessage || null, leadId]
  );
}
async function batchUpdateLeadStatus(client, leadIds, newStatus, errorMessage) {
  if (leadIds.length === 0) return 0;
  const result = await client.query(
    `UPDATE leads 
     SET processing_status = $1, processing_error = $2, updated_at = NOW()
     WHERE id = ANY($3::uuid[])`,
    [newStatus, errorMessage || null, leadIds]
  );
  return result.rowCount || 0;
}
async function getPipelineStats(client) {
  const result = await client.query(
    `SELECT processing_status, COUNT(*) as count, 
            MIN(created_at) as oldest_created_at, 
            MAX(created_at) as newest_created_at
     FROM leads
     GROUP BY processing_status
     ORDER BY processing_status`
  );
  return result.rows;
}
function getSupabaseClient() {
  return getDb();
}
function getSupabaseEnv() {
  return { url: process.env.SUPABASE_DB_URL || "", key: "" };
}
var pool;
var init_supabase_pipeline = __esm({
  "lib/supabase-pipeline.ts"() {
    pool = null;
  }
});

// lib/supabase-legacy.ts
var supabase_legacy_exports = {};
__export(supabase_legacy_exports, {
  createWorkflowRun: () => createWorkflowRun,
  logApolloSearch: () => logApolloSearch
});
async function createWorkflowRun(client, workflowName) {
  const result = await client.query(
    `INSERT INTO workflow_runs (workflow_name, started_at, status) 
     VALUES ($1, NOW(), 'running') 
     RETURNING id`,
    [workflowName]
  );
  return result.rows[0].id;
}
async function logApolloSearch(client, searchData) {
  await client.query(
    `INSERT INTO apollo_search_log 
     (person_count, api_credits_used, search_params, executed_at)
     VALUES ($1, $2, $3, NOW())`,
    [
      searchData.person_count || 0,
      searchData.api_credits_used || 0,
      searchData.search_params ? JSON.stringify(searchData.search_params) : "{}"
    ]
  );
}
var init_supabase_legacy = __esm({
  "lib/supabase-legacy.ts"() {
  }
});

// scripts/test-pipeline.ts
init_supabase_pipeline();
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
console.log("\n\u{1F9EA} Testing Flexible Pipeline Architecture\n");
var testsPassed = 0;
var testsFailed = 0;
function pass(msg) {
  console.log(`\u2705 ${msg}`);
  testsPassed++;
}
function fail(msg, error = null) {
  console.log(`\u274C ${msg}`);
  if (error) console.log(`   Error: ${error.message || error}`);
  testsFailed++;
}
console.log("\u{1F4CA} Test 1: Database Connection");
var db = getDb();
if (db) {
  pass("Database connection pool created");
} else {
  fail("Failed to create database connection pool");
  process.exit(1);
}
console.log("\n\u{1F4CA} Test 2: Schema Verification");
try {
  const enumResult = await db.query(
    `SELECT EXISTS (
      SELECT 1 FROM pg_type WHERE typname = 'lead_processing_status'
    )`
  );
  if (enumResult.rows[0].exists) {
    pass("Enum lead_processing_status exists");
  } else {
    fail("Enum lead_processing_status not found");
  }
  const tables = ["leads", "pipeline_runs", "service_executions"];
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
  const leadsColumnsResult = await db.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'leads' 
     AND column_name IN ('processing_status', 'processing_error', 'batch_id', 'priority')`
  );
  if (leadsColumnsResult.rows.length === 4) {
    pass("All new columns in leads table exist");
  } else {
    fail(`Missing columns in leads table (found ${leadsColumnsResult.rows.length}/4)`);
  }
  const functions = ["get_leads_by_status", "update_lead_status", "batch_update_lead_status", "get_pipeline_stats"];
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
  fail("Schema verification failed", error);
}
console.log("\n\u{1F4CA} Test 3: Skill Files Exist");
var skillFiles = [
  "../skills/apollo/index.mjs",
  "../skills/bouncer/index.mjs",
  "../skills/instantly/index.mjs"
];
for (const file of skillFiles) {
  const fullPath = resolve(__dirname, file);
  if (existsSync(fullPath)) {
    pass(`Skill built: ${file}`);
  } else {
    fail(`Skill not built: ${file}`);
  }
}
console.log("\n\u{1F4CA} Test 4: Database Operations");
try {
  const stats = await getPipelineStats(db);
  pass(`getPipelineStats returned ${stats.length} status groups`);
  const runId = await createPipelineRun(db, {
    run_type: "test_run",
    target_count: 100,
    triggered_by: "test_script"
  });
  pass(`createPipelineRun created run: ${runId}`);
  await updatePipelineRun(db, runId, {
    status: "completed",
    completed_at: /* @__PURE__ */ new Date(),
    leads_processed: 100,
    leads_succeeded: 95,
    leads_failed: 5
  });
  pass("updatePipelineRun succeeded");
  const leads = await getLeadsByStatus(db, "apollo_matched", 10);
  pass(`getLeadsByStatus returned ${leads.length} leads`);
} catch (error) {
  fail("Database operations failed", error);
}
console.log("\n\u{1F4CA} Test 5: Library Imports");
try {
  const { getDb: getDbImport, createPipelineRun: createRunImport } = await Promise.resolve().then(() => (init_supabase_pipeline(), supabase_pipeline_exports));
  pass("supabase-pipeline.js imports successfully");
} catch (error) {
  fail("supabase-pipeline.js import failed", error);
}
try {
  const { createWorkflowRun: createWorkflowRun2 } = await Promise.resolve().then(() => (init_supabase_legacy(), supabase_legacy_exports));
  pass("supabase-legacy.js imports successfully");
} catch (error) {
  fail("supabase-legacy.js import failed", error);
}
await db.end();
console.log("\n" + "=".repeat(60));
console.log(`\u{1F4CA} Test Summary: ${testsPassed} passed, ${testsFailed} failed`);
console.log("=".repeat(60) + "\n");
if (testsFailed > 0) {
  console.log("\u274C Some tests failed. Please review the errors above.\n");
  process.exit(1);
} else {
  console.log("\u2705 All tests passed! Pipeline architecture is ready.\n");
  process.exit(0);
}
