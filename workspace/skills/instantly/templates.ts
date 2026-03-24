/**
 * Email templates for auto-replies
 */

import { HOT_REPLY_TEMPLATE } from '../../lib/constants.js';

/**
 * Build hot lead auto-reply template.
 */
export function buildHotReplyTemplate(firstName: string): { html: string; text: string } {
  const name = firstName || 'there';
  const { BOOK_NOW_URL, COMPARE_URL } = HOT_REPLY_TEMPLATE;

  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${BOOK_NOW_URL}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>👉 <a href="${COMPARE_URL}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},\n\nYou can schedule here: Book now\n${BOOK_NOW_URL}\n\nHave a look at this before we connect. Quickly covers us vs. alternatives.\n👉 Compare Design Pickle\n${COMPARE_URL}\n\nSee you then.\n-Bryan Butvidas`;
  return { html, text };
}
