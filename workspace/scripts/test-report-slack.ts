#!/usr/bin/env node
/**
 * Test script: build sample Process Replies + Daily Report and send to a Slack channel.
 * Usage (from repo root, .env loaded):
 *   node workspace/scripts/test-report-slack.mjs
 * Or: SLACK_BOT_TOKEN=xoxb-... node workspace/scripts/test-report-slack.mjs
 *
 * Sends to channel C0ALRRHK61X (override with SLACK_TEST_CHANNEL).
 */

import {
  buildProcessRepliesMessage,
  buildDailyReportMessage,
  postSlackMessage,
} from '../lib/slack-templates.js';

const TEST_CHANNEL = process.env.SLACK_TEST_CHANNEL || 'C0ALRRHK61X';

function getNowPT(): string {
  return (
    new Date().toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' PT'
  );
}

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const runAtPT = getNowPT();

  // ── Sample Process Replies Report ─────────────────────────────────────
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
    durationSec: 47,
  });

  // ── Sample Daily Report ───────────────────────────────────────────────
  const dailyReportText = buildDailyReportMessage({
    reportDate: today,
    campaignIdShort: '7ba49983...',
    reportRunAtPT: runAtPT,
    personIdsCount: 150,
    leadsPulled: 120,
    leadsValidated: 95,
    leadsRemoved: 25,
    deliverableRatePct: '79.2%',
    bounceRatePct: '20.83%',
    pushedOk: 80,
    pushedFailed: 2,
    sent: 250,
    opened: 45,
    openRatePct: '18.0%',
    repliesInst: 28,
    replyRatePct: '11.20%',
    contacted: 250,
    newLeadsContacted: 80,
    clicks: 12,
    uniqueClicks: 10,
    repliesFetched: 28,
    hotCount: 3,
    softCount: 8,
    objectionCount: 5,
    negativeCount: 10,
    negativeRatePct: '35.71%',
    outOfOfficeCount: 1,
    autoReplyCount: 1,
    notAReplyCount: 0,
  });

  console.log('Sending sample reports to channel', TEST_CHANNEL, '...\n');
  console.log('--- Process Replies (sample) ---\n');
  console.log(processRepliesText);
  console.log('\n--- Daily Report (sample) ---\n');
  console.log(dailyReportText);
  console.log('\n--- Sending to Slack ---');

  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('Error: SLACK_BOT_TOKEN not set. Set it in .env or pass as env.');
    process.exit(1);
  }

  const ok1 = await postSlackMessage(TEST_CHANNEL, processRepliesText);
  const ok2 = await postSlackMessage(TEST_CHANNEL, dailyReportText);

  if (ok1 && ok2) {
    console.log('Done. Both messages sent to', TEST_CHANNEL);
  } else {
    console.error('Send failed. Process Replies:', ok1 ? 'OK' : 'FAIL', '| Daily Report:', ok2 ? 'OK' : 'FAIL');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
