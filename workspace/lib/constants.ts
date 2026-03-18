/**
 * Shared constants for OpenClaw skills
 */

// ── Lead Processing Statuses ────────────────────────────────────────

export const LEAD_STATUSES = [
  'new',
  'apollo_matched',
  'bouncer_verified',
  'instantly_loaded',
  'replied',
  'failed',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function isValidLeadStatus(status: string): status is LeadStatus {
  return LEAD_STATUSES.includes(status as LeadStatus);
}

// ── Reply Categories ────────────────────────────────────────────────
// Real customer reply (message from lead): hot, soft, objection, negative.
// Not a genuine reply: out_of_office, auto_reply, not_a_reply.

export const CUSTOMER_REPLY_CATEGORIES = ['hot', 'soft', 'objection', 'negative'] as const;
export const NON_REPLY_CATEGORIES = ['out_of_office', 'auto_reply', 'not_a_reply'] as const;

export const REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES,
] as const;

export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];
export type CustomerReplyCategory = (typeof CUSTOMER_REPLY_CATEGORIES)[number];

export function isValidReplyCategory(category: string): category is ReplyCategory {
  return REPLY_CATEGORIES.includes(category as ReplyCategory);
}

export function isCustomerReplyCategory(category: string): category is CustomerReplyCategory {
  return CUSTOMER_REPLY_CATEGORIES.includes(category as CustomerReplyCategory);
}

// ── Rate Limits ─────────────────────────────────────────────────────

export const RATE_LIMITS = {
  INSTANTLY_BULK_ADD_MAX: 1000,
  INSTANTLY_DELAY_MS: 500,
  APOLLO_MATCH_BATCH_SIZE: 10,
  APOLLO_DELAY_BETWEEN_PAGES_MS: 1000,
  APOLLO_DELAY_BETWEEN_BATCHES_MS: 500,
  APOLLO_RATE_LIMIT_PAUSE_MS: 60000,
  BOUNCER_BATCH_SIZE_MAX: 1000,
  BOUNCER_POLL_INTERVAL_MS: 5000,
  BOUNCER_MAX_WAIT_MS: 300000,
  BOUNCER_DELAY_BETWEEN_BATCHES_MS: 1000,
} as const;

// ── Default Values ──────────────────────────────────────────────────

export const DEFAULTS = {
  TARGET_COUNT: 5,
  LOAD_LIMIT: 100,
  /** Max leads to push to Instantly per calendar day (PT). Env: INSTANTLY_LOAD_DAILY_CAP */
  INSTANTLY_LOAD_DAILY_CAP: 200,
  BOUNCER_BATCH_SIZE: 1000,
  FETCH_LIMIT: 100,
} as const;

// ── Slack Channels ──────────────────────────────────────────────────

export const SLACK_CHANNELS = {
  REPORT: process.env.SLACK_REPORT_CHANNEL || '',
  ALERT: process.env.SLACK_ALERT_CHANNEL || '',
} as const;

// ── API Endpoints ───────────────────────────────────────────────────

export const API_ENDPOINTS = {
  APOLLO: {
    SEARCH: 'https://api.apollo.io/api/v1/mixed_people/api_search',
    BULK_MATCH: 'https://api.apollo.io/api/v1/people/bulk_match',
  },
  BOUNCER: {
    SUBMIT_BATCH: 'https://api.usebouncer.com/v1.1/email/verify/batch',
    GET_STATUS: (batchId: string) =>
      `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}`,
    DOWNLOAD: (batchId: string) =>
      `https://api.usebouncer.com/v1.1/email/verify/batch/${batchId}/download?download=all`,
  },
  INSTANTLY: {
    ADD_LEADS: 'https://api.instantly.ai/api/v2/leads/add',
    EMAILS: 'https://api.instantly.ai/api/v2/emails',
    UNREAD_COUNT: (campaignId: string) =>
      `https://api.instantly.ai/api/v2/emails/unread/count?campaign_id=${campaignId}`,
    REPLY: 'https://api.instantly.ai/api/v2/emails/reply',
    ANALYTICS_DAILY: 'https://api.instantly.ai/api/v2/campaigns/analytics/daily',
  },
  OPENAI: {
    CHAT_COMPLETIONS: 'https://api.openai.com/v1/chat/completions',
  },
  SLACK: {
    POST_MESSAGE: 'https://slack.com/api/chat.postMessage',
  },
} as const;

// ── Apollo ICP Defaults ─────────────────────────────────────────────

export const APOLLO_ICP_DEFAULTS = {
  PERSON_LOCATIONS: ['United States', 'Canada'],
  ORGANIZATION_LOCATIONS: ['United States', 'Canada'],
  ORGANIZATION_NUM_EMPLOYEES_RANGES: ['11,20', '21,50'],
  ORGANIZATION_INDUSTRY_TAG_IDS: [
    '5567cd4e7369643b70010000', // Computer Software
    '5567cd467369644d39040000', // Marketing & Advertising
    '5567ced173696450cb580000', // Retail
  ],
  CONTACT_EMAIL_STATUS: ['verified'],
  PERSON_TITLES: [
    'vp marketing',
    'head of marketing',
    'vp sales',
    'director of marketing',
    'director of sales',
  ],
} as const;

// ── Hot Reply Template ──────────────────────────────────────────────

export const HOT_REPLY_TEMPLATE = {
  BOOK_NOW_URL: 'https://meet.designpickle.com/campaign/ob-demo?ref=outbound',
  COMPARE_URL: 'https://designpickle.com/comparison',
} as const;

// ── Classification model (accuracy required) ───────────────────────
/** Model used for reply classification. gpt-4o recommended for strict accuracy. */
export const CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || 'gpt-4o';

// ── LLM Prompts ─────────────────────────────────────────────────────

export const PROMPTS = {
  CLASSIFICATION: `You are a strict classifier for outbound sales email replies. Your output must be precise and consistent.

## Step 1 – Is this a real reply from the prospect?
- If the message is an automatic reply (out of office, vacation, delivery receipt, "I'm away"), use: out_of_office or auto_reply.
- If it is a system/bounce or not a real message from a human prospect, use: not_a_reply.
- Only if it is a genuine human reply from the person we emailed, continue to Step 2.

## Step 2 – For real prospect replies only, choose ONE category:

**hot** – Prospect shows interest and is open to more conversation or next steps.
- Any expression of wanting more information or a conversation = hot.
- Examples that MUST be classified as hot: "I'd love to hear more", "Tell me more", "Interested", "Would like to learn more", "Sounds interesting", "Let's talk", "When can we chat?", "Send me more info", "Happy to discuss", "Reach out", "I'd like to know more", "Hear more about it".
- Rule: If the reply asks for more info, expresses interest, or invites contact → hot. Do NOT use objection for these.

**soft** – Prospect is interested but indicates a timing issue only (e.g. "reach out next month", "try me in Q3", "not right now but later", "we're busy until X").

**objection** – Prospect explicitly declines or says it is not a fit. No interest expressed.
- Examples: "Not a fit", "We use someone else", "Not interested", "No thanks", "We're all set", "Don't need this", "Won't work for us".
- Rule: Use objection ONLY when there is a clear decline. If the message contains interest phrases (hear more, tell me more, interested, learn more), it is hot, not objection.

**negative** – Unsubscribe, hard no, or explicit request to stop all contact.

## Examples (follow these strictly):
- "I'd love to hear more about it from you." → hot (expresses interest)
- "Tell me more about your offering." → hot
- "Not a fit for us right now." → objection (decline, no interest)
- "Reach out next quarter." → soft (timing)
- "Unsubscribe" or "Remove me" → negative

## Email to classify
Subject: {SUBJECT}
Body: {REPLY_TEXT}

Respond with a single JSON object only. No other text.
{ "category": "<one of: hot, soft, objection, negative, out_of_office, auto_reply, not_a_reply>", "confidence": <0-1 number>, "reason": "<one short line explaining why>" }`,
} as const;

/** Phrases that clearly indicate interest — if LLM returns objection, we override to hot. */
export const HOT_SIGNAL_PHRASES = [
  "love to hear more",
  "would love to hear more",
  "tell me more",
  "interested to hear more",
  "interested to learn",
  "would like to learn more",
  "would like to hear more",
  "sounds interesting",
  "let's talk",
  "when can we chat",
  "send me more",
  "i'm interested",
  "happy to discuss",
  "would like to know more",
  "reach out",
  "hear more about it",
] as const;

