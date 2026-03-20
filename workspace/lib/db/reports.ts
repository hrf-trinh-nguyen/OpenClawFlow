/**
 * Reporting operations (daily + monthly)
 */
import type { DbClient } from './connection.js';

/** Calendar date for reporting matches pipeline “business day” (US Eastern). */
const BUSINESS_TZ = 'America/New_York';

// ── Report Metrics Interface ────────────────────────────────────────

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
  out_of_office_count: number;
  auto_reply_count: number;
  not_a_reply_count: number;
  deliverable_rate: number;
  bounce_rate: number;
  spam_complaint_rate: number;
}

// ── Metrics Aggregation ─────────────────────────────────────────────

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
    out_of_office_count: 0,
    auto_reply_count: 0,
    not_a_reply_count: 0,
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
       AND (pr.completed_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date AND se.status = 'completed'`,
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
       AND (pr.completed_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date AND se.status = 'completed'`,
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
       AND (pr.completed_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (instRes.rows[0]) {
    metrics.pushed_ok = Number(instRes.rows[0].ok) || 0;
    metrics.pushed_failed = Number(instRes.rows[0].failed) || 0;
  }

  // Replies fetched (instantly_fetch)
  const repliesRes = await client.query(
    `SELECT COUNT(*)::int as cnt FROM replies WHERE (fetched_at AT TIME ZONE '${BUSINESS_TZ}')::date = $1::date`,
    [reportDate]
  );
  metrics.replies_fetched = Number(repliesRes.rows[0]?.cnt) || 0;

  // Reply classifications
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
      if (row.category === 'hot') metrics.hot_count = c;
      else if (row.category === 'soft') metrics.soft_count = c;
      else if (row.category === 'objection') metrics.objection_count = c;
      else if (row.category === 'negative') metrics.negative_count = c;
      else if (row.category === 'out_of_office') metrics.out_of_office_count = c;
      else if (row.category === 'auto_reply') metrics.auto_reply_count = c;
      else if (row.category === 'not_a_reply') metrics.not_a_reply_count = c;
    }
  } else {
    // Fallback: legacy reply_classifications table
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
      if (row.category === 'hot') metrics.hot_count = c;
      else if (row.category === 'soft') metrics.soft_count = c;
      else if (row.category === 'objection') metrics.objection_count = c;
      else if (row.category === 'negative') metrics.negative_count = c;
      else if (row.category === 'out_of_office') metrics.out_of_office_count = c;
      else if (row.category === 'auto_reply') metrics.auto_reply_count = c;
      else if (row.category === 'not_a_reply') metrics.not_a_reply_count = c;
    }
  }

  // Rates
  const totalChecked = metrics.leads_validated + metrics.leads_removed;
  metrics.deliverable_rate =
    metrics.leads_pulled > 0
      ? Math.round((metrics.leads_validated / metrics.leads_pulled) * 1000) / 10
      : 0;
  metrics.bounce_rate =
    totalChecked > 0 ? Math.round((metrics.leads_removed / totalChecked) * 10000) / 100 : 0;
  metrics.spam_complaint_rate = 0;

  return metrics;
}

// ── Daily Report ────────────────────────────────────────────────────

export async function upsertDailyReport(
  client: DbClient,
  reportDate: string,
  metrics: ReportMetrics,
  reportJson: Record<string, any>,
  options?: {
    pipelineRunId?: string | null;
    campaignId?: string | null;
    sent?: number;
    opened?: number;
    replies?: number;
  }
): Promise<void> {
  const campaignId = options?.campaignId ?? null;
  const sent = options?.sent ?? 0;
  const opened = options?.opened ?? 0;
  const replies = options?.replies ?? 0;

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
      options?.pipelineRunId ?? null,
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
      JSON.stringify(reportJson),
    ]
  );
}

// ── Campaign Daily Analytics ────────────────────────────────────────

export async function upsertCampaignDailyAnalytics(
  client: DbClient,
  reportDate: string,
  campaignId: string,
  data: {
    sent: number;
    contacted?: number;
    new_leads_contacted?: number;
    opened?: number;
    unique_opened?: number;
    replies?: number;
    unique_replies?: number;
    replies_automatic?: number;
    unique_replies_automatic?: number;
    clicks?: number;
    unique_clicks?: number;
  }
): Promise<void> {
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
      uniqueClicks,
    ]
  );
}

// ── Monthly Reports ─────────────────────────────────────────────────

export async function getDailyReportsByMonth(
  client: DbClient,
  year: number,
  month: number
): Promise<
  Array<ReportMetrics & { report_date: string; sent?: number; opened?: number; replies?: number }>
> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
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
    replies: Number(r.replies) || 0,
  }));
}
