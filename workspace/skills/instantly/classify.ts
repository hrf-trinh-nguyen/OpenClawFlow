/**
 * Reply classification using OpenAI
 *
 * Classifies email replies into categories: hot, soft, objection, negative,
 * out_of_office, auto_reply, not_a_reply.
 */

import { parseJsonSafe } from '../../lib/utils.js';
import {
  API_ENDPOINTS,
  PROMPTS,
  isValidReplyCategory,
  HOT_SIGNAL_PHRASES,
  CLASSIFICATION_MODEL,
  type ReplyCategory,
} from '../../lib/constants.js';
import { OpenAiApiError } from '../../lib/errors.js';

// ── Types ──────────────────────────────────────────────────────────

export interface Classification {
  category: ReplyCategory;
  confidence: number;
}

// ── Pre-filter patterns (skip LLM for obvious cases) ───────────────

const OOO_SUBJECT_PATTERNS = /out of office|ooo|automatic reply|abwesenheit|réponse automatique/i;
const OOO_BODY_PATTERNS =
  /out of (the )?office|away from (my )?office|I am currently out|I will be out|back on \d|returning on \d|limited access to (my )?email/i;
const AUTO_REPLY_PATTERNS =
  /automatic reply|auto.reply|vacation reply|I'm away|I am away|delivery receipt|read receipt|this is an automated/i;

/**
 * Pre-filter: detect OOO or auto-reply without calling LLM.
 */
export function getNonReplyCategory(subject: string, body: string): 'out_of_office' | 'auto_reply' | null {
  const sub = (subject || '').trim();
  const text = (body || '').trim();
  const combined = `${sub} ${text}`.toLowerCase();

  if (OOO_SUBJECT_PATTERNS.test(sub) || OOO_BODY_PATTERNS.test(combined)) {
    return 'out_of_office';
  }
  if (AUTO_REPLY_PATTERNS.test(combined)) {
    return 'auto_reply';
  }
  return null;
}

// ── LLM Classification ─────────────────────────────────────────────

export async function classifyReply(
  apiKey: string,
  subject: string,
  replyText: string
): Promise<Classification> {
  const prompt = PROMPTS.CLASSIFICATION.replace('{SUBJECT}', subject || '(no subject)').replace(
    '{REPLY_TEXT}',
    replyText || '(empty)'
  );

  const response = await fetch(API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CLASSIFICATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new OpenAiApiError(response.status, `Classification failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  const parsed = parseJsonSafe<{
    category?: string;
    confidence?: number;
    reason?: string;
  }>(content, {});

  let rawCategory = (parsed.category || '').trim().toLowerCase();
  if (!isValidReplyCategory(rawCategory)) rawCategory = 'not_a_reply';

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  if (parsed.reason && (rawCategory === 'objection' || rawCategory === 'hot')) {
    console.log(`   [classify] ${rawCategory} (${confidence}): ${parsed.reason}`);
  }

  // Override: clear interest phrases must be hot, not objection/soft
  const bodyLower = (replyText || '').toLowerCase();
  const hasHotSignal = HOT_SIGNAL_PHRASES.some((phrase) => bodyLower.includes(phrase.toLowerCase()));
  const category: ReplyCategory =
    hasHotSignal && (rawCategory === 'objection' || rawCategory === 'soft')
      ? 'hot'
      : (rawCategory as ReplyCategory);

  return { category, confidence };
}

/**
 * Classify a reply, using pre-filter first then LLM if needed.
 */
export async function classifyWithPrefilter(
  apiKey: string,
  subject: string,
  body: string
): Promise<Classification> {
  const nonReply = getNonReplyCategory(subject, body);
  if (nonReply) {
    return { category: nonReply, confidence: 1 };
  }
  return classifyReply(apiKey, subject, body);
}
