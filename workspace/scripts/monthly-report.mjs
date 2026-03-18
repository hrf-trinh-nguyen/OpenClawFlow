#!/usr/bin/env node

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

// scripts/monthly-report.ts
async function main() {
  const year = parseInt(process.env.REPORT_YEAR || String((/* @__PURE__ */ new Date()).getFullYear()), 10);
  const month = parseInt(process.env.REPORT_MONTH || String((/* @__PURE__ */ new Date()).getMonth() + 1), 10);
  const db = getDb();
  if (!db) {
    console.error("\u274C SUPABASE_DB_URL not set");
    process.exit(1);
  }
  const reports = await getDailyReportsByMonth(db, year, month);
  if (reports.length === 0) {
    console.log(`
\u{1F4CA} Monthly Report \u2014 ${year}-${String(month).padStart(2, "0")}`);
    console.log("   No daily reports for this month.\n");
    return;
  }
  const totals = reports.reduce(
    (acc, r) => ({
      person_ids_count: acc.person_ids_count + (r.person_ids_count || 0),
      leads_pulled: acc.leads_pulled + (r.leads_pulled || 0),
      leads_validated: acc.leads_validated + (r.leads_validated || 0),
      leads_removed: acc.leads_removed + (r.leads_removed || 0),
      pushed_ok: acc.pushed_ok + (r.pushed_ok || 0),
      pushed_failed: acc.pushed_failed + (r.pushed_failed || 0),
      replies_fetched: acc.replies_fetched + (r.replies_fetched || 0),
      hot_count: acc.hot_count + (r.hot_count || 0),
      soft_count: acc.soft_count + (r.soft_count || 0),
      objection_count: acc.objection_count + (r.objection_count || 0),
      negative_count: acc.negative_count + (r.negative_count || 0),
      out_of_office_count: acc.out_of_office_count + (r.out_of_office_count || 0),
      auto_reply_count: acc.auto_reply_count + (r.auto_reply_count || 0),
      not_a_reply_count: acc.not_a_reply_count + (r.not_a_reply_count || 0),
      sent: acc.sent + (r.sent || 0),
      opened: acc.opened + (r.opened || 0),
      replies: acc.replies + (r.replies || 0)
    }),
    { person_ids_count: 0, leads_pulled: 0, leads_validated: 0, leads_removed: 0, pushed_ok: 0, pushed_failed: 0, replies_fetched: 0, hot_count: 0, soft_count: 0, objection_count: 0, negative_count: 0, out_of_office_count: 0, auto_reply_count: 0, not_a_reply_count: 0, sent: 0, opened: 0, replies: 0 }
  );
  const dr = totals.leads_pulled > 0 ? Math.round(totals.leads_validated / totals.leads_pulled * 1e3) / 10 : 0;
  const br = totals.leads_validated + totals.leads_removed > 0 ? Math.round(totals.leads_removed / (totals.leads_validated + totals.leads_removed) * 1e4) / 100 : 0;
  const nr = totals.replies_fetched > 0 ? Math.round(totals.negative_count / totals.replies_fetched * 1e4) / 100 : 0;
  const openRatePct = totals.sent > 0 ? (totals.opened / totals.sent * 100).toFixed(1) : "0";
  const replyRatePct = totals.sent > 0 ? (totals.replies / totals.sent * 100).toFixed(2) : "0";
  const notCustomerLine = totals.out_of_office_count + totals.auto_reply_count + totals.not_a_reply_count > 0
    ? `\u2022 Not customer: Out of office ${totals.out_of_office_count}  |  Auto-reply ${totals.auto_reply_count}  |  Not a reply ${totals.not_a_reply_count}`
    : "";
  const text = [
    `*OpenClaw Monthly Report \u2014 ${year}-${String(month).padStart(2, "0")}*`,
    `(${reports.length} days with data)`,
    "",
    "*Lead Pipeline (total)*",
    `\u2022 Apollo IDs found: ${totals.person_ids_count}`,
    `\u2022 Leads with email: ${totals.leads_pulled}`,
    `\u2022 Bouncer verified: ${totals.leads_validated} (${dr.toFixed(1)}% deliverable)`,
    `\u2022 Removed: ${totals.leads_removed} (bounce \u2248 ${br.toFixed(2)}%)`,
    `\u2022 Pushed to Instantly: ${totals.pushed_ok} ok / ${totals.pushed_failed} failed`,
    "",
    "*Campaign (Instantly API, total)*",
    `\u2022 Emails sent: ${totals.sent}`,
    `\u2022 Opens: ${totals.opened} (${openRatePct}%)`,
    `\u2022 Replies: ${totals.replies} (${replyRatePct}%)`,
    "",
    "*Reply Classification (LLM, total)*",
    `\u2022 Fetched: ${totals.replies_fetched}`,
    `\u2022 Customer: Hot ${totals.hot_count}  |  Soft ${totals.soft_count}  |  Objection ${totals.objection_count}  |  Negative ${totals.negative_count} (rate \u2248 ${nr.toFixed(2)}%)`,
    notCustomerLine
  ].filter(Boolean).join("\n");
  console.log("\n" + text + "\n");
}
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
