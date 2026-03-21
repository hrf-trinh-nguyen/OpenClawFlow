// lib/utils.ts
function parseIntSafe(value, fallback) {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

// lib/constants.ts
var LEAD_STATUSES = [
  "new",
  "apollo_matched",
  "bouncer_verified",
  "instantly_loaded",
  "replied",
  "failed"
];
function isValidLeadStatus(status) {
  return LEAD_STATUSES.includes(status);
}
var CUSTOMER_REPLY_CATEGORIES = ["hot", "soft", "objection", "negative"];
var NON_REPLY_CATEGORIES = ["out_of_office", "auto_reply", "not_a_reply"];
var REPLY_CATEGORIES = [
  ...CUSTOMER_REPLY_CATEGORIES,
  ...NON_REPLY_CATEGORIES
];
function isValidReplyCategory(category) {
  return REPLY_CATEGORIES.includes(category);
}
function isCustomerReplyCategory(category) {
  return CUSTOMER_REPLY_CATEGORIES.includes(category);
}
var RATE_LIMITS = {
  INSTANTLY_BULK_ADD_MAX: 1e3,
  INSTANTLY_DELAY_MS: 500,
  APOLLO_MATCH_BATCH_SIZE: 10,
  APOLLO_DELAY_BETWEEN_PAGES_MS: 1e3,
  APOLLO_DELAY_BETWEEN_BATCHES_MS: 500,
  APOLLO_RATE_LIMIT_PAUSE_MS: 6e4,
  BOUNCER_BATCH_SIZE_MAX: 1e3,
  BOUNCER_POLL_INTERVAL_MS: 5e3,
  BOUNCER_MAX_WAIT_MS: 3e5,
  BOUNCER_DELAY_BETWEEN_BATCHES_MS: 1e3
};
var LIMIT_ENV = {
  LOAD_LIMIT: "LOAD_LIMIT",
  INSTANTLY_LOAD_DAILY_CAP: "INSTANTLY_LOAD_DAILY_CAP",
  BOUNCER_DAILY_CAP: "BOUNCER_DAILY_CAP"
};
var FALLBACK_LIMITS = {
  LOAD_LIMIT: 200,
  INSTANTLY_LOAD_DAILY_CAP: 600,
  BOUNCER_DAILY_CAP: 600
};
var DEFAULTS = {
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
  BOUNCER_BATCH_SIZE: 1e3,
  FETCH_LIMIT: 100
};
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
var APOLLO_ICP_DEFAULTS = {
  PERSON_LOCATIONS: ["United States", "Canada"],
  ORGANIZATION_LOCATIONS: ["United States", "Canada"],
  ORGANIZATION_NUM_EMPLOYEES_RANGES: ["11,20", "21,50"],
  ORGANIZATION_INDUSTRY_TAG_IDS: [
    "5567cd4e7369643b70010000",
    // Computer Software
    "5567cd467369644d39040000",
    // Marketing & Advertising
    "5567ced173696450cb580000"
    // Retail
  ],
  CONTACT_EMAIL_STATUS: ["verified"],
  PERSON_TITLES: [
    "vp marketing",
    "head of marketing",
    "vp sales",
    "director of marketing",
    "director of sales"
  ]
};
var HOT_REPLY_TEMPLATE = {
  BOOK_NOW_URL: "https://meet.designpickle.com/campaign/ob-demo-response",
  COMPARE_URL: "https://designpickle.com/comparison"
};
var CLASSIFICATION_MODEL = process.env.REPLY_CLASSIFICATION_MODEL || "gpt-4o";
var PROMPTS = {
  CLASSIFICATION: `You are a strict classifier for outbound sales email replies. Your output must be precise and consistent.

## Step 1 \u2013 Is this a real reply from the prospect?
- If the message is an automatic reply (out of office, vacation, delivery receipt, "I'm away"), use: out_of_office or auto_reply.
- If it is a system/bounce or not a real message from a human prospect, use: not_a_reply.
- Only if it is a genuine human reply from the person we emailed, continue to Step 2.

## Step 2 \u2013 For real prospect replies only, choose ONE category:

**hot** \u2013 Prospect shows interest and is open to more conversation or next steps.
- Any expression of wanting more information or a conversation = hot.
- Examples that MUST be classified as hot: "I'd love to hear more", "Tell me more", "Interested", "Would like to learn more", "Sounds interesting", "Let's talk", "When can we chat?", "Send me more info", "Happy to discuss", "Reach out", "I'd like to know more", "Hear more about it".
- Rule: If the reply asks for more info, expresses interest, or invites contact \u2192 hot. Do NOT use objection for these.

**soft** \u2013 Prospect is interested but indicates a timing issue only (e.g. "reach out next month", "try me in Q3", "not right now but later", "we're busy until X").

**objection** \u2013 Prospect explicitly declines or says it is not a fit. No interest expressed.
- Examples: "Not a fit", "We use someone else", "Not interested", "No thanks", "We're all set", "Don't need this", "Won't work for us".
- Rule: Use objection ONLY when there is a clear decline. If the message contains interest phrases (hear more, tell me more, interested, learn more), it is hot, not objection.

**negative** \u2013 Unsubscribe, hard no, or explicit request to stop all contact.

## Examples (follow these strictly):
- "I'd love to hear more about it from you." \u2192 hot (expresses interest)
- "Tell me more about your offering." \u2192 hot
- "Not a fit for us right now." \u2192 objection (decline, no interest)
- "Reach out next quarter." \u2192 soft (timing)
- "Unsubscribe" or "Remove me" \u2192 negative

## Email to classify
Subject: {SUBJECT}
Body: {REPLY_TEXT}

Respond with a single JSON object only. No other text.
{ "category": "<one of: hot, soft, objection, negative, out_of_office, auto_reply, not_a_reply>", "confidence": <0-1 number>, "reason": "<one short line explaining why>" }`
};
var HOT_SIGNAL_PHRASES = [
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
  "hear more about it"
];
export {
  API_ENDPOINTS,
  APOLLO_ICP_DEFAULTS,
  CLASSIFICATION_MODEL,
  CUSTOMER_REPLY_CATEGORIES,
  DEFAULTS,
  FALLBACK_LIMITS,
  HOT_REPLY_TEMPLATE,
  HOT_SIGNAL_PHRASES,
  LEAD_STATUSES,
  LIMIT_ENV,
  NON_REPLY_CATEGORIES,
  PROMPTS,
  RATE_LIMITS,
  REPLY_CATEGORIES,
  SLACK_CHANNELS,
  isCustomerReplyCategory,
  isValidLeadStatus,
  isValidReplyCategory
};
