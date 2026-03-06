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

// skills/instantly/index.ts
var INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;
var INSTANTLY_CAMPAIGN_ID = process.env.INSTANTLY_CAMPAIGN_ID;
var OPENAI_API_KEY = process.env.OPENAI_API_KEY;
var MODE = process.env.MODE || "all";
if (!INSTANTLY_API_KEY) {
  console.error("\u274C INSTANTLY_API_KEY not found in env");
  process.exit(1);
}
if (!INSTANTLY_CAMPAIGN_ID) {
  console.error("\u274C INSTANTLY_CAMPAIGN_ID not found in env");
  process.exit(1);
}
async function instantlyAddLeads(leads) {
  if (leads.length === 0) return { success: 0, failed: 0, successIds: [] };
  const url = `https://api.instantly.ai/api/v2/leads/add`;
  let success = 0;
  let failed = 0;
  const successIds = [];
  for (const lead of leads) {
    const body = {
      campaign_id: INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,
      leads: [
        {
          email: lead.email,
          first_name: lead.first_name || null,
          last_name: lead.last_name || null,
          company_name: lead.company_name || null,
          personalization: lead.title || null
        }
      ]
    };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${INSTANTLY_API_KEY}`
        },
        body: JSON.stringify(body)
      });
      if (response.ok) {
        success++;
        if (lead.id) successIds.push(lead.id);
      } else {
        failed++;
        const text = await response.text().catch(() => "");
        const detail = text ? ` ${text.slice(0, 300)}` : "";
        console.error(`      \u274C Failed to add ${lead.email}: ${response.status}${detail}`);
      }
    } catch (error) {
      failed++;
      console.error(`      \u274C Error adding ${lead.email}: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { success, failed, successIds };
}
async function instantlyFetchReplies(limit = 100) {
  const url = `https://api.instantly.ai/api/v2/emails?campaign_id=${INSTANTLY_CAMPAIGN_ID}&email_type=received&sort_order=asc&limit=${limit}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${INSTANTLY_API_KEY}`
    }
  });
  if (!response.ok) {
    throw new Error(`Instantly fetch replies failed: ${response.status}`);
  }
  const data = await response.json();
  return data.emails || [];
}
async function instantlyGetUnreadCount() {
  const url = `https://api.instantly.ai/api/v2/emails/unread/count?campaign_id=${INSTANTLY_CAMPAIGN_ID}`;
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${INSTANTLY_API_KEY}`
    }
  });
  if (!response.ok) {
    throw new Error(`Instantly unread count failed: ${response.status}`);
  }
  const data = await response.json();
  return typeof data.count === "number" ? data.count : data.unread_count ?? 0;
}
async function classifyReply(replyText) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not found");
  }
  const prompt = `Classify this outbound email reply into one of four categories:
- hot (ready to talk)
- soft (interested but timing issue)
- objection (decline with reason)
- negative (unsubscribe or hard no)

Reply: ${replyText}

Return JSON only: { "category": "...", "confidence": 0-1 }`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI API failed: ${response.status}`);
  }
  const data = await response.json();
  const content = data.choices[0].message.content;
  try {
    const parsed = JSON.parse(content);
    return {
      category: parsed.category || "objection",
      confidence: parsed.confidence || 0
    };
  } catch {
    return { category: "objection", confidence: 0 };
  }
}
async function runLoadService(db, runId) {
  console.log(`\\n\u{1F4E4} Load Service: Pushing verified leads to Instantly...\\n`);
  const verifiedLeads = await getLeadsByStatus(db, "bouncer_verified", 1e4);
  if (verifiedLeads.length === 0) {
    console.log("\u2139\uFE0F  No verified leads to load (status=bouncer_verified)\\n");
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  console.log(`\u{1F4CA} Found ${verifiedLeads.length} verified leads\\n`);
  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: "instantly",
    status: "running",
    input_count: verifiedLeads.length
  });
  try {
    const { success, failed, successIds } = await instantlyAddLeads(verifiedLeads);
    if (successIds.length > 0) {
      await batchUpdateLeadStatus(db, successIds, "instantly_loaded");
    }
    await updateServiceExecution(db, execId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      output_count: success,
      failed_count: failed
    });
    console.log(`\\n\u2705 Load complete: ${success} loaded, ${failed} failed\\n`);
    return { processed: verifiedLeads.length, succeeded: success, failed };
  } catch (error) {
    console.error(`\\n\u274C Load failed: ${error.message}\\n`);
    await updateServiceExecution(db, execId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      error_message: error.message
    });
    throw error;
  }
}
async function runFetchAndClassifyService(db, runId) {
  console.log(`\\n\u{1F4E5} Fetch & Classify Service: Processing replies...\\n`);
  try {
    const unread = await instantlyGetUnreadCount();
    console.log(`   \u{1F4EC} Unread count: ${unread}\\n`);
  } catch {
  }
  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: "instantly",
    status: "running"
  });
  try {
    const replies = await instantlyFetchReplies(100);
    if (replies.length === 0) {
      console.log("\u2139\uFE0F  No new replies\\n");
      await updateServiceExecution(db, execId, {
        status: "completed",
        completed_at: /* @__PURE__ */ new Date(),
        output_count: 0
      });
      return { processed: 0, hot: 0, soft: 0, objection: 0, negative: 0 };
    }
    console.log(`\u{1F4CA} Found ${replies.length} replies\\n`);
    let hot = 0, soft = 0, objection = 0, negative = 0;
    for (const reply of replies) {
      try {
        const classification = await classifyReply(reply.body || "");
        console.log(`   ${reply.from_email}: ${classification.category} (confidence: ${classification.confidence})`);
        await db.query(
          `INSERT INTO replies 
           (from_email, subject, body_snippet, thread_id, reply_category, category_confidence, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (thread_id) DO UPDATE SET
             reply_category = EXCLUDED.reply_category,
             category_confidence = EXCLUDED.category_confidence,
             updated_at = NOW()`,
          [
            reply.from_email,
            reply.subject || "",
            (reply.body || "").substring(0, 500),
            reply.thread_id || `thread-${Date.now()}`,
            classification.category,
            classification.confidence
          ]
        );
        if (classification.category === "hot") hot++;
        else if (classification.category === "soft") soft++;
        else if (classification.category === "objection") objection++;
        else negative++;
      } catch (error) {
        console.error(`   \u274C Error processing reply from ${reply.from_email}: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await updateServiceExecution(db, execId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      output_count: replies.length
    });
    console.log(`\\n\u2705 Classification complete:\\n`);
    console.log(`   Hot: ${hot}`);
    console.log(`   Soft: ${soft}`);
    console.log(`   Objection: ${objection}`);
    console.log(`   Negative: ${negative}\\n`);
    return { processed: replies.length, hot, soft, objection, negative };
  } catch (error) {
    console.error(`\\n\u274C Fetch & classify failed: ${error.message}\\n`);
    await updateServiceExecution(db, execId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      error_message: error.message
    });
    throw error;
  }
}
async function main() {
  console.log(`\\n\u{1F680} Instantly Service Starting (MODE: ${MODE})\\n`);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const runId = await createPipelineRun(db, {
    run_type: `instantly_${MODE}`,
    triggered_by: "manual"
  });
  try {
    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0;
    if (MODE === "load" || MODE === "all") {
      const loadResult = await runLoadService(db, runId);
      totalProcessed += loadResult.processed;
      totalSucceeded += loadResult.succeeded;
      totalFailed += loadResult.failed;
    }
    if (MODE === "fetch" || MODE === "classify" || MODE === "all") {
      const fetchResult = await runFetchAndClassifyService(db, runId);
      totalProcessed += fetchResult.processed;
      totalSucceeded += fetchResult.processed;
    }
    await updatePipelineRun(db, runId, {
      status: "completed",
      completed_at: /* @__PURE__ */ new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalSucceeded,
      leads_failed: totalFailed
    });
    console.log(`\u2705 Instantly Service Complete\\n`);
  } catch (error) {
    console.error(`\\n\u274C Instantly Service Failed: ${error.message}\\n`);
    await updatePipelineRun(db, runId, {
      status: "failed",
      completed_at: /* @__PURE__ */ new Date(),
      error_message: error.message
    });
    process.exit(1);
  } finally {
    await db.end();
  }
}
main();
