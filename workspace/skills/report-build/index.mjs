#!/usr/bin/env node

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
function stateSet(key, value) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(resolve(STATE_DIR, `${key}.json`), JSON.stringify(value, null, 2), "utf8");
}

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

// lib/db/reports.ts
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
       AND pr.completed_at::date = $1::date AND se.status = 'completed'`,
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
       AND pr.completed_at::date = $1::date AND se.status = 'completed'`,
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
       AND pr.completed_at::date = $1::date AND se.status = 'completed'`,
    [reportDate]
  );
  if (instRes.rows[0]) {
    metrics.pushed_ok = Number(instRes.rows[0].ok) || 0;
    metrics.pushed_failed = Number(instRes.rows[0].failed) || 0;
  }
  const repliesRes = await client.query(
    `SELECT COUNT(*)::int as cnt FROM replies WHERE fetched_at::date = $1::date`,
    [reportDate]
  );
  metrics.replies_fetched = Number((_a = repliesRes.rows[0]) == null ? void 0 : _a.cnt) || 0;
  const repliesClassRes = await client.query(
    `SELECT reply_category as category, COUNT(*)::int as cnt
     FROM replies
     WHERE reply_category IS NOT NULL AND classified_at::date = $1::date
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
       WHERE rc.classified_at::date = $1::date
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

// lib/utils.ts
function checkRequiredEnv(keys) {
  const missing = keys.filter((key) => !process.env[key]);
  return { valid: missing.length === 0, missing };
}
function validateRequiredEnv(keys) {
  const { valid, missing } = checkRequiredEnv(keys);
  if (!valid) {
    console.error(`\u274C Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
}
function getTodayDateString() {
  return (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
}

// lib/constants.ts
var CUSTOMER_REPLY_CATEGORIES = ["hot", "soft", "objection", "negative"];
var NON_REPLY_CATEGORIES = ["out_of_office", "auto_reply", "not_a_reply"];
var REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES
];
var SLACK_CHANNELS = {
  REPORT: process.env.SLACK_REPORT_CHANNEL || "",
  ALERT: process.env.SLACK_ALERT_CHANNEL || ""
};
var API_ENDPOINTS = {
  APOLLO: {
    SEARCH: "https://api.apollo.io/api/v1/mixed_people/api_search",
    BULK_MATCH: "https://api.apollo.io/api/v1/people/bulk_match"
  },
  BOUNCER: {
    SUBMIT_BATCH: "https://api.usebouncer.com/v1.1/email/verify/batch",
    GET_STATUS: (batchId) => `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}`,
    DOWNLOAD: (batchId) => `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}/download?download=all`
  },
  INSTANTLY: {
    ADD_LEADS: "https://api.instantly.ai/api/v2/leads/add",
    EMAILS: "https://api.instantly.ai/api/v2/emails",
    UNREAD_COUNT: (campaignId) => `https://api.instantly.ai/api/v2/emails/unread/count?campaign_id=${campaignId}`,
    REPLY: "https://api.instantly.ai/api/v2/emails/reply",
    ANALYTICS_DAILY: "https://api.instantly.ai/api/v2/campaigns/analytics/daily"
  },
  OPENAI: {
    CHAT_COMPLETIONS: "https://api.openai.com/v1/chat/completions"
  },
  SLACK: {
    POST_MESSAGE: "https://slack.com/api/chat.postMessage"
  }
};
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";

// lib/slack-templates.ts
function buildDailyReportMessage(p) {
  const customerTotal = p.hotCount + p.softCount + p.objectionCount + p.negativeCount;
  const notCustomer = (p.outOfOfficeCount ?? 0) + (p.autoReplyCount ?? 0) + (p.notAReplyCount ?? 0);
  const totalClassified = p.repliesFetched;
  const lines = [
    `\u{1F4CA} *OpenClaw Daily Report*`,
    `Date: ${p.reportDate}${p.campaignIdShort ? `  \xB7  Campaign: ${p.campaignIdShort}` : ""}${p.reportRunAtPT ? `  \xB7  Generated: ${p.reportRunAtPT}` : ""}`,
    `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`,
    ``,
    `*Lead Pipeline*`,
    `\u2022 Apollo IDs found: ${p.personIdsCount}`,
    `\u2022 Leads with email: ${p.leadsPulled}`,
    `\u2022 Bouncer verified: ${p.leadsValidated} (deliverable ${p.deliverableRatePct})`,
    `\u2022 Removed (bounce): ${p.leadsRemoved} (${p.bounceRatePct})`,
    `\u2022 Pushed to Instantly: ${p.pushedOk} ok  \xB7  ${p.pushedFailed} failed`,
    ``,
    `*Campaign (Instantly)*`,
    `\u2022 Emails sent: ${p.sent}`,
    `\u2022 Opens: ${p.opened} (${p.openRatePct})`,
    `\u2022 Replies (inbox): ${p.repliesInst} (${p.replyRatePct})`
  ];
  if (p.contacted !== void 0 && p.contacted > 0) {
    lines.push(`\u2022 Contacted: ${p.contacted}${p.newLeadsContacted !== void 0 && p.newLeadsContacted > 0 ? `  \xB7  New leads contacted: ${p.newLeadsContacted}` : ""}`);
  }
  if (p.clicks !== void 0 && (p.clicks > 0 || (p.uniqueClicks ?? 0) > 0)) {
    lines.push(`\u2022 Clicks: ${p.uniqueClicks ?? p.clicks} unique${p.clicks !== p.uniqueClicks && p.clicks > 0 ? ` (${p.clicks} total)` : ""}`);
  }
  lines.push(
    ``,
    `*Reply Classification (DB \xB7 ${p.reportDate})*`,
    `\u2022 Customer: Hot ${p.hotCount}  \xB7  Soft ${p.softCount}  \xB7  Objection ${p.objectionCount}  \xB7  Negative ${p.negativeCount} (${p.negativeRatePct})`,
    `\u2022 Customer subtotal: ${customerTotal}`,
    `\u2022 Not customer: Out of office ${p.outOfOfficeCount ?? 0}  \xB7  Auto-reply ${p.autoReplyCount ?? 0}  \xB7  Not a reply ${p.notAReplyCount ?? 0}`,
    `\u2022 Not customer subtotal: ${notCustomer}`,
    `\u2022 Total classified: ${totalClassified}`,
    ``,
    `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`
  );
  return lines.join("\n");
}

// skills/report-build/index.ts
function getCampaignIds() {
  const ids = process.env.INSTANTLY_CAMPAIGN_IDS;
  if (ids) {
    return ids.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const id = process.env.INSTANTLY_CAMPAIGN_ID;
  return id ? [id] : [];
}
async function fetchInstantlyDailyAnalytics(reportDate, campaignId) {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) return null;
  const params = new URLSearchParams({
    campaign_id: campaignId,
    start_date: reportDate,
    end_date: reportDate
  });
  const url = `${API_ENDPOINTS.INSTANTLY.ANALYTICS_DAILY}?${params}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data.items ?? [];
    return rows.find((r) => r.date === reportDate) ?? rows[0] ?? null;
  } catch {
    return null;
  }
}
async function main() {
  validateRequiredEnv(["SUPABASE_DB_URL"]);
  const reportDate = process.env.REPORT_DATE || getTodayDateString();
  console.log(`Report Build \u2013 aggregating metrics for ${reportDate}`);
  const db = getDb();
  if (!db) {
    console.error("\u274C Failed to connect to database");
    process.exit(1);
  }
  const metrics = await getMetricsForReport(db, reportDate);
  const campaignIds = getCampaignIds();
  let primaryCampaignId = null;
  let sent = 0, opened = 0, repliesInst = 0;
  let contacted = 0, newLeadsContacted = 0, clicks = 0, uniqueClicks = 0;
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
      unique_clicks: row.unique_clicks ?? 0
    });
    if (!primaryCampaignId) {
      primaryCampaignId = cid;
      sent = row.sent ?? 0;
      opened = row.unique_opened ?? row.opened ?? 0;
      repliesInst = row.unique_replies ?? row.replies ?? 0;
      contacted = row.contacted ?? 0;
      newLeadsContacted = row.new_leads_contacted ?? 0;
      clicks = row.clicks ?? 0;
      uniqueClicks = row.unique_clicks ?? 0;
    }
  }
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
  const nr = replies_fetched > 0 ? Math.round(negative_count / replies_fetched * 1e4) / 100 : 0;
  const openRatePct = sent > 0 ? (opened / sent * 100).toFixed(1) : "0";
  const replyRatePct = sent > 0 ? (repliesInst / sent * 100).toFixed(2) : "0";
  const report = {
    date: reportDate,
    campaign_id: primaryCampaignId,
    apollo: {
      person_ids: person_ids_count,
      leads_with_email: leads_pulled
    },
    bouncer: {
      validated: leads_validated,
      removed: leads_removed,
      deliverable_rate: `${dr.toFixed(1)}%`,
      bounce_rate: `${br.toFixed(2)}%`
    },
    instantly: {
      pushed_ok,
      pushed_failed,
      sent,
      opened,
      replies: repliesInst,
      open_rate_pct: openRatePct,
      reply_rate_pct: replyRatePct
    },
    replies: {
      total: repliesInst,
      classified: replies_fetched,
      hot: hot_count,
      soft: soft_count,
      objection: objection_count,
      negative: negative_count,
      negative_rate: `${nr.toFixed(2)}%`
    }
  };
  const reportRunAtPT = (/* @__PURE__ */ new Date()).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }) + " PT";
  const text = buildDailyReportMessage({
    reportDate,
    campaignIdShort: primaryCampaignId ? `${primaryCampaignId.slice(0, 8)}...` : void 0,
    reportRunAtPT,
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
    contacted: contacted > 0 ? contacted : void 0,
    newLeadsContacted: newLeadsContacted > 0 ? newLeadsContacted : void 0,
    clicks: clicks > 0 ? clicks : void 0,
    uniqueClicks: uniqueClicks > 0 ? uniqueClicks : void 0,
    repliesFetched: replies_fetched,
    hotCount: hot_count,
    softCount: soft_count,
    objectionCount: objection_count,
    negativeCount: negative_count,
    negativeRatePct: `${nr.toFixed(2)}%`,
    outOfOfficeCount: metrics.out_of_office_count ?? 0,
    autoReplyCount: metrics.auto_reply_count ?? 0,
    notAReplyCount: metrics.not_a_reply_count ?? 0
  });
  await upsertDailyReport(db, reportDate, metrics, report, {
    campaignId: primaryCampaignId,
    sent,
    opened,
    replies: repliesInst
  });
  stateSet("daily_report", report);
  stateSet("daily_report_text", text);
  console.log("  [DB] Saved daily report.");
  console.log("  Report built and saved to state");
  console.log(`
${text}`);
}
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
