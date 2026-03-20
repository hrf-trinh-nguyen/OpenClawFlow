/**
 * Standard Slack message templates for OpenClaw reports.
 * Used so reports are consistent and not free-form AI messages.
 */

// ── Process Replies Report ──────────────────────────────────────────

export interface ProcessRepliesParams {
  date: string;
  unreadCount?: number;
  repliesFetched: number;
  hot: number;
  soft: number;
  objection: number;
  negative: number;
  outOfOffice?: number;
  autoReply?: number;
  notAReply?: number;
  autoReplied: number;
  /** Run time in US Eastern e.g. "Mar 19, 2:15 PM ET" */
  runAtET?: string;
  /** Duration in seconds */
  durationSec?: number;
}

export function buildProcessRepliesMessage(p: ProcessRepliesParams): string {
  const totalClassified =
    p.hot + p.soft + p.objection + p.negative + (p.outOfOffice ?? 0) + (p.autoReply ?? 0) + (p.notAReply ?? 0);
  const customerTotal = p.hot + p.soft + p.objection + p.negative;
  const notCustomer = (p.outOfOffice ?? 0) + (p.autoReply ?? 0) + (p.notAReply ?? 0);

  const lines = [
    `📬 *Process Replies Report*`,
    `Date: ${p.date}${p.runAtET ? `  ·  Run: ${p.runAtET}` : ''}${p.durationSec !== undefined ? `  ·  ${p.durationSec}s` : ''}`,
    `═════════════════════════`,
    ``,
    `*Inbox*`,
    `• Unread (API): ${p.unreadCount ?? '—'}`,
    `• Fetched this run: ${p.repliesFetched}`,
    `• Total classified: ${totalClassified}`,
    ``,
    `*Customer reply (classified)*`,
    `• Hot: ${p.hot}  ·  Soft: ${p.soft}  ·  Objection: ${p.objection}  ·  Negative: ${p.negative}`,
    `• Subtotal: ${customerTotal}`,
    ``,
    `*Not customer reply*`,
    `• Out of office: ${p.outOfOffice ?? 0}  ·  Auto-reply: ${p.autoReply ?? 0}  ·  Not a reply: ${p.notAReply ?? 0}`,
    `• Subtotal: ${notCustomer}`,
    ``,
    `*Actions*`,
    `• Auto-replied (hot): ${p.autoReplied}`,
    `═════════════════════════`,
  ];

  return lines.join('\n');
}

// ── Daily Report ────────────────────────────────────────────────────

export interface DailyReportParams {
  reportDate: string;
  campaignIdShort?: string;
  /** Report generated at (US Eastern) e.g. "Mar 19, 10:00 PM ET" */
  reportRunAtET?: string;
  personIdsCount: number;
  leadsPulled: number;
  leadsValidated: number;
  leadsRemoved: number;
  deliverableRatePct: string;
  bounceRatePct: string;
  pushedOk: number;
  pushedFailed: number;
  sent: number;
  opened: number;
  openRatePct: string;
  repliesInst: number;
  replyRatePct: string;
  /** Optional: contacted, new leads contacted, clicks from Instantly API */
  contacted?: number;
  newLeadsContacted?: number;
  clicks?: number;
  uniqueClicks?: number;
  repliesFetched: number;
  hotCount: number;
  softCount: number;
  objectionCount: number;
  negativeCount: number;
  negativeRatePct: string;
  outOfOfficeCount?: number;
  autoReplyCount?: number;
  notAReplyCount?: number;
}

export function buildDailyReportMessage(p: DailyReportParams): string {
  const customerTotal = p.hotCount + p.softCount + p.objectionCount + p.negativeCount;
  const notCustomer = (p.outOfOfficeCount ?? 0) + (p.autoReplyCount ?? 0) + (p.notAReplyCount ?? 0);
  const totalClassified = p.repliesFetched;

  const lines = [
    `📊 *OpenClaw Daily Report*`,
    `Date: ${p.reportDate}${p.campaignIdShort ? `  ·  Campaign: ${p.campaignIdShort}` : ''}${p.reportRunAtET ? `  ·  Generated: ${p.reportRunAtET}` : ''}`,
    `═════════════════════════`,
    ``,
    `*Lead Pipeline*`,
    `• Apollo IDs found: ${p.personIdsCount}`,
    `• Leads with email: ${p.leadsPulled}`,
    `• Bouncer verified: ${p.leadsValidated} (deliverable ${p.deliverableRatePct})`,
    `• Removed (bounce): ${p.leadsRemoved} (${p.bounceRatePct})`,
    `• Pushed to Instantly: ${p.pushedOk} ok  ·  ${p.pushedFailed} failed`,
    ``,
    `*Campaign (Instantly)*`,
    `• Emails sent: ${p.sent}`,
    `• Opens: ${p.opened} (${p.openRatePct})`,
    `• Replies (inbox): ${p.repliesInst} (${p.replyRatePct})`,
  ];

  if (p.contacted !== undefined && p.contacted > 0) {
    lines.push(`• Contacted: ${p.contacted}${p.newLeadsContacted !== undefined && p.newLeadsContacted > 0 ? `  ·  New leads contacted: ${p.newLeadsContacted}` : ''}`);
  }
  if (p.clicks !== undefined && (p.clicks > 0 || (p.uniqueClicks ?? 0) > 0)) {
    lines.push(`• Clicks: ${p.uniqueClicks ?? p.clicks} unique${p.clicks !== p.uniqueClicks && p.clicks > 0 ? ` (${p.clicks} total)` : ''}`);
  }

  lines.push(
    ``,
    `*Reply Classification (DB · ${p.reportDate})*`,
    `• Customer: Hot ${p.hotCount}  ·  Soft ${p.softCount}  ·  Objection ${p.objectionCount}  ·  Negative ${p.negativeCount} (${p.negativeRatePct})`,
    `• Customer subtotal: ${customerTotal}`,
    `• Not customer: Out of office ${p.outOfOfficeCount ?? 0}  ·  Auto-reply ${p.autoReplyCount ?? 0}  ·  Not a reply ${p.notAReplyCount ?? 0}`,
    `• Not customer subtotal: ${notCustomer}`,
    `• Total classified: ${totalClassified}`,
    ``,
    `═════════════════════════`
  );

  return lines.join('\n');
}

// ── Post to Slack ───────────────────────────────────────────────────

export async function postSlackMessage(channel: string, text: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !channel) return false;

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, text }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return json.ok === true;
  } catch {
    return false;
  }
}

export function postToReportChannel(text: string): Promise<boolean> {
  const channel = process.env.SLACK_REPORT_CHANNEL || '';
  return postSlackMessage(channel, text);
}
