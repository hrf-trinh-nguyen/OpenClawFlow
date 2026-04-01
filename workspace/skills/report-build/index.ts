#!/usr/bin/env node

/**
 * report-build — aggregate metrics from DB and save daily report
 *
 * Reads:  pipeline_runs, service_executions, replies (by date), Instantly API
 * Writes: daily_reports, campaign_daily_analytics, state/daily_report.json
 *
 * ENV: REPORT_DATE (default: today)
 *      INSTANTLY_API_KEY
 *      INSTANTLY_REPORT_ALL_CAMPAIGNS — default on: list campaigns via GET /api/v2/campaigns and
 *        aggregate daily analytics for every campaign. Set to 0/false/off to use only
 *        INSTANTLY_CAMPAIGN_ID / INSTANTLY_CAMPAIGN_IDS (legacy).
 *      INSTANTLY_CAMPAIGN_ID (single) or INSTANTLY_CAMPAIGN_IDS (comma-separated) — fallback or when
 *        INSTANTLY_REPORT_ALL_CAMPAIGNS=0
 */

import { stateSet } from '../../lib/state.js';
import {
  getDb,
  getMetricsForReport,
  upsertDailyReport,
  upsertCampaignDailyAnalytics,
} from '../../lib/supabase-pipeline.js';
import { validateRequiredEnv, getTodayDateString } from '../../lib/utils.js';
import { API_ENDPOINTS } from '../../lib/constants.js';
import { buildDailyReportMessage } from '../../lib/slack-templates.js';

/** Instantly daily campaign analytics response row */
interface InstantlyDailyRow {
  date?: string;
  sent?: number;
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

/** Get campaign IDs from env: INSTANTLY_CAMPAIGN_IDS (comma) or INSTANTLY_CAMPAIGN_ID */
function getCampaignIdsFromEnv(): string[] {
  const ids = process.env.INSTANTLY_CAMPAIGN_IDS;
  if (ids) {
    return ids.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const id = process.env.INSTANTLY_CAMPAIGN_ID;
  return id ? [id] : [];
}

/** When unset or empty, default to listing all campaigns from the API (aggregate day totals). */
function useInstantlyReportAllCampaignsFromApi(): boolean {
  const v = process.env.INSTANTLY_REPORT_ALL_CAMPAIGNS;
  if (v === undefined || String(v).trim() === '') return true;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

/** Paginated GET /api/v2/campaigns (limit max 100, starting_after cursor). */
async function fetchAllCampaignIdsFromApi(apiKey: string): Promise<string[]> {
  const out: string[] = [];
  let startingAfter: string | undefined;

  for (;;) {
    const url = new URL(API_ENDPOINTS.INSTANTLY.CAMPAIGNS_LIST);
    url.searchParams.set('limit', '100');
    if (startingAfter) url.searchParams.set('starting_after', startingAfter);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`Report: list campaigns HTTP ${res.status} — stopping pagination.`);
      break;
    }

    const data = (await res.json()) as {
      items?: Array<{ id?: string }>;
      next_starting_after?: string;
    };
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      if (item?.id) out.push(item.id);
    }

    const next = data.next_starting_after;
    if (!next || items.length === 0) break;
    startingAfter = next;
  }

  return out;
}

async function resolveCampaignIds(apiKey: string | undefined): Promise<string[]> {
  const fromApi = useInstantlyReportAllCampaignsFromApi();
  if (fromApi && apiKey) {
    const ids = await fetchAllCampaignIdsFromApi(apiKey);
    if (ids.length > 0) {
      console.log(`Report: Instantly — ${ids.length} campaign(s) from API list (aggregated for ${process.env.REPORT_DATE || 'today'}).`);
      return ids;
    }
    console.warn('Report: Instantly list campaigns returned 0 campaigns; falling back to INSTANTLY_CAMPAIGN_ID(S).');
  }

  const envIds = getCampaignIdsFromEnv();
  if (envIds.length > 0) {
    console.log(`Report: Instantly — ${envIds.length} campaign(s) from env INSTANTLY_CAMPAIGN_ID(S).`);
    return envIds;
  }

  return [];
}

async function fetchInstantlyDailyAnalytics(
  reportDate: string,
  campaignId: string
): Promise<InstantlyDailyRow | null> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    campaign_id: campaignId,
    start_date: reportDate,
    end_date: reportDate,
  });
  const url = `${API_ENDPOINTS.INSTANTLY.ANALYTICS_DAILY}?${params}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data.items ?? []);
    return rows.find((r: InstantlyDailyRow) => r.date === reportDate) ?? rows[0] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  validateRequiredEnv(['SUPABASE_DB_URL']);

  const reportDate = process.env.REPORT_DATE || getTodayDateString();
  console.log(`Report Build – aggregating metrics for ${reportDate}`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  const metrics = await getMetricsForReport(db, reportDate);
  const apiKey = process.env.INSTANTLY_API_KEY;
  const campaignIds = await resolveCampaignIds(apiKey);

  let primaryCampaignId: string | null = null;
  let sent = 0,
    opened = 0,
    repliesInst = 0;
  let contacted = 0,
    newLeadsContacted = 0,
    clicks = 0,
    uniqueClicks = 0;

  for (const cid of campaignIds) {
    const row = await fetchInstantlyDailyAnalytics(reportDate, cid);
    if (!row) continue;

    await upsertCampaignDailyAnalytics(db, reportDate, cid, {
      sent: row.sent ?? 0,
      contacted: row.contacted ?? 0,
      new_leads_contacted: row.new_leads_contacted ?? 0,
      opened: row.opened ?? 0,
      unique_opened: row.unique_opened ?? row.opened ?? 0,
      replies: row.replies ?? 0,
      unique_replies: row.unique_replies ?? row.replies ?? 0,
      replies_automatic: row.replies_automatic ?? 0,
      unique_replies_automatic: row.unique_replies_automatic ?? 0,
      clicks: row.clicks ?? 0,
      unique_clicks: row.unique_clicks ?? 0,
    });

    const uOpen = row.unique_opened ?? row.opened ?? 0;
    const uRep = row.unique_replies ?? row.replies ?? 0;
    const uClk = row.unique_clicks ?? row.clicks ?? 0;

    sent += row.sent ?? 0;
    opened += uOpen;
    repliesInst += uRep;
    contacted += row.contacted ?? 0;
    newLeadsContacted += row.new_leads_contacted ?? 0;
    clicks += row.clicks ?? 0;
    uniqueClicks += uClk;

    if (!primaryCampaignId) primaryCampaignId = cid;
  }

  const aggregatedMultiple = campaignIds.length > 1;
  const campaignLabelShort =
    campaignIds.length === 0
      ? undefined
      : aggregatedMultiple
        ? `All campaigns (${campaignIds.length})`
        : primaryCampaignId
          ? `${primaryCampaignId.slice(0, 8)}...`
          : undefined;

  const reportCampaignId =
    campaignIds.length === 0 ? null : aggregatedMultiple ? 'aggregated' : primaryCampaignId;

  const person_ids_count = metrics.person_ids_count ?? 0;
  const leads_pulled = metrics.leads_pulled ?? 0;
  const leads_validated = metrics.leads_validated ?? 0;
  const leads_removed = metrics.leads_removed ?? 0;
  const pushed_ok = metrics.pushed_ok ?? 0;
  const pushed_failed = metrics.pushed_failed ?? 0;
  const replies_fetched = metrics.replies_fetched ?? 0;
  const hot_count = metrics.hot_count ?? 0;
  const soft_count = metrics.soft_count ?? 0;
  const objection_count = metrics.objection_count ?? 0;
  const negative_count = metrics.negative_count ?? 0;
  const dr = Number(metrics.deliverable_rate) || 0;
  const br = Number(metrics.bounce_rate) || 0;
  const nr = replies_fetched > 0 ? Math.round((negative_count / replies_fetched) * 10000) / 100 : 0;

  const openRatePct = sent > 0 ? ((opened / sent) * 100).toFixed(1) : '0';
  const replyRatePct = sent > 0 ? ((repliesInst / sent) * 100).toFixed(2) : '0';

  const report = {
    date: reportDate,
    campaign_id: reportCampaignId,
    apollo: {
      person_ids: person_ids_count,
      leads_with_email: leads_pulled,
    },
    bouncer: {
      validated: leads_validated,
      removed: leads_removed,
      deliverable_rate: `${dr.toFixed(1)}%`,
      bounce_rate: `${br.toFixed(2)}%`,
    },
    instantly: {
      pushed_ok,
      pushed_failed,
      campaigns_count: campaignIds.length,
      aggregated: aggregatedMultiple,
      sent,
      opened,
      replies: repliesInst,
      open_rate_pct: openRatePct,
      reply_rate_pct: replyRatePct,
    },
    replies: {
      total: repliesInst,
      classified: replies_fetched,
      hot: hot_count,
      soft: soft_count,
      objection: objection_count,
      negative: negative_count,
      negative_rate: `${nr.toFixed(2)}%`,
    },
  };

  const reportRunAtET =
    new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' ET';

  const text = buildDailyReportMessage({
    reportDate,
    campaignIdShort: campaignLabelShort,
    reportRunAtET,
    personIdsCount: person_ids_count,
    leadsPulled: leads_pulled,
    leadsValidated: leads_validated,
    leadsRemoved: leads_removed,
    deliverableRatePct: `${dr.toFixed(1)}%`,
    bounceRatePct: `${br.toFixed(2)}%`,
    pushedOk: pushed_ok,
    pushedFailed: pushed_failed,
    sent,
    opened,
    openRatePct: `${openRatePct}%`,
    repliesInst,
    replyRatePct: `${replyRatePct}%`,
    contacted: contacted > 0 ? contacted : undefined,
    newLeadsContacted: newLeadsContacted > 0 ? newLeadsContacted : undefined,
    clicks: clicks > 0 ? clicks : undefined,
    uniqueClicks: uniqueClicks > 0 ? uniqueClicks : undefined,
    repliesFetched: replies_fetched,
    hotCount: hot_count,
    softCount: soft_count,
    objectionCount: objection_count,
    negativeCount: negative_count,
    negativeRatePct: `${nr.toFixed(2)}%`,
    outOfOfficeCount: metrics.out_of_office_count ?? 0,
    autoReplyCount: metrics.auto_reply_count ?? 0,
    notAReplyCount: metrics.not_a_reply_count ?? 0,
  });

  await upsertDailyReport(db, reportDate, metrics, report, {
    campaignId: reportCampaignId,
    sent,
    opened,
    replies: repliesInst,
  });
  stateSet('daily_report', report);
  stateSet('daily_report_text', text);

  console.log('  [DB] Saved daily report.');
  console.log('  Report built and saved to state');
  console.log(`\n${text}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
