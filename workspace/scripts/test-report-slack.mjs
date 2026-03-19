#!/usr/bin/env node

// lib/slack-templates.ts
function buildProcessRepliesMessage(p) {
  const totalClassified = p.hot + p.soft + p.objection + p.negative + (p.outOfOffice ?? 0) + (p.autoReply ?? 0) + (p.notAReply ?? 0);
  const customerTotal = p.hot + p.soft + p.objection + p.negative;
  const notCustomer = (p.outOfOffice ?? 0) + (p.autoReply ?? 0) + (p.notAReply ?? 0);
  const lines = [
    `\u{1F4EC} *Process Replies Report*`,
    `Date: ${p.date}${p.runAtPT ? `  \xB7  Run: ${p.runAtPT}` : ""}${p.durationSec !== void 0 ? `  \xB7  ${p.durationSec}s` : ""}`,
    `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`,
    ``,
    `*Inbox*`,
    `\u2022 Unread (API): ${p.unreadCount ?? "\u2014"}`,
    `\u2022 Fetched this run: ${p.repliesFetched}`,
    `\u2022 Total classified: ${totalClassified}`,
    ``,
    `*Customer reply (classified)*`,
    `\u2022 Hot: ${p.hot}  \xB7  Soft: ${p.soft}  \xB7  Objection: ${p.objection}  \xB7  Negative: ${p.negative}`,
    `\u2022 Subtotal: ${customerTotal}`,
    ``,
    `*Not customer reply*`,
    `\u2022 Out of office: ${p.outOfOffice ?? 0}  \xB7  Auto-reply: ${p.autoReply ?? 0}  \xB7  Not a reply: ${p.notAReply ?? 0}`,
    `\u2022 Subtotal: ${notCustomer}`,
    ``,
    `*Actions*`,
    `\u2022 Auto-replied (hot): ${p.autoReplied}`,
    `\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550`
  ];
  return lines.join("\n");
}
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
async function postSlackMessage(channel, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channel) return false;
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ channel, text })
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json.ok === true;
  } catch {
    return false;
  }
}

// scripts/test-report-slack.ts
var TEST_CHANNEL = process.env.SLACK_TEST_CHANNEL || "C0ALRRHK61X";
function getNowPT() {
  return (/* @__PURE__ */ new Date()).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }) + " PT";
}
async function main() {
  const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const runAtPT = getNowPT();
  const processRepliesText = buildProcessRepliesMessage({
    date: today,
    unreadCount: 5,
    repliesFetched: 12,
    hot: 2,
    soft: 3,
    objection: 1,
    negative: 4,
    outOfOffice: 1,
    autoReply: 1,
    notAReply: 0,
    autoReplied: 2,
    runAtPT,
    durationSec: 47
  });
  const dailyReportText = buildDailyReportMessage({
    reportDate: today,
    campaignIdShort: "7ba49983...",
    reportRunAtPT: runAtPT,
    personIdsCount: 150,
    leadsPulled: 120,
    leadsValidated: 95,
    leadsRemoved: 25,
    deliverableRatePct: "79.2%",
    bounceRatePct: "20.83%",
    pushedOk: 80,
    pushedFailed: 2,
    sent: 250,
    opened: 45,
    openRatePct: "18.0%",
    repliesInst: 28,
    replyRatePct: "11.20%",
    contacted: 250,
    newLeadsContacted: 80,
    clicks: 12,
    uniqueClicks: 10,
    repliesFetched: 28,
    hotCount: 3,
    softCount: 8,
    objectionCount: 5,
    negativeCount: 10,
    negativeRatePct: "35.71%",
    outOfOfficeCount: 1,
    autoReplyCount: 1,
    notAReplyCount: 0
  });
  console.log("Sending sample reports to channel", TEST_CHANNEL, "...\n");
  console.log("--- Process Replies (sample) ---\n");
  console.log(processRepliesText);
  console.log("\n--- Daily Report (sample) ---\n");
  console.log(dailyReportText);
  console.log("\n--- Sending to Slack ---");
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error("Error: SLACK_BOT_TOKEN not set. Set it in .env or pass as env.");
    process.exit(1);
  }
  const ok1 = await postSlackMessage(TEST_CHANNEL, processRepliesText);
  const ok2 = await postSlackMessage(TEST_CHANNEL, dailyReportText);
  if (ok1 && ok2) {
    console.log("Done. Both messages sent to", TEST_CHANNEL);
  } else {
    console.error("Send failed. Process Replies:", ok1 ? "OK" : "FAIL", "| Daily Report:", ok2 ? "OK" : "FAIL");
    process.exit(1);
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
