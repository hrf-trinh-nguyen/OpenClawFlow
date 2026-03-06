// lib/state.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
function getStateDir() {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  for (const levels of [2, 3]) {
    const root = resolve(scriptDir, ...Array(levels).fill(".."));
    const statePath = resolve(root, "state");
    if (existsSync(statePath)) return statePath;
  }
  return resolve(scriptDir, "../../..", "state");
}
var STATE_DIR = getStateDir();
function stateGet(key) {
  try {
    return JSON.parse(readFileSync(resolve(STATE_DIR, `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

// lib/supabase.ts
import pg from "pg";
var { Pool } = pg;
var pool = null;
function getDb() {
  var _a, _b;
  const url = (_b = (_a = process.env.SUPABASE_DB_URL) == null ? void 0 : _a.trim) == null ? void 0 : _b.call(_a).replace(/^['"]|['"]$/g, "");
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url });
  return pool;
}
function getSupabaseEnv(_config) {
  return getDb() ? { url: "pg", key: "pg" } : null;
}
function getSupabaseClient(_url, _key) {
  const p = getDb();
  if (!p) throw new Error("SUPABASE_DB_URL must be set in .env for database writes");
  return p;
}
async function completeWorkflowRun(client, workflowRunId, status, errorMessage) {
  await client.query(
    `UPDATE workflow_runs SET status = $1, completed_at = NOW(), error_message = $2 WHERE id = $3`,
    [status, errorMessage ?? null, workflowRunId]
  );
}
async function createSkillExecution(client, workflowRunId, skillName, inputData) {
  const { rows } = await client.query(
    `INSERT INTO skill_executions (workflow_run_id, skill_name, status, input_data)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [workflowRunId, skillName, inputData ? JSON.stringify(inputData) : null]
  );
  if (!rows[0]) throw new Error("Failed to create skill execution");
  return rows[0].id;
}
async function completeSkillExecution(client, skillExecutionId, status, outputData, durationMs, errorMessage) {
  await client.query(
    `UPDATE skill_executions SET status = $1, completed_at = NOW(), output_data = $2, duration_ms = $3, error_message = $4 WHERE id = $5`,
    [status, outputData ? JSON.stringify(outputData) : null, durationMs ?? null, errorMessage ?? null, skillExecutionId]
  );
}

// skills/slack-notify/index.ts
async function main() {
  const startTime = Date.now();
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_REPORT_CHANNEL;
  if (!botToken || !channel) {
    console.error("Error: Missing SLACK_BOT_TOKEN or SLACK_REPORT_CHANNEL");
    process.exit(1);
  }
  const text = stateGet("daily_report_text") ?? "";
  if (!text) {
    console.error("Error: No daily_report_text in state \u2014 run report-build first");
    process.exit(1);
  }
  let supabase = null;
  let skillExecutionId = null;
  const workflowRunId = stateGet("workflow_run_id");
  try {
    const env = getSupabaseEnv({});
    if (env && workflowRunId) {
      supabase = getSupabaseClient(env.url, env.key);
      skillExecutionId = await createSkillExecution(supabase, workflowRunId, "slack-notify", { channel });
    }
  } catch (dbErr) {
    console.log(`  [Supabase] Warning: ${dbErr.message}`);
  }
  console.log(`Slack Notify \u2013 sending report to channel ${channel}`);
  try {
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text })
    });
    if (!resp.ok) throw new Error(`Slack API ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(`Slack error: ${json.error}`);
    console.log(`  Report sent to channel ${channel}`);
    if (supabase) {
      try {
        if (skillExecutionId) await completeSkillExecution(supabase, skillExecutionId, "completed", { channel, sent: true }, Date.now() - startTime);
        if (workflowRunId) await completeWorkflowRun(supabase, workflowRunId, "completed");
        console.log("  [Supabase] Workflow run completed.");
      } catch (dbErr) {
        console.log(`  [Supabase] Warning: ${dbErr.message}`);
      }
    }
    console.log("Done: report sent to Slack");
  } catch (err) {
    if (supabase) {
      try {
        if (skillExecutionId) await completeSkillExecution(supabase, skillExecutionId, "failed", void 0, Date.now() - startTime, err.message);
        if (workflowRunId) await completeWorkflowRun(supabase, workflowRunId, "failed", err.message);
      } catch {
      }
    }
    console.error(`Error: Slack send failed: ${err.message}`);
    process.exit(1);
  }
}
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
