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
async function getLeadsReadyForCampaign(client, limit = 1e4) {
  const result = await client.query(
    `SELECT id, apollo_person_id, first_name, last_name, email, company_name,
            title, linkedin_url, email_status, processing_status,
            processing_error, batch_id, priority
     FROM leads
     WHERE processing_status = 'bouncer_verified'
       AND (blacklisted = false OR blacklisted IS NULL)
     ORDER BY priority DESC, created_at ASC
     LIMIT $1`,
    [limit]
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
var INSTANTLY_BULK_ADD_MAX = 1e3;
async function instantlyAddLeads(leads) {
  var _a;
  if (leads.length === 0) return { success: 0, failed: 0, successIds: [] };
  const url = "https://api.instantly.ai/api/v2/leads/add";
  let totalSuccess = 0;
  let totalFailed = 0;
  const successIds = [];
  for (let offset = 0; offset < leads.length; offset += INSTANTLY_BULK_ADD_MAX) {
    const batch = leads.slice(offset, offset + INSTANTLY_BULK_ADD_MAX);
    const batchNum = Math.floor(offset / INSTANTLY_BULK_ADD_MAX) + 1;
    const totalBatches = Math.ceil(leads.length / INSTANTLY_BULK_ADD_MAX);
    const body = {
      campaign_id: INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      leads: batch.map((l) => ({
        email: l.email,
        first_name: l.first_name || null,
        last_name: l.last_name || null,
        company_name: l.company_name || null,
        personalization: l.title || null
      }))
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
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const uploaded = data.leads_uploaded ?? 0;
        const created = data.created_leads ?? [];
        totalSuccess += uploaded;
        for (const c of created) {
          const idx = c.index;
          if (typeof idx === "number" && ((_a = batch[idx]) == null ? void 0 : _a.id)) {
            successIds.push(batch[idx].id);
          }
        }
        const skipped = data.skipped_count ?? 0;
        const duped = data.duplicated_leads ?? 0;
        const invalid = data.invalid_email_count ?? 0;
        totalFailed += Math.max(0, batch.length - uploaded);
        console.log(`   \u2705 Batch ${batchNum}/${totalBatches}: ${uploaded} uploaded, ${skipped} skipped, ${duped} duped, ${invalid} invalid`);
      } else {
        totalFailed += batch.length;
        const msg = data.message || data.error || "";
        console.error(`   \u274C Batch ${batchNum}/${totalBatches} failed: ${response.status} ${msg}`);
      }
    } catch (error) {
      totalFailed += batch.length;
      console.error(`   \u274C Batch ${batchNum}/${totalBatches} error: ${error.message}`);
    }
    if (offset + INSTANTLY_BULK_ADD_MAX < leads.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return { success: totalSuccess, failed: totalFailed, successIds };
}
function getFetchDateRange() {
  const from = process.env.FETCH_DATE_FROM;
  const to = process.env.FETCH_DATE_TO;
  const single = process.env.FETCH_DATE || process.env.REPORT_DATE;
  if (from && to) {
    const [y1, m1, d1] = from.split("-").map(Number);
    const [y2, m2, d2] = to.split("-").map(Number);
    const minDate = new Date(Date.UTC(y1, (m1 || 1) - 1, d1 || 1));
    const maxDate = new Date(Date.UTC(y2, (m2 || 1) - 1, d2 || 1));
    maxDate.setUTCDate(maxDate.getUTCDate() + 1);
    return { min: minDate.toISOString(), max: maxDate.toISOString() };
  }
  if (single) {
    const [y, m, d] = single.split("-").map(Number);
    const dayStart = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    return { min: dayStart.toISOString(), max: dayEnd.toISOString() };
  }
  const now = /* @__PURE__ */ new Date();
  const localStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const localEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { min: localStart.toISOString(), max: localEnd.toISOString() };
}
async function instantlyFetchReplies(limit = 100) {
  const params = new URLSearchParams({
    campaign_id: INSTANTLY_CAMPAIGN_ID || "",
    email_type: "received",
    sort_order: "asc",
    limit: String(limit)
  });
  const { min, max } = getFetchDateRange();
  params.set("min_timestamp_created", min);
  params.set("max_timestamp_created", max);
  const url = `https://api.instantly.ai/api/v2/emails?${params.toString()}`;
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${INSTANTLY_API_KEY}` }
  });
  if (!response.ok) {
    throw new Error(`Instantly fetch replies failed: ${response.status}`);
  }
  const data = await response.json();
  const raw = data.items || data.emails || [];
  return raw.map((e) => {
    var _a, _b;
    return {
      email_id: e.id,
      eaccount: e.eaccount || process.env.INSTANTLY_EACCOUNT || "",
      // eaccount from GET /emails response
      from_email: e.from_address_email || e.lead || e.from_email,
      body: (((_a = e.body) == null ? void 0 : _a.text) || ((_b = e.body) == null ? void 0 : _b.html) || "").trim(),
      subject: e.subject || "",
      thread_id: e.thread_id || e.id
    };
  });
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
var BOOK_NOW_URL = "https://designpickle.com/design-pickle-consultation?ref=outbound";
var COMPARE_URL = "https://designpickle.com/comparison";
function buildHotReplyTemplate(firstName) {
  const name = firstName || "there";
  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${BOOK_NOW_URL}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>\u{1F449} <a href="${COMPARE_URL}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},

You can schedule here: Book now
${BOOK_NOW_URL}

Have a look at this before we connect. Quickly covers us vs. alternatives.
\u{1F449} Compare Design Pickle
${COMPARE_URL}

See you then.
-Bryan Butvidas`;
  return { html, text };
}
async function instantlyReplyToEmail(params) {
  const url = "https://api.instantly.ai/api/v2/emails/reply";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${INSTANTLY_API_KEY}`
    },
    body: JSON.stringify({
      reply_to_uuid: params.reply_to_uuid,
      eaccount: params.eaccount,
      subject: params.subject || "Re: Your inquiry",
      body: { html: params.body_html, text: params.body_text }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly reply failed: ${response.status} ${text}`);
  }
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
  console.log(`
\u{1F4E4} Load Service: Pushing verified leads to Instantly...
`);
  const verifiedLeads = await getLeadsReadyForCampaign(db, 1e4);
  if (verifiedLeads.length === 0) {
    console.log("\u2139\uFE0F  No verified leads to load (bouncer_verified, not blacklisted, 45-day ok)\n");
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  console.log(`\u{1F4CA} Found ${verifiedLeads.length} verified leads ready for campaign
`);
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
      await db.query(
        `UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [successIds]
      );
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
  var _a, _b;
  const { min, max } = getFetchDateRange();
  const dateLabel = process.env.FETCH_DATE_FROM && process.env.FETCH_DATE_TO ? `${process.env.FETCH_DATE_FROM} \u2192 ${process.env.FETCH_DATE_TO}` : process.env.FETCH_DATE || process.env.REPORT_DATE || "today";
  console.log(`
\u{1F4E5} Fetch & Classify Service: Processing replies (${dateLabel}, ${min.slice(0, 10)} \u2192 ${max.slice(0, 10)})...
`);
  try {
    const unread = await instantlyGetUnreadCount();
    console.log(`   \u{1F4EC} Unread count: ${unread}
`);
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
      console.log(`\u2139\uFE0F  No replies for ${dateLabel}
`);
      await updateServiceExecution(db, execId, {
        status: "completed",
        completed_at: /* @__PURE__ */ new Date(),
        output_count: 0
      });
      return { processed: 0, hot: 0, soft: 0, objection: 0, negative: 0 };
    }
    console.log(`\u{1F4CA} Found ${replies.length} replies
`);
    const threadIds = replies.map((r) => r.thread_id).filter(Boolean);
    const alreadyRepliedRes = threadIds.length > 0 ? await db.query(
      `SELECT thread_id FROM replies WHERE thread_id = ANY($1::text[]) AND replied_at IS NOT NULL`,
      [threadIds]
    ) : { rows: [] };
    const alreadyReplied = new Set(alreadyRepliedRes.rows.map((r) => r.thread_id));
    const toProcess = replies.filter((r) => !alreadyReplied.has(r.thread_id));
    if (alreadyReplied.size > 0) {
      console.log(`   \u23ED\uFE0F  Skipping ${alreadyReplied.size} already auto-replied
`);
    }
    if (toProcess.length === 0) {
      console.log(`\u2139\uFE0F  No new replies to process
`);
      await updateServiceExecution(db, execId, { status: "completed", completed_at: /* @__PURE__ */ new Date(), output_count: 0 });
      return { processed: 0, hot: 0, soft: 0, objection: 0, negative: 0 };
    }
    let hot = 0, soft = 0, objection = 0, negative = 0;
    for (const reply of toProcess) {
      try {
        const classification = await classifyReply(reply.body || "");
        console.log(`   ${reply.from_email}: ${classification.category} (confidence: ${classification.confidence})`);
        const bodySnippet = (reply.body || "").substring(0, 500);
        await db.query(
          `INSERT INTO replies 
           (from_email, subject, body_snippet, thread_id, reply_category, category_confidence, 
            reply_text, timestamp, fetched_at, classified_at)
           VALUES ($1, $2, $3, $4, $5::reply_category, $6, $3, NOW(), NOW(), NOW())
           ON CONFLICT (thread_id) DO UPDATE SET
             reply_category = EXCLUDED.reply_category,
             category_confidence = EXCLUDED.category_confidence,
             classified_at = EXCLUDED.classified_at,
             updated_at = NOW()`,
          [
            reply.from_email,
            reply.subject || "",
            bodySnippet,
            reply.thread_id || `thread-${Date.now()}`,
            classification.category,
            classification.confidence
          ]
        );
        if (classification.category === "negative") {
          const leadRes = await db.query(
            `SELECT id FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
            [reply.from_email]
          );
          if (leadRes.rows.length > 0) {
            await db.query(
              `UPDATE leads SET blacklisted = true, blacklist_reason = 'negative_reply', updated_at = NOW() WHERE id = $1`,
              [leadRes.rows[0].id]
            );
            console.log(`   \u26D4 Blacklisted lead: ${reply.from_email}`);
          }
        }
        if (classification.category === "hot") {
          hot++;
          if (reply.email_id && reply.eaccount) {
            try {
              const leadRes = await db.query(
                `SELECT first_name FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
                [reply.from_email]
              );
              const firstName = ((_b = (_a = leadRes.rows[0]) == null ? void 0 : _a.first_name) == null ? void 0 : _b.trim()) || "";
              const { html, text } = buildHotReplyTemplate(firstName);
              const subject = (reply.subject || "").startsWith("Re:") ? reply.subject : `Re: ${reply.subject || "Your inquiry"}`;
              await instantlyReplyToEmail({
                reply_to_uuid: reply.email_id,
                eaccount: reply.eaccount,
                subject,
                body_html: html,
                body_text: text
              });
              await db.query(
                `UPDATE replies SET replied_at = NOW(), updated_at = NOW() WHERE thread_id = $1`,
                [reply.thread_id]
              );
              console.log(`   \u{1F4E4} Replied to hot lead: ${reply.from_email}`);
              await new Promise((r) => setTimeout(r, 300));
            } catch (err) {
              console.error(`   \u274C Reply failed for ${reply.from_email}: ${err.message}`);
            }
          } else {
            console.log(`   \u26A0\uFE0F  Skip reply (missing email_id/eaccount): ${reply.from_email}`);
          }
        } else if (classification.category === "soft") soft++;
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
      output_count: toProcess.length
    });
    console.log(`
\u2705 Classification complete:
`);
    console.log(`   Hot: ${hot}`);
    console.log(`   Soft: ${soft}`);
    console.log(`   Objection: ${objection}`);
    console.log(`   Negative: ${negative}\\n`);
    return { processed: toProcess.length, hot, soft, objection, negative };
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
