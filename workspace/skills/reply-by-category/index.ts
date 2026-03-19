#!/usr/bin/env node

/**
 * Reply By Category Skill
 *
 * Sends the standard hot-reply template to leads whose replies have a specific
 * reply_category (e.g. hot, soft, objection) and have not been replied yet.
 *
 * Use when you want to manually trigger replies for a category (e.g. after
 * changing classification, or to send to "soft" leads you previously skipped).
 *
 * ENV:
 * - REPLY_CATEGORY: Single category (hot, soft, objection, negative) or comma-separated list
 * - REPLY_LIMIT: Max replies to send this run (default: 50)
 * - INSTANTLY_API_KEY, INSTANTLY_CAMPAIGN_ID, SUPABASE_DB_URL (required)
 *
 * Migration 011 must be applied so replies table has email_id, eaccount.
 * Only replies fetched AFTER migration will have these fields; older rows are skipped.
 */

import { getDb } from '../../lib/supabase-pipeline.js';
import { validateRequiredEnv, sleep, parseIntSafe } from '../../lib/utils.js';
import { API_ENDPOINTS, HOT_REPLY_TEMPLATE, RATE_LIMITS } from '../../lib/constants.js';
import { isValidReplyCategory, isCustomerReplyCategory } from '../../lib/constants.js';

// ── Config ──────────────────────────────────────────────────────────

validateRequiredEnv(['INSTANTLY_API_KEY', 'SUPABASE_DB_URL']);

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY!;
const REPLY_CATEGORY = (process.env.REPLY_CATEGORY || 'hot').trim();
const REPLY_LIMIT = parseIntSafe(process.env.REPLY_LIMIT, 50);

// Parse comma-separated categories
const categories = REPLY_CATEGORY.split(',')
  .map((c) => c.trim().toLowerCase())
  .filter((c) => c && isValidReplyCategory(c) && isCustomerReplyCategory(c));

if (categories.length === 0) {
  console.error('❌ REPLY_CATEGORY must be one or more of: hot, soft, objection, negative');
  process.exit(1);
}

// ── Instantly Reply API ─────────────────────────────────────────────

function buildHotReplyTemplate(firstName: string): { html: string; text: string } {
  const name = firstName || 'there';
  const { BOOK_NOW_URL, COMPARE_URL } = HOT_REPLY_TEMPLATE;

  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${BOOK_NOW_URL}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>👉 <a href="${COMPARE_URL}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},\n\nYou can schedule here: Book now\n${BOOK_NOW_URL}\n\nHave a look at this before we connect. Quickly covers us vs. alternatives.\n👉 Compare Design Pickle\n${COMPARE_URL}\n\nSee you then.\n-Bryan Butvidas`;
  return { html, text };
}

async function instantlyReplyToEmail(params: {
  reply_to_uuid: string;
  eaccount: string;
  subject: string;
  body_html: string;
  body_text: string;
}): Promise<void> {
  const response = await fetch(API_ENDPOINTS.INSTANTLY.REPLY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${INSTANTLY_API_KEY}`,
    },
    body: JSON.stringify({
      reply_to_uuid: params.reply_to_uuid,
      eaccount: params.eaccount,
      subject: params.subject || 'Re: Your inquiry',
      body: { html: params.body_html, text: params.body_text },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly reply failed: ${response.status} ${text}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n📤 Reply By Category`);
  console.log(`   Categories: ${categories.join(', ')}`);
  console.log(`   Limit: ${REPLY_LIMIT}\n`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  const res = await db.query(
    `SELECT id, from_email, subject, thread_id, email_id, eaccount
     FROM replies
     WHERE reply_category = ANY($1::reply_category[])
       AND replied_at IS NULL
       AND email_id IS NOT NULL
       AND eaccount IS NOT NULL
       AND eaccount != ''
     ORDER BY classified_at DESC NULLS LAST
     LIMIT $2`,
    [categories, REPLY_LIMIT]
  );

  const rows = res.rows as Array<{
    id: string;
    from_email: string;
    subject: string;
    thread_id: string;
    email_id: string;
    eaccount: string;
  }>;

  if (rows.length === 0) {
    console.log('ℹ️  No unreplied replies found for those categories (with email_id/eaccount).');
    console.log('   Tip: Only replies fetched after migration 011 have email_id stored.\n');
    await db.end();
    return;
  }

  console.log(`📊 Found ${rows.length} replies to send\n`);

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const leadRes = await db.query(
        `SELECT first_name FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
        [row.from_email]
      );
      const firstName = leadRes.rows[0]?.first_name?.trim() || '';
      const { html, text } = buildHotReplyTemplate(firstName);
      const subject = row.subject?.startsWith('Re:') ? row.subject : `Re: ${row.subject || 'Your inquiry'}`;

      await instantlyReplyToEmail({
        reply_to_uuid: row.email_id,
        eaccount: row.eaccount,
        subject,
        body_html: html,
        body_text: text,
      });

      await db.query(`UPDATE replies SET replied_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
      sent++;
      console.log(`   ✅ Replied to ${row.from_email}`);

      await sleep(300);
    } catch (err: any) {
      failed++;
      console.error(`   ❌ Failed ${row.from_email}: ${err.message}`);
    }

    await sleep(RATE_LIMITS.INSTANTLY_DELAY_MS);
  }

  console.log(`\n✅ Done: ${sent} sent, ${failed} failed\n`);
  await db.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
