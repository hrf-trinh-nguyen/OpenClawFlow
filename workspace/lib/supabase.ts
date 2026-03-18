/**
 * Database client for OpenClaw Outbound Automation.
 * Uses SUPABASE_DB_URL (PostgreSQL connection string) only — no SUPABASE_URL/SUPABASE_KEY.
 */
import pg from 'pg';

const { Pool } = pg;

// ============================================================================
// Types (unchanged for callers)
// ============================================================================

export type CampaignStatus = 'active' | 'paused' | 'completed';
export type EmailStatus = 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
export type LeadSource = 'apollo' | 'manual' | 'import';
export type PushStatus = 'pending' | 'success' | 'failed';
export type ReplyCategory =
  | 'hot'
  | 'soft'
  | 'objection'
  | 'negative'
  | 'out_of_office'
  | 'auto_reply'
  | 'not_a_reply';
export type WorkflowName = 'build_list' | 'load_campaign' | 'process_replies' | 'daily_report';
export type ExecutionStatus = 'running' | 'completed' | 'failed';
export type TriggerType = 'cron' | 'manual' | 'api';

export interface Campaign {
  id: string;
  instantly_campaign_id: string;
  name: string;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  apollo_person_id?: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  title: string;
  linkedin_url?: string;
  email_status: EmailStatus;
  source: LeadSource;
  created_at: string;
  updated_at: string;
  last_contacted_at?: string;
  blacklisted?: boolean;
  blacklist_reason?: string;
}

export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  added_at: string;
  push_status: PushStatus;
  push_error?: string;
  last_sent_at?: string;
  send_count?: number;
}

export interface Reply {
  id: string;
  campaign_id: string;
  lead_id?: string;
  thread_id: string;
  from_email: string;
  subject: string;
  reply_text: string;
  timestamp: string;
  fetched_at: string;
}

export interface ReplyClassification {
  id: string;
  reply_id: string;
  category: ReplyCategory;
  confidence: number;
  classified_at: string;
  model: string;
}

export interface WorkflowRun {
  id: string;
  workflow_name: WorkflowName;
  campaign_id?: string;
  status: ExecutionStatus;
  started_at: string;
  completed_at?: string;
  trigger: TriggerType;
  error_message?: string;
}

export interface SkillExecution {
  id: string;
  workflow_run_id: string;
  skill_name: string;
  status: ExecutionStatus;
  started_at: string;
  completed_at?: string;
  input_data?: Record<string, any>;
  output_data?: Record<string, any>;
  error_message?: string;
  duration_ms?: number;
}

export interface ApolloSearch {
  id: string;
  skill_execution_id: string;
  workflow_run_id: string;
  person_ids_collected: number;
  pages_fetched: number;
  icp_filters: Record<string, any>;
  executed_at: string;
}

export interface BouncerVerification {
  id: string;
  skill_execution_id: string;
  workflow_run_id: string;
  batch_id: string;
  emails_submitted: number;
  deliverable_count: number;
  undeliverable_count: number;
  deliverable_rate: number;
  executed_at: string;
}

// ============================================================================
// DB connection (SUPABASE_DB_URL only)
// ============================================================================

let pool: pg.Pool | null = null;

export type DbClient = pg.Pool;

/** Get DB pool from SUPABASE_DB_URL. Returns null if not set. */
export function getDb(): DbClient | null {
  const url = process.env.SUPABASE_DB_URL?.trim?.().replace(/^['"]|['"]$/g, '');
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url });
  return pool;
}

/** @deprecated Use getDb() — kept for compatibility; returns true if SUPABASE_DB_URL is set. */
export function getSupabaseEnv(_config?: Record<string, string>): { url: string; key: string } | null {
  return getDb() ? { url: 'pg', key: 'pg' } : null;
}

/** @deprecated Use getDb() and pass pool to helpers. */
export function getSupabaseClient(_url?: string, _key?: string): DbClient {
  const p = getDb();
  if (!p) throw new Error('SUPABASE_DB_URL must be set in .env for database writes');
  return p;
}

// ============================================================================
// Helpers (all use pg Pool)
// ============================================================================

export async function createWorkflowRun(
  client: DbClient,
  workflowName: WorkflowName,
  campaignId?: string,
  trigger: TriggerType = 'manual'
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO workflow_runs (workflow_name, campaign_id, status, trigger)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [workflowName, campaignId ?? null, trigger]
  );
  if (!rows[0]) throw new Error('Failed to create workflow run');
  return rows[0].id;
}

export async function completeWorkflowRun(
  client: DbClient,
  workflowRunId: string,
  status: ExecutionStatus,
  errorMessage?: string
): Promise<void> {
  await client.query(
    `UPDATE workflow_runs SET status = $1, completed_at = NOW(), error_message = $2 WHERE id = $3`,
    [status, errorMessage ?? null, workflowRunId]
  );
}

export async function createSkillExecution(
  client: DbClient,
  workflowRunId: string,
  skillName: string,
  inputData?: Record<string, any>
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO skill_executions (workflow_run_id, skill_name, status, input_data)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [workflowRunId, skillName, inputData ? JSON.stringify(inputData) : null]
  );
  if (!rows[0]) throw new Error('Failed to create skill execution');
  return rows[0].id;
}

export async function completeSkillExecution(
  client: DbClient,
  skillExecutionId: string,
  status: ExecutionStatus,
  outputData?: Record<string, any>,
  durationMs?: number,
  errorMessage?: string
): Promise<void> {
  await client.query(
    `UPDATE skill_executions SET status = $1, completed_at = NOW(), output_data = $2, duration_ms = $3, error_message = $4 WHERE id = $5`,
    [status, outputData ? JSON.stringify(outputData) : null, durationMs ?? null, errorMessage ?? null, skillExecutionId]
  );
}

export async function upsertLead(
  client: DbClient,
  leadData: Omit<Lead, 'id' | 'created_at' | 'updated_at'>
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO leads (apollo_person_id, email, first_name, last_name, company_name, title, linkedin_url, email_status, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::email_status, $9::lead_source)
     ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
       company_name = EXCLUDED.company_name, title = EXCLUDED.title, linkedin_url = EXCLUDED.linkedin_url,
       updated_at = NOW()
     RETURNING id`,
    [
      leadData.apollo_person_id ?? null,
      leadData.email,
      leadData.first_name,
      leadData.last_name,
      leadData.company_name,
      leadData.title,
      leadData.linkedin_url ?? null,
      leadData.email_status,
      leadData.source,
    ]
  );
  if (!rows[0]) throw new Error('Failed to upsert lead');
  return rows[0].id;
}

export async function upsertLeads(
  client: DbClient,
  leadsData: Array<Omit<Lead, 'id' | 'created_at' | 'updated_at'>>
): Promise<string[]> {
  const ids: string[] = [];
  for (const leadData of leadsData) {
    ids.push(await upsertLead(client, leadData));
  }
  return ids;
}

export async function updateLeadsLastContacted(
  client: DbClient,
  leadIds: string[],
  contactedAt?: string
): Promise<void> {
  if (!leadIds.length) return;
  const ts = contactedAt || new Date().toISOString();
  await client.query(
    `UPDATE leads SET last_contacted_at = $1 WHERE id = ANY($2::uuid[])`,
    [ts, leadIds]
  );
}

export async function getOrCreateCampaign(
  client: DbClient,
  instantlyCampaignId: string,
  name?: string
): Promise<string> {
  const { rows: existing } = await client.query<{ id: string }>(
    `SELECT id FROM campaigns WHERE instantly_campaign_id = $1`,
    [instantlyCampaignId]
  );
  if (existing[0]) return existing[0].id;
  const { rows: inserted } = await client.query<{ id: string }>(
    `INSERT INTO campaigns (instantly_campaign_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [instantlyCampaignId, name || `Campaign ${instantlyCampaignId}`]
  );
  if (!inserted[0]) throw new Error('Failed to create campaign');
  return inserted[0].id;
}

export async function addLeadsToCampaign(
  client: DbClient,
  campaignId: string,
  leadIds: string[],
  pushStatus: PushStatus = 'success',
  pushError?: string
): Promise<void> {
  const now = new Date().toISOString();
  for (const leadId of leadIds) {
    await client.query(
      `INSERT INTO campaign_leads (campaign_id, lead_id, push_status, push_error, last_sent_at, send_count)
       VALUES ($1, $2, $3::push_status, $4, $5, $6)
       ON CONFLICT (campaign_id, lead_id) DO UPDATE SET push_status = EXCLUDED.push_status, push_error = EXCLUDED.push_error,
         last_sent_at = EXCLUDED.last_sent_at, send_count = campaign_leads.send_count + EXCLUDED.send_count`,
      [campaignId, leadId, pushStatus, pushError ?? null, pushStatus === 'success' ? now : null, pushStatus === 'success' ? 1 : 0]
    );
  }
}

export async function saveReplies(
  client: DbClient,
  campaignId: string,
  replies: Array<Omit<Reply, 'id' | 'campaign_id' | 'fetched_at'>>
): Promise<string[]> {
  const ids: string[] = [];
  for (const r of replies) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO replies (campaign_id, lead_id, thread_id, from_email, subject, reply_text, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       ON CONFLICT (thread_id, timestamp) DO UPDATE SET reply_text = EXCLUDED.reply_text
       RETURNING id`,
      [campaignId, r.lead_id ?? null, r.thread_id, r.from_email, r.subject, r.reply_text, r.timestamp]
    );
    if (rows[0]) ids.push(rows[0].id);
  }
  return ids;
}

export async function getLeadIdByEmail(client: DbClient, email: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM leads WHERE email = $1`, [email]);
  return rows[0]?.id ?? null;
}

/** Get lead ids by emails (for instantly-load) */
export async function getLeadsByEmails(
  client: DbClient,
  emails: string[]
): Promise<Array<{ id: string; email: string }>> {
  if (!emails.length) return [];
  const { rows } = await client.query<{ id: string; email: string }>(
    `SELECT id, email FROM leads WHERE email = ANY($1::text[])`,
    [emails]
  );
  return rows;
}

/** Get replies by thread_ids (for llm-classify) */
export async function getRepliesByThreadIds(
  client: DbClient,
  threadIds: string[]
): Promise<Array<{ id: string; thread_id: string; from_email: string; lead_id: string | null }>> {
  if (!threadIds.length) return [];
  const { rows } = await client.query<{ id: string; thread_id: string; from_email: string; lead_id: string | null }>(
    `SELECT id, thread_id, from_email, lead_id FROM replies WHERE thread_id = ANY($1::text[])`,
    [threadIds]
  );
  return rows;
}

export async function saveClassifications(
  client: DbClient,
  classifications: Array<Omit<ReplyClassification, 'id' | 'classified_at'>>
): Promise<void> {
  for (const c of classifications) {
    await client.query(
      `INSERT INTO reply_classifications (reply_id, category, confidence, model)
       VALUES ($1, $2::reply_category, $3, $4)
       ON CONFLICT (reply_id) DO UPDATE SET category = EXCLUDED.category, confidence = EXCLUDED.confidence, model = EXCLUDED.model`,
      [c.reply_id, c.category, c.confidence, c.model]
    );
  }
}

export async function logApolloSearch(
  client: DbClient,
  skillExecutionId: string,
  workflowRunId: string,
  personIdsCollected: number,
  pagesFetched: number,
  icpFilters: Record<string, any>
): Promise<void> {
  await client.query(
    `INSERT INTO apollo_searches (skill_execution_id, workflow_run_id, person_ids_collected, pages_fetched, icp_filters)
     VALUES ($1, $2, $3, $4, $5)`,
    [skillExecutionId, workflowRunId, personIdsCollected, pagesFetched, JSON.stringify(icpFilters)]
  );
}

export async function logBouncerVerification(
  client: DbClient,
  skillExecutionId: string,
  workflowRunId: string,
  batchId: string,
  emailsSubmitted: number,
  deliverableCount: number,
  undeliverableCount: number,
  deliverableRate: number
): Promise<void> {
  await client.query(
    `INSERT INTO bouncer_verifications (skill_execution_id, workflow_run_id, batch_id, emails_submitted, deliverable_count, undeliverable_count, deliverable_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [skillExecutionId, workflowRunId, batchId, emailsSubmitted, deliverableCount, undeliverableCount, deliverableRate]
  );
}

export async function saveDailyReport(
  client: DbClient,
  reportDate: string,
  workflowRunId: string | undefined,
  metrics: {
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
  },
  reportJson: Record<string, any>
): Promise<void> {
  await client.query(
    `INSERT INTO daily_reports (report_date, workflow_run_id, person_ids_count, leads_pulled, leads_validated, leads_removed,
      pushed_ok, pushed_failed, replies_fetched, hot_count, soft_count, objection_count, negative_count,
      deliverable_rate, bounce_rate, spam_complaint_rate, report_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (report_date) DO UPDATE SET workflow_run_id = EXCLUDED.workflow_run_id,
       person_ids_count = EXCLUDED.person_ids_count, leads_pulled = EXCLUDED.leads_pulled, leads_validated = EXCLUDED.leads_validated,
       leads_removed = EXCLUDED.leads_removed, pushed_ok = EXCLUDED.pushed_ok, pushed_failed = EXCLUDED.pushed_failed,
       replies_fetched = EXCLUDED.replies_fetched, hot_count = EXCLUDED.hot_count, soft_count = EXCLUDED.soft_count,
       objection_count = EXCLUDED.objection_count, negative_count = EXCLUDED.negative_count,
       deliverable_rate = EXCLUDED.deliverable_rate, bounce_rate = EXCLUDED.bounce_rate, spam_complaint_rate = EXCLUDED.spam_complaint_rate,
       report_json = EXCLUDED.report_json`,
    [
      reportDate,
      workflowRunId ?? null,
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

export async function updateLeadEmailStatuses(
  client: DbClient,
  emails: string[],
  status: EmailStatus
): Promise<void> {
  if (!emails.length) return;
  await client.query(
    `UPDATE leads SET email_status = $1::email_status WHERE email = ANY($2::text[])`,
    [status, emails]
  );
}
