/**
 * Shared constants for OpenClaw skills
 */

import { parseIntSafe } from './utils.js';

// ── Lead Processing Statuses ────────────────────────────────────────

export const LEAD_STATUS = {
  NEW: 'new',
  APOLLO_MATCHED: 'apollo_matched',
  BOUNCER_VERIFIED: 'bouncer_verified',
  INSTANTLY_LOADED: 'instantly_loaded',
  REPLIED: 'replied',
  FAILED: 'failed',
} as const;

export const LEAD_STATUSES = Object.values(LEAD_STATUS);

export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export function isValidLeadStatus(status: string): status is LeadStatus {
  return LEAD_STATUSES.includes(status as LeadStatus);
}

// ── Bouncer Result Statuses ────────────────────────────────────────

export const BOUNCER_RESULT = {
  /** Email is valid and deliverable */
  DELIVERABLE: 'deliverable',
  /** Email is invalid or does not exist */
  UNDELIVERABLE: 'undeliverable',
  /** Email may be valid but has risk factors (catch-all, disposable, etc.) */
  RISKY: 'risky',
  /** Bouncer could not determine status */
  UNKNOWN: 'unknown',
} as const;

export type BouncerResultStatus = (typeof BOUNCER_RESULT)[keyof typeof BOUNCER_RESULT];

/** Legacy: deliverable + undeliverable only (see `BOUNCER_RESULT` for full API statuses). */
export const BOUNCER_AUTO_HANDLED = [BOUNCER_RESULT.DELIVERABLE, BOUNCER_RESULT.UNDELIVERABLE] as const;

export function isBouncerAutoHandled(status: string): boolean {
  return BOUNCER_AUTO_HANDLED.includes(status as (typeof BOUNCER_AUTO_HANDLED)[number]);
}

// ── Email Status (stored in leads.email_status) ────────────────────

export const EMAIL_STATUS = {
  DELIVERABLE: 'deliverable',
  UNDELIVERABLE: 'undeliverable',
  /** Bouncer `risky` — not treated as undeliverable; still `bouncer_verified`. */
  RISKY: 'risky',
  /** Bouncer `unknown` or unrecognized status. */
  UNKNOWN: 'unknown',
} as const;

export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

// ── Failure Reasons ────────────────────────────────────────────────

export const FAILURE_REASON = {
  EMAIL_NOT_DELIVERABLE: 'Email not deliverable',
  API_ERROR: 'API error',
  TIMEOUT: 'Timeout',
} as const;

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

// ── Pipeline limits (ENV + single fallback table) ─────────────────

/** Env var names — set these in `.env` to tune limits; same keys are used by shell scripts after `load_env`. */
export const LIMIT_ENV = {
  LOAD_LIMIT: 'LOAD_LIMIT',
  INSTANTLY_LOAD_DAILY_CAP: 'INSTANTLY_LOAD_DAILY_CAP',
  BOUNCER_DAILY_CAP: 'BOUNCER_DAILY_CAP',
  /** Bouncer API chunk size (emails per submit). */
  BOUNCER_BATCH_SIZE: 'BOUNCER_BATCH_SIZE',
  /** Max leads verified per cron run (shell `run-build-list.sh`; should align with batch size). */
  BOUNCER_PER_RUN_MAX: 'BOUNCER_PER_RUN_MAX',
} as const;

/**
 * Fallback numbers when an env var is unset (single place to edit defaults).
 * Shell `apply_limit_env_defaults` reads these from the built `lib/constants.mjs`.
 */
export const FALLBACK_LIMITS = {
  LOAD_LIMIT: 200,
  INSTANTLY_LOAD_DAILY_CAP: 600,
  BOUNCER_DAILY_CAP: 600,
  /** Emails per Bouncer batch submit (API + cron pacing). */
  BOUNCER_BATCH_SIZE: 100,
  /** Max leads per `run-build-list.sh` invocation (cron retries every 10 min until daily cap). */
  BOUNCER_PER_RUN_MAX: 100,
} as const;

// ── Default Values ──────────────────────────────────────────────────

export const DEFAULTS = {
  TARGET_COUNT: 5,
  /** Max verified leads per Instantly run — from `process.env.LOAD_LIMIT` or FALLBACK_LIMITS */
  LOAD_LIMIT: parseIntSafe(process.env[LIMIT_ENV.LOAD_LIMIT], FALLBACK_LIMITS.LOAD_LIMIT),
  /** Max pushes to Instantly per Eastern calendar day */
  INSTANTLY_LOAD_DAILY_CAP: parseIntSafe(
    process.env[LIMIT_ENV.INSTANTLY_LOAD_DAILY_CAP],
    FALLBACK_LIMITS.INSTANTLY_LOAD_DAILY_CAP
  ),
  /** Max bouncer_verified counted per Eastern day (shell/cron enforces) */
  BOUNCER_DAILY_CAP: parseIntSafe(
    process.env[LIMIT_ENV.BOUNCER_DAILY_CAP],
    FALLBACK_LIMITS.BOUNCER_DAILY_CAP
  ),
  BOUNCER_BATCH_SIZE: parseIntSafe(
    process.env[LIMIT_ENV.BOUNCER_BATCH_SIZE],
    FALLBACK_LIMITS.BOUNCER_BATCH_SIZE
  ),
  FETCH_LIMIT: 100,
};

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
    /** GET — paginate with `limit` + `starting_after` (see Instantly API list campaigns) */
    CAMPAIGNS_LIST: 'https://api.instantly.ai/api/v2/campaigns',
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
// Single source of truth for auto-reply links. Import from here only (instantly, reply-by-category).

export const HOT_REPLY_TEMPLATE = {
  BOOK_NOW_URL: 'https://meet.designpickle.com/campaign/ob-demo-response',
  COMPARE_URL: 'https://designpickle.com/comparison',
} as const;

// ── Classification model (accuracy required) ───────────────────────
/** Model used for reply classification. gpt-4o recommended for strict accuracy. */
export const CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || 'gpt-4o';

/** Model for generating hot-lead email bodies (can be lighter than classification). */
export const HOT_REPLY_GENERATION_MODEL =
  process.env.HOT_REPLY_GENERATION_MODEL || process.env.REPLY_CLASSIFICATION_MODEL || 'gpt-4o-mini';

/** Closing line for hot auto-replies (e.g. "-Bryan Butvidas"). */
export const HOT_REPLY_SIGN_OFF = process.env.HOT_REPLY_SIGN_OFF || '- Bryan Butvidas';

// ── LLM Prompts ─────────────────────────────────────────────────────

/**
 * Build the user prompt for OpenAI to draft a hot-lead reply.
 * Params: prospect’s first name, thread subject, their message, both required URLs, sign-off.
 */
export function buildHotReplyGenerationPrompt(params: {
  firstName: string;
  subject: string;
  prospectBody: string;
  bookUrl: string;
  compareUrl: string;
  signOff: string;
}): string {
  const book = params.bookUrl.trim();
  const compare = params.compareUrl.trim();
  const sign = params.signOff.trim();
  if (!book || !compare || !sign) {
    throw new Error('buildHotReplyGenerationPrompt: bookUrl, compareUrl, and signOff must be non-empty');
  }

  const name = params.firstName.trim() || 'there';
  const subj = params.subject.trim() || '(no subject)';
  const body =
    params.prospectBody.length > 4000
      ? `${params.prospectBody.slice(0, 4000)}\n\n[Message truncated for the model]`
      : params.prospectBody;

  return `You write a short follow-up email reply for a **hot** sales lead (they showed interest: want to learn more, book time, or continue the conversation).

## Your job
- Reply in **English**.
- **Tone:** Warm, professional, B2B-appropriate, confident but not pushy. Sound like a real person (Design Pickle / creative services context is fine). Mirror the prospect’s energy slightly (if they’re brief, stay brief).
- **First line:** Acknowledge their message in a natural way (do not quote long blocks).
- **Body:** Move them toward two actions: (1) book a call, (2) skim a comparison page. You must weave these in smoothly—not robotic bullet spam.
- **Length:** About 3–6 short sentences total (plus sign-off). No walls of text.

## Hard requirements (non-negotiable)
1. Include **both** URLs below **verbatim** (exact characters) in the **plain text** version:
   - Scheduling: ${book}
   - Comparison: ${compare}
2. In the **HTML** version, include **both** URLs as clickable links (\`<a href="EXACT_URL">...</a>\`). Link text can be short (e.g. "Book a time", "Compare options") but \`href\` must be exactly these URLs:
   - ${book}
   - ${compare}
3. End the email with this sign-off line **exactly** (same punctuation):
   ${sign}
4. Do **not** invent discounts, legal promises, or specific pricing. Do **not** claim availability or meeting times you don’t know.

## Context for this thread
- Prospect first name (for greeting): ${name}
- Subject: ${subj}
- Their latest reply:
"""
${body}
"""

## Output format
Return **only** a single JSON object (no markdown fences, no commentary):
{
  "body_html": "<p>...</p> ... full HTML email body suitable for Instantly (include <br> or <p> as needed; include the two links as <a href=...>)",
  "body_text": "Plain text version with both raw URLs present exactly once each (or clearly listed)"
}`;
}

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
  "Sure I'll bite"
] as const;

