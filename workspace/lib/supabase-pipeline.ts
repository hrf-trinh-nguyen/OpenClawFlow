import { Pool } from 'pg';

// ── Database Connection ────────────────────────────────────────────

let pool: Pool | null = null;

export function getDb(): Pool | null {
  if (!process.env.SUPABASE_DB_URL) {
    console.warn('⚠️  SUPABASE_DB_URL not found in env');
    return null;
  }
  
  if (!pool) {
    const connString = process.env.SUPABASE_DB_URL.trim().replace(/^['"]|['"]$/g, '');
    pool = new Pool({ connectionString: connString });
    console.log('✅ PostgreSQL connection pool created');
  }
  
  return pool;
}

export type DbClient = Pool | any;

// ── Pipeline Runs ──────────────────────────────────────────────────

export interface PipelineRun {
  id?: string;
  run_type: string;
  target_count?: number;
  started_at?: Date;
  completed_at?: Date;
  status?: string;
  leads_processed?: number;
  leads_succeeded?: number;
  leads_failed?: number;
  triggered_by?: string;
  icp_filters?: any;
  error_message?: string;
}

export async function createPipelineRun(
  client: DbClient,
  run: PipelineRun
): Promise<string> {
  const result = await client.query(
    `INSERT INTO pipeline_runs 
     (run_type, target_count, status, triggered_by, icp_filters)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      run.run_type,
      run.target_count || null,
      run.status || 'running',
      run.triggered_by || 'manual',
      run.icp_filters ? JSON.stringify(run.icp_filters) : null
    ]
  );
  return result.rows[0].id;
}

export async function updatePipelineRun(
  client: DbClient,
  runId: string,
  updates: Partial<PipelineRun>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== undefined) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.leads_processed !== undefined) {
    fields.push(`leads_processed = $${idx++}`);
    values.push(updates.leads_processed);
  }
  if (updates.leads_succeeded !== undefined) {
    fields.push(`leads_succeeded = $${idx++}`);
    values.push(updates.leads_succeeded);
  }
  if (updates.leads_failed !== undefined) {
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
    `UPDATE pipeline_runs SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );
}

// ── Service Executions ─────────────────────────────────────────────

export interface ServiceExecution {
  id?: string;
  pipeline_run_id?: string;
  service_name: string;
  started_at?: Date;
  completed_at?: Date;
  status?: string;
  input_count?: number;
  output_count?: number;
  failed_count?: number;
  api_calls_made?: number;
  api_errors?: number;
  rate_limit_hits?: number;
  batch_size?: number;
  error_message?: string;
  execution_metadata?: any;
}

export async function createServiceExecution(
  client: DbClient,
  exec: ServiceExecution
): Promise<string> {
  const result = await client.query(
    `INSERT INTO service_executions 
     (pipeline_run_id, service_name, status, input_count, batch_size)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      exec.pipeline_run_id || null,
      exec.service_name,
      exec.status || 'running',
      exec.input_count || 0,
      exec.batch_size || null
    ]
  );
  return result.rows[0].id;
}

export async function updateServiceExecution(
  client: DbClient,
  execId: string,
  updates: Partial<ServiceExecution>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== undefined) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.output_count !== undefined) {
    fields.push(`output_count = $${idx++}`);
    values.push(updates.output_count);
  }
  if (updates.failed_count !== undefined) {
    fields.push(`failed_count = $${idx++}`);
    values.push(updates.failed_count);
  }
  if (updates.api_calls_made !== undefined) {
    fields.push(`api_calls_made = $${idx++}`);
    values.push(updates.api_calls_made);
  }
  if (updates.api_errors !== undefined) {
    fields.push(`api_errors = $${idx++}`);
    values.push(updates.api_errors);
  }
  if (updates.rate_limit_hits !== undefined) {
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
    `UPDATE service_executions SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );
}

// ── Leads Management ───────────────────────────────────────────────

export interface Lead {
  id?: string;
  apollo_person_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company_name?: string;
  title?: string;
  linkedin_url?: string;
  email_status?: string;
  processing_status?: string;
  processing_error?: string;
  batch_id?: string;
  priority?: number;
}

/** Returns set of emails that already exist in leads table */
export async function getExistingEmails(
  client: DbClient,
  emails: string[]
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const valid = emails.filter((e) => e && typeof e === 'string').map((e) => e.trim().toLowerCase());
  if (valid.length === 0) return new Set();
  const result = await client.query(
    `SELECT LOWER(TRIM(email)) as email FROM leads WHERE LOWER(TRIM(email)) = ANY($1::text[])`,
    [valid]
  );
  return new Set(result.rows.map((r) => r.email));
}

export interface InsertLeadsResult {
  inserted: number;
  skippedExisting: number;
  skippedDuplicate: number;
}

/**
 * Insert only NEW leads (skip emails already in DB).
 * Dedupe by email before calling - skippedDuplicate is for caller to track.
 * Returns { inserted, skippedExisting, skippedDuplicate }.
 */
export async function insertNewLeads(
  client: DbClient,
  leads: Lead[],
  options?: { batchId?: string; priority?: number }
): Promise<InsertLeadsResult> {
  if (leads.length === 0) return { inserted: 0, skippedExisting: 0, skippedDuplicate: 0 };

  const emails = leads.map((l) => l.email).filter((e) => e && typeof e === 'string');
  const existing = await getExistingEmails(client, emails);
  const newLeads = leads.filter((l) => l.email && !existing.has(l.email.trim().toLowerCase()));
  const skippedExisting = leads.length - newLeads.length;

  if (newLeads.length === 0) {
    return { inserted: 0, skippedExisting, skippedDuplicate: 0 };
  }

  const batchId = options?.batchId ?? null;
  const priority = options?.priority ?? 0;
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
        lead.processing_status || 'apollo_matched',
        lead.processing_error || null,
        batchId,
        priority
      ]
    );
    if (res.rowCount && res.rowCount > 0) inserted++;
  }

  return { inserted, skippedExisting, skippedDuplicate: 0 };
}

/** @deprecated Use insertNewLeads for Apollo. Kept for backward compatibility. */
export async function upsertLeads(
  client: DbClient,
  leads: Lead[]
): Promise<number> {
  const { inserted } = await insertNewLeads(client, leads);
  return inserted;
}

export async function getLeadsByStatus(
  client: DbClient,
  status: string,
  limit: number = 100
): Promise<Lead[]> {
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

export async function updateLeadStatus(
  client: DbClient,
  leadId: string,
  newStatus: string,
  errorMessage?: string
): Promise<void> {
  await client.query(
    `UPDATE leads 
     SET processing_status = $1, processing_error = $2, updated_at = NOW()
     WHERE id = $3`,
    [newStatus, errorMessage || null, leadId]
  );
}

export async function batchUpdateLeadStatus(
  client: DbClient,
  leadIds: string[],
  newStatus: string,
  errorMessage?: string
): Promise<number> {
  if (leadIds.length === 0) return 0;

  const result = await client.query(
    `UPDATE leads 
     SET processing_status = $1, processing_error = $2, updated_at = NOW()
     WHERE id = ANY($3::uuid[])`,
    [newStatus, errorMessage || null, leadIds]
  );
  return result.rowCount || 0;
}

export async function getPipelineStats(client: DbClient): Promise<any[]> {
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

// ── Reporting (daily + monthly) ────────────────────────────────────

export interface ReportMetrics {
  person_ids_count: number;
  leads_pulled: number;
  leads_validated: number;
  leads_removed: number;
  pushed_ok: number;
  pushed_failed: number;
  replies_fetched: number;
  hot_count: number;
  soft_count: number;
  objection_count: number;
  negative_count: number;
  deliverable_rate: number;
  bounce_rate: number;
  spam_complaint_rate: number;
}

/** Aggregate metrics from pipeline_runs, service_executions, replies, reply_classifications for a date. */
export async function getMetricsForReport(
  client: DbClient,
  reportDate: string
): Promise<ReportMetrics> {
  const metrics: ReportMetrics = {
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
    deliverable_rate: 0,
    bounce_rate: 0,
    spam_complaint_rate: 0,
  };

  // Apollo: person_ids (input to match), leads_pulled (output from match)
  const apolloRes = await client.query(
    `SELECT COALESCE(SUM(se.input_count), 0)::int as person_ids,
            COALESCE(SUM(se.output_count), 0)::int as leads_pulled
     FROM service_executions se
     JOIN pipeline_runs pr ON se.pipeline_run_id = pr.id
     WHERE pr.run_type = 'apollo_collection' AND se.service_name = 'apollo'
       AND pr.completed_at::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (apolloRes.rows[0]) {
    metrics.person_ids_count = Number(apolloRes.rows[0].person_ids) || 0;
    metrics.leads_pulled = Number(apolloRes.rows[0].leads_pulled) || 0;
  }

  // Bouncer: validated (output), removed (failed)
  const bouncerRes = await client.query(
    `SELECT COALESCE(SUM(se.output_count), 0)::int as validated,
            COALESCE(SUM(se.failed_count), 0)::int as removed
     FROM service_executions se
     JOIN pipeline_runs pr ON se.pipeline_run_id = pr.id
     WHERE pr.run_type = 'bouncer_verify' AND se.service_name = 'bouncer'
       AND pr.completed_at::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (bouncerRes.rows[0]) {
    metrics.leads_validated = Number(bouncerRes.rows[0].validated) || 0;
    metrics.leads_removed = Number(bouncerRes.rows[0].removed) || 0;
  }

  // Instantly load: pushed_ok, pushed_failed
  const instRes = await client.query(
    `SELECT COALESCE(SUM(se.output_count), 0)::int as ok,
            COALESCE(SUM(se.failed_count), 0)::int as failed
     FROM service_executions se
     JOIN pipeline_runs pr ON se.pipeline_run_id = pr.id
     WHERE pr.run_type = 'instantly_load' AND se.service_name = 'instantly'
       AND pr.completed_at::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (instRes.rows[0]) {
    metrics.pushed_ok = Number(instRes.rows[0].ok) || 0;
    metrics.pushed_failed = Number(instRes.rows[0].failed) || 0;
  }

  // Replies fetched (instantly_fetch)
  const repliesRes = await client.query(
    `SELECT COUNT(*)::int as cnt FROM replies WHERE fetched_at::date = $1::date`,
    [reportDate]
  );
  metrics.replies_fetched = Number(repliesRes.rows[0]?.cnt) || 0;

  // Reply classifications by category
  const classRes = await client.query(
    `SELECT rc.category, COUNT(*)::int as cnt
     FROM reply_classifications rc
     JOIN replies r ON rc.reply_id = r.id
     WHERE rc.classified_at::date = $1::date
     GROUP BY rc.category`,
    [reportDate]
  );
  for (const row of classRes.rows) {
    const c = Number(row.cnt) || 0;
    if (row.category === 'hot') metrics.hot_count = c;
    else if (row.category === 'soft') metrics.soft_count = c;
    else if (row.category === 'objection') metrics.objection_count = c;
    else if (row.category === 'negative') metrics.negative_count = c;
  }

  // Rates
  const totalChecked = metrics.leads_validated + metrics.leads_removed;
  metrics.deliverable_rate = metrics.leads_pulled > 0
    ? Math.round((metrics.leads_validated / metrics.leads_pulled) * 1000) / 10
    : 0;
  metrics.bounce_rate = totalChecked > 0
    ? Math.round((metrics.leads_removed / totalChecked) * 10000) / 100
    : 0;
  metrics.spam_complaint_rate = 0;

  return metrics;
}

/** Upsert daily report. Uses pipeline_run_id when provided (nullable). */
export async function upsertDailyReport(
  client: DbClient,
  reportDate: string,
  metrics: ReportMetrics,
  reportJson: Record<string, any>,
  pipelineRunId?: string | null
): Promise<void> {
  await client.query(
    `INSERT INTO daily_reports (
       report_date, pipeline_run_id, person_ids_count, leads_pulled, leads_validated, leads_removed,
       pushed_ok, pushed_failed, replies_fetched, hot_count, soft_count, objection_count, negative_count,
       deliverable_rate, bounce_rate, spam_complaint_rate, report_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (report_date) DO UPDATE SET
       pipeline_run_id = COALESCE(EXCLUDED.pipeline_run_id, daily_reports.pipeline_run_id),
       person_ids_count = EXCLUDED.person_ids_count, leads_pulled = EXCLUDED.leads_pulled,
       leads_validated = EXCLUDED.leads_validated, leads_removed = EXCLUDED.leads_removed,
       pushed_ok = EXCLUDED.pushed_ok, pushed_failed = EXCLUDED.pushed_failed,
       replies_fetched = EXCLUDED.replies_fetched, hot_count = EXCLUDED.hot_count,
       soft_count = EXCLUDED.soft_count, objection_count = EXCLUDED.objection_count,
       negative_count = EXCLUDED.negative_count, deliverable_rate = EXCLUDED.deliverable_rate,
       bounce_rate = EXCLUDED.bounce_rate, spam_complaint_rate = EXCLUDED.spam_complaint_rate,
       report_json = EXCLUDED.report_json`,
    [
      reportDate,
      pipelineRunId ?? null,
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
      JSON.stringify(reportJson),
    ]
  );
}

/** Get daily reports for a month. For monthly aggregation. */
export async function getDailyReportsByMonth(
  client: DbClient,
  year: number,
  month: number
): Promise<Array<ReportMetrics & { report_date: string }>> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const result = await client.query(
    `SELECT report_date::text, person_ids_count, leads_pulled, leads_validated, leads_removed,
            pushed_ok, pushed_failed, replies_fetched, hot_count, soft_count, objection_count, negative_count,
            deliverable_rate, bounce_rate, spam_complaint_rate
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
    deliverable_rate: Number(r.deliverable_rate) || 0,
    bounce_rate: Number(r.bounce_rate) || 0,
    spam_complaint_rate: Number(r.spam_complaint_rate) || 0,
  }));
}

// ── Backwards Compatibility ────────────────────────────────────────

export function getSupabaseClient(): Pool | null {
  return getDb();
}

export function getSupabaseEnv() {
  return { url: process.env.SUPABASE_DB_URL || '', key: '' };
}
