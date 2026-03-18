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
}

export function buildProcessRepliesMessage(p: ProcessRepliesParams): string {
  const lines = [
    `📬 *Process Replies Report*`,
    `Date: ${p.date}`,
    `─────────────────────────`,
    `Replies fetched: ${p.repliesFetched}`,
    `*Customer reply (classified):* Hot ${p.hot}  |  Soft ${p.soft}  |  Objection ${p.objection}  |  Negative ${p.negative}`,
    `*Not customer reply:* Out of office ${p.outOfOffice ?? 0}  |  Auto-reply ${p.autoReply ?? 0}  |  Not a reply ${p.notAReply ?? 0}`,
    `Auto-replied (hot): ${p.autoReplied}`,
  ];

  if (p.unreadCount !== undefined) {
    lines.splice(3, 0, `Inbox unread: ${p.unreadCount}`);
  }

  lines.push(`─────────────────────────`);
  return lines.join('\n');
}

// ── Daily Report ────────────────────────────────────────────────────

export interface DailyReportParams {
  reportDate: string;
  campaignIdShort?: string;
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
  const lines = [
    `📊 *OpenClaw Daily Report*`,
    `Date: ${p.reportDate}${p.campaignIdShort ? `  |  Campaign: ${p.campaignIdShort}` : ''}`,
    `═════════════════════════`,
    ``,
    `*Lead Pipeline*`,
    `• Apollo IDs found: ${p.personIdsCount}`,
    `• Leads with email: ${p.leadsPulled}`,
    `• Bouncer verified: ${p.leadsValidated} (${p.deliverableRatePct} deliverable)`,
    `• Removed: ${p.leadsRemoved} (bounce ${p.bounceRatePct})`,
    `• Pushed to Instantly: ${p.pushedOk} ok / ${p.pushedFailed} failed`,
    ``,
    `*Campaign (Instantly)*`,
    `• Emails sent: ${p.sent}`,
    `• Opens: ${p.opened} (${p.openRatePct})`,
    `• Replies: ${p.repliesInst} (${p.replyRatePct})`,
  ];

  if (p.repliesFetched > 0) {
    lines.push(
      ``,
      `*Reply Classification (customer reply only)*`,
      `• Hot: ${p.hotCount}  |  Soft: ${p.softCount}  |  Objection: ${p.objectionCount}  |  Negative: ${p.negativeCount} (${p.negativeRatePct})`
    );
    const ooo = p.outOfOfficeCount ?? 0;
    const ar = p.autoReplyCount ?? 0;
    const nar = p.notAReplyCount ?? 0;
    if (ooo + ar + nar > 0) {
      lines.push(`• Not customer reply: Out of office ${ooo}  |  Auto-reply ${ar}  |  Not a reply ${nar}`);
    }
  }

  lines.push(``, `═════════════════════════`);
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
