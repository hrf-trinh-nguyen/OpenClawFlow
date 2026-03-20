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
function getSupabaseClient() {
  return getDb();
}
function getSupabaseEnv() {
  return { url: process.env.SUPABASE_DB_URL || "", key: "" };
}

// lib/db/pipeline-runs.ts
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
async function insertNewLeads(client, leads, options) {
  if (leads.length === 0) return { inserted: 0, skippedExisting: 0, skippedDuplicate: 0 };
  const emails = leads.map((l) => l.email).filter((e) => e && typeof e === "string");
  const existing = await getExistingEmails(client, emails);
  const blacklistRes = await client.query(
    `SELECT LOWER(TRIM(email)) as email FROM leads WHERE blacklisted = true AND email IS NOT NULL`
  );
  const blacklisted = new Set(blacklistRes.rows.map((r) => r.email));
  const newLeads = leads.filter(
    (l) => l.email && !existing.has(l.email.trim().toLowerCase()) && !blacklisted.has(l.email.trim().toLowerCase())
  );
  const skippedExisting = leads.length - newLeads.length;
  if (newLeads.length === 0) {
    return { inserted: 0, skippedExisting, skippedDuplicate: 0 };
  }
  const batchId = (options == null ? void 0 : options.batchId) ?? null;
  const priority = (options == null ? void 0 : options.priority) ?? 0;
  let inserted = 0;
  for (const lead of newLeads) {
    const res = await client.query(
      `INSERT INTO leads 
       (apollo_person_id, first_name, last_name, email, company_name, title, 
        linkedin_url, email_status, processing_status, processing_error, 
        batch_id, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        lead.apollo_person_id || null,
        lead.first_name || null,
        lead.last_name || null,
        lead.email || null,
        lead.company_name || null,
        lead.title || null,
        lead.linkedin_url || null,
        lead.email_status || null,
        lead.processing_status || "apollo_matched",
        lead.processing_error || null,
        batchId,
        priority
      ]
    );
    if (res.rowCount && res.rowCount > 0) inserted++;
  }
  return { inserted, skippedExisting, skippedDuplicate: 0 };
}
async function upsertLeads(client, leads) {
  const { inserted } = await insertNewLeads(client, leads);
  return inserted;
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
async function getInstantlyLoadedCountToday(client) {
  var _a;
  const result = await client.query(
    `SELECT COUNT(*)::int AS c FROM leads
     WHERE processing_status = 'instantly_loaded'
       AND (updated_at AT TIME ZONE 'America/New_York')::date =
           (NOW() AT TIME ZONE 'America/New_York')::date`
  );
  return Number(((_a = result.rows[0]) == null ? void 0 : _a.c) ?? 0);
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

// lib/db/reports.ts
var BUSINESS_TZ = "America/New_York";
async function getMetricsForReport(client, reportDate) {
  var _a;
  const metrics = {
    person_ids_count: 0,
    leads_pulled: 0,
    leads_validated: 0,
    leads_removed: 0,
    pushed_ok: 0,
    pushed_failed: 0,
    replies_fetched: 0,
    hot_count: 0,
    soft_count: 0,
    objection_count: 0,
    negative_count: 0,
    out_of_office_count: 0,
    auto_reply_count: 0,
    not_a_reply_count: 0,
    deliverable_rate: 0,
    bounce_rate: 0,
    spam_complaint_rate: 0
  };
  const apolloRes = await client.query(
    `SELECT COALESCE(SUM(se.input_count), 0)::int as person_ids,
            COALESCE(SUM(se.output_count), 0)::int as leads_pulled
     FROM service_executions se
     JOIN pipeline_runs pr ON se.pipeline_run_id = pr.id
     WHERE pr.run_type = 'apollo_collection' AND se.service_name = 'apollo'
       AND (pr.completed_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (apolloRes.rows[0]) {
    metrics.person_ids_count = Number(apolloRes.rows[0].person_ids) || 0;
    metrics.leads_pulled = Number(apolloRes.rows[0].leads_pulled) || 0;
  }
  const bouncerRes = await client.query(
    `SELECT COALESCE(SUM(se.output_count), 0)::int as validated,
            COALESCE(SUM(se.failed_count), 0)::int as removed
     FROM service_executions se
     JOIN pipeline_runs pr ON se.pipeline_run_id = pr.id
     WHERE pr.run_type = 'bouncer_verify' AND se.service_name = 'bouncer'
       AND (pr.completed_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (bouncerRes.rows[0]) {
    metrics.leads_validated = Number(bouncerRes.rows[0].validated) || 0;
    metrics.leads_removed = Number(bouncerRes.rows[0].removed) || 0;
  }
  const instRes = await client.query(
    `SELECT COALESCE(SUM(se.output_count), 0)::int as ok,
            COALESCE(SUM(se.failed_count), 0)::int as failed
     FROM service_executions se
     JOIN pipeline_runs pr ON se.pipeline_run_id = pr.id
     WHERE pr.run_type = 'instantly_load' AND se.service_name = 'instantly'
       AND (pr.completed_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (instRes.rows[0]) {
    metrics.pushed_ok = Number(instRes.rows[0].ok) || 0;
    metrics.pushed_failed = Number(instRes.rows[0].failed) || 0;
  }
  const repliesRes = await client.query(
    `SELECT COUNT(*)::int as cnt FROM replies WHERE (fetched_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date`,
    [reportDate]
  );
  metrics.replies_fetched = Number((_a = repliesRes.rows[0]) == null ? void 0 : _a.cnt) || 0;
  const repliesClassRes = await client.query(
    `SELECT reply_category as category, COUNT(*)::int as cnt
     FROM replies
     WHERE reply_category IS NOT NULL AND (classified_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date
     GROUP BY reply_category`,
    [reportDate]
  );
  if (repliesClassRes.rows.length > 0) {
    for (const row of repliesClassRes.rows) {
      const c = Number(row.cnt) || 0;
      if (row.category === "hot") metrics.hot_count = c;
      else if (row.category === "soft") metrics.soft_count = c;
      else if (row.category === "objection") metrics.objection_count = c;
      else if (row.category === "negative") metrics.negative_count = c;
      else if (row.category === "out_of_office") metrics.out_of_office_count = c;
      else if (row.category === "auto_reply") metrics.auto_reply_count = c;
      else if (row.category === "not_a_reply") metrics.not_a_reply_count = c;
    }
  } else {
    const classRes = await client.query(
      `SELECT rc.category, COUNT(*)::int as cnt
       FROM reply_classifications rc
       JOIN replies r ON rc.reply_id = r.id
       WHERE (rc.classified_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date
       GROUP BY rc.category`,
      [reportDate]
    );
    for (const row of classRes.rows) {
      const c = Number(row.cnt) || 0;
      if (row.category === "hot") metrics.hot_count = c;
      else if (row.category === "soft") metrics.soft_count = c;
      else if (row.category === "objection") metrics.objection_count = c;
      else if (row.category === "negative") metrics.negative_count = c;
      else if (row.category === "out_of_office") metrics.out_of_office_count = c;
      else if (row.category === "auto_reply") metrics.auto_reply_count = c;
      else if (row.category === "not_a_reply") metrics.not_a_reply_count = c;
    }
  }
  const totalChecked = metrics.leads_validated + metrics.leads_removed;
  metrics.deliverable_rate = metrics.leads_pulled > 0 ? Math.round(metrics.leads_validated / metrics.leads_pulled * 1e3) / 10 : 0;
  metrics.bounce_rate = totalChecked > 0 ? Math.round(metrics.leads_removed / totalChecked * 1e4) / 100 : 0;
  metrics.spam_complaint_rate = 0;
  return metrics;
}
async function upsertDailyReport(client, reportDate, metrics, reportJson, options) {
  const campaignId = (options == null ? void 0 : options.campaignId) ?? null;
  const sent = (options == null ? void 0 : options.sent) ?? 0;
  const opened = (options == null ? void 0 : options.opened) ?? 0;
  const replies = (options == null ? void 0 : options.replies) ?? 0;
  await client.query(
    `INSERT INTO daily_reports (
       report_date, pipeline_run_id, campaign_id, person_ids_count, leads_pulled, leads_validated, leads_removed,
       pushed_ok, pushed_failed, replies_fetched, hot_count, soft_count, objection_count, negative_count,
       deliverable_rate, bounce_rate, spam_complaint_rate, sent, opened, replies, report_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     ON CONFLICT (report_date) DO UPDATE SET
       pipeline_run_id = COALESCE(EXCLUDED.pipeline_run_id, daily_reports.pipeline_run_id),
       campaign_id = COALESCE(EXCLUDED.campaign_id, daily_reports.campaign_id),
       person_ids_count = EXCLUDED.person_ids_count, leads_pulled = EXCLUDED.leads_pulled,
       leads_validated = EXCLUDED.leads_validated, leads_removed = EXCLUDED.leads_removed,
       pushed_ok = EXCLUDED.pushed_ok, pushed_failed = EXCLUDED.pushed_failed,
       replies_fetched = EXCLUDED.replies_fetched, hot_count = EXCLUDED.hot_count,
       soft_count = EXCLUDED.soft_count, objection_count = EXCLUDED.objection_count,
       negative_count = EXCLUDED.negative_count, deliverable_rate = EXCLUDED.deliverable_rate,
       bounce_rate = EXCLUDED.bounce_rate, spam_complaint_rate = EXCLUDED.spam_complaint_rate,
       sent = EXCLUDED.sent, opened = EXCLUDED.opened, replies = EXCLUDED.replies,
       report_json = EXCLUDED.report_json`,
    [
      reportDate,
      (options == null ? void 0 : options.pipelineRunId) ?? null,
      campaignId,
      metrics.person_ids_count,
      metrics.leads_pulled,
      metrics.leads_validated,
      metrics.leads_removed,
      metrics.pushed_ok,
      metrics.pushed_failed,
      metrics.replies_fetched,
      metrics.hot_count,
      metrics.soft_count,
      metrics.objection_count,
      metrics.negative_count,
      metrics.deliverable_rate,
      metrics.bounce_rate,
      metrics.spam_complaint_rate,
      sent,
      opened,
      replies,
      JSON.stringify(reportJson)
    ]
  );
}
async function upsertCampaignDailyAnalytics(client, reportDate, campaignId, data) {
  const contacted = data.contacted ?? 0;
  const newLeadsContacted = data.new_leads_contacted ?? 0;
  const opened = data.opened ?? 0;
  const uniqueOpened = data.unique_opened ?? data.opened ?? 0;
  const replies = data.replies ?? 0;
  const uniqueReplies = data.unique_replies ?? data.replies ?? 0;
  const repliesAutomatic = data.replies_automatic ?? 0;
  const uniqueRepliesAutomatic = data.unique_replies_automatic ?? 0;
  const clicks = data.clicks ?? 0;
  const uniqueClicks = data.unique_clicks ?? 0;
  await client.query(
    `INSERT INTO campaign_daily_analytics (
       report_date, campaign_id, sent, contacted, new_leads_contacted,
       opened, unique_opened, replies, unique_replies, replies_automatic, unique_replies_automatic,
       clicks, unique_clicks, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
     ON CONFLICT (report_date, campaign_id) DO UPDATE SET
       sent = EXCLUDED.sent, contacted = EXCLUDED.contacted, new_leads_contacted = EXCLUDED.new_leads_contacted,
       opened = EXCLUDED.opened, unique_opened = EXCLUDED.unique_opened,
       replies = EXCLUDED.replies, unique_replies = EXCLUDED.unique_replies,
       replies_automatic = EXCLUDED.replies_automatic, unique_replies_automatic = EXCLUDED.unique_replies_automatic,
       clicks = EXCLUDED.clicks, unique_clicks = EXCLUDED.unique_clicks, updated_at = NOW()`,
    [
      reportDate,
      campaignId,
      data.sent,
      contacted,
      newLeadsContacted,
      opened,
      uniqueOpened,
      replies,
      uniqueReplies,
      repliesAutomatic,
      uniqueRepliesAutomatic,
      clicks,
      uniqueClicks
    ]
  );
}
async function getDailyReportsByMonth(client, year, month) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const result = await client.query(
    `SELECT report_date::text, campaign_id, person_ids_count, leads_pulled, leads_validated, leads_removed,
            pushed_ok, pushed_failed, replies_fetched, hot_count, soft_count, objection_count, negative_count,
            deliverable_rate, bounce_rate, spam_complaint_rate,
            COALESCE(sent, 0) as sent, COALESCE(opened, 0) as opened, COALESCE(replies, 0) as replies
     FROM daily_reports
     WHERE report_date >= $1::date AND report_date < $1::date + INTERVAL '1 month'
     ORDER BY report_date ASC`,
    [startDate]
  );
  return result.rows.map((r) => ({
    report_date: r.report_date,
    person_ids_count: Number(r.person_ids_count) || 0,
    leads_pulled: Number(r.leads_pulled) || 0,
    leads_validated: Number(r.leads_validated) || 0,
    leads_removed: Number(r.leads_removed) || 0,
    pushed_ok: Number(r.pushed_ok) || 0,
    pushed_failed: Number(r.pushed_failed) || 0,
    replies_fetched: Number(r.replies_fetched) || 0,
    hot_count: Number(r.hot_count) || 0,
    soft_count: Number(r.soft_count) || 0,
    objection_count: Number(r.objection_count) || 0,
    negative_count: Number(r.negative_count) || 0,
    out_of_office_count: 0,
    auto_reply_count: 0,
    not_a_reply_count: 0,
    deliverable_rate: Number(r.deliverable_rate) || 0,
    bounce_rate: Number(r.bounce_rate) || 0,
    spam_complaint_rate: Number(r.spam_complaint_rate) || 0,
    sent: Number(r.sent) || 0,
    opened: Number(r.opened) || 0,
    replies: Number(r.replies) || 0
  }));
}
export {
  batchUpdateLeadStatus,
  createPipelineRun,
  createServiceExecution,
  getDailyReportsByMonth,
  getDb,
  getExistingEmails,
  getInstantlyLoadedCountToday,
  getLeadsByStatus,
  getLeadsReadyForCampaign,
  getMetricsForReport,
  getPipelineStats,
  getSupabaseClient,
  getSupabaseEnv,
  insertNewLeads,
  updateLeadStatus,
  updatePipelineRun,
  updateServiceExecution,
  upsertCampaignDailyAnalytics,
  upsertDailyReport,
  upsertLeads
};
