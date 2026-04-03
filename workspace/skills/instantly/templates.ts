/**
 * Email templates for auto-replies + optional AI-generated hot replies
 */

import { parseJsonSafe } from '../../lib/utils.js';
import {
  API_ENDPOINTS,
  HOT_REPLY_TEMPLATE,
  HOT_REPLY_GENERATION_MODEL,
  HOT_REPLY_SIGN_OFF,
  buildHotReplyGenerationPrompt,
} from '../../lib/constants.js';
import { OpenAiApiError } from '../../lib/errors.js';

function nonEmptyTrimmed(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * True when html/text are non-empty and contain both required URLs (before Instantly send).
 * If `opts` omitted, uses HOT_REPLY_TEMPLATE URLs.
 */
export function hotReplyBodiesReadyForSend(
  html: string,
  text: string,
  opts?: { bookUrl: string; compareUrl: string }
): boolean {
  const bookUrl = (opts?.bookUrl ?? HOT_REPLY_TEMPLATE.BOOK_NOW_URL)?.trim() ?? '';
  const compareUrl = (opts?.compareUrl ?? HOT_REPLY_TEMPLATE.COMPARE_URL)?.trim() ?? '';
  if (!bookUrl || !compareUrl) return false;
  const h = (html ?? '').trim();
  const t = (text ?? '').trim();
  if (h.length < 10 || t.length < 10) return false;
  return (
    h.includes(bookUrl) && h.includes(compareUrl) && t.includes(bookUrl) && t.includes(compareUrl)
  );
}

/**
 * Build hot lead auto-reply template (static fallback).
 * Throws if HOT_REPLY_TEMPLATE URLs are misconfigured (empty).
 */
export function buildHotReplyTemplate(firstName: string): { html: string; text: string } {
  const bookUrl = HOT_REPLY_TEMPLATE.BOOK_NOW_URL?.trim() ?? '';
  const compareUrl = HOT_REPLY_TEMPLATE.COMPARE_URL?.trim() ?? '';
  if (!bookUrl || !compareUrl) {
    throw new Error('HOT_REPLY_TEMPLATE: BOOK_NOW_URL and COMPARE_URL must be non-empty strings');
  }

  const name = (firstName || 'there').trim() || 'there';
  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${bookUrl}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>👉 <a href="${compareUrl}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},\n\nYou can schedule here: Book now\n${bookUrl}\n\nHave a look at this before we connect. Quickly covers us vs. alternatives.\n👉 Compare Design Pickle\n${compareUrl}\n\nSee you then.\n-Bryan Butvidas`;
  return { html, text };
}

function urlsPresentInBothOutputs(
  html: string,
  text: string,
  bookUrl: string,
  compareUrl: string
): boolean {
  return (
    html.includes(bookUrl) &&
    html.includes(compareUrl) &&
    text.includes(bookUrl) &&
    text.includes(compareUrl)
  );
}

/**
 * Generate hot-lead reply via OpenAI. Returns null if generation fails or validation fails (caller should use template).
 *
 * Params you can pass from env (URLs/sign-off already come from constants):
 * - firstName, subject, prospectBody from the thread
 */
export async function generateHotReplyContent(
  openaiApiKey: string,
  params: {
    firstName: string;
    subject: string;
    prospectBody: string;
    bookUrl?: string;
    compareUrl?: string;
    signOff?: string;
  }
): Promise<{ html: string; text: string } | null> {
  if (!nonEmptyTrimmed(openaiApiKey)) {
    return null;
  }

  const bookUrl = (params.bookUrl ?? HOT_REPLY_TEMPLATE.BOOK_NOW_URL).trim();
  const compareUrl = (params.compareUrl ?? HOT_REPLY_TEMPLATE.COMPARE_URL).trim();
  const signOff = (params.signOff ?? HOT_REPLY_SIGN_OFF).trim();

  if (!bookUrl || !compareUrl || !signOff) {
    console.warn('   ⚠️  Hot reply AI skipped: empty bookUrl, compareUrl, or signOff.');
    return null;
  }

  if (!nonEmptyTrimmed(HOT_REPLY_GENERATION_MODEL)) {
    console.warn('   ⚠️  Hot reply AI skipped: HOT_REPLY_GENERATION_MODEL is empty.');
    return null;
  }

  // No prospect text → skip LLM (avoid generic/hallucinated replies); caller uses template.
  if (!nonEmptyTrimmed(params.prospectBody)) {
    return null;
  }

  const prompt = buildHotReplyGenerationPrompt({
    firstName: params.firstName,
    subject: params.subject,
    prospectBody: params.prospectBody,
    bookUrl,
    compareUrl,
    signOff,
  });

  const response = await fetch(API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: HOT_REPLY_GENERATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.65,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new OpenAiApiError(response.status, `Hot reply generation failed: ${response.status}`);
  }

  const raw = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = raw.choices?.[0]?.message?.content;
  if (!content) return null;

  const parsed = parseJsonSafe(content) as {
    body_html?: string;
    body_text?: string;
    html?: string;
    text?: string;
  } | null;
  if (!parsed) return null;

  const html = (parsed.body_html ?? parsed.html ?? '').trim();
  const text = (parsed.body_text ?? parsed.text ?? '').trim();
  if (!html || !text) return null;

  if (!urlsPresentInBothOutputs(html, text, bookUrl, compareUrl)) {
    console.warn('   ⚠️  Generated hot reply missing required URLs; using static template.');
    return null;
  }

  if (!hotReplyBodiesReadyForSend(html, text, { bookUrl, compareUrl })) {
    console.warn('   ⚠️  Generated hot reply failed final body checks; using static template.');
    return null;
  }

  return { html, text };
}
