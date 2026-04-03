/**
 * Instantly Fetch & Classify Service
 *
 * Pulls replies from Instantly inbox, classifies via LLM, auto-replies to hot leads.
 */

import { sleep, getDateRange } from '../../lib/utils.js';
import { RATE_LIMITS, DEFAULTS } from '../../lib/constants.js';
import { createServiceExecution, updateServiceExecution } from '../../lib/supabase-pipeline.js';
import { getErrorMessage } from '../../lib/errors.js';
import { fetchReplies, getUnreadCount, replyToEmail, type Reply } from './api.js';
import { classifyWithPrefilter, type Classification } from './classify.js';
import {
  buildHotReplyTemplate,
  generateHotReplyContent,
  hotReplyBodiesReadyForSend,
} from './templates.js';

// ── Types ──────────────────────────────────────────────────────────

export interface FetchResult {
  processed: number;
  hot: number;
  soft: number;
  objection: number;
  negative: number;
  out_of_office: number;
  auto_reply: number;
  not_a_reply: number;
  unreadCount?: number;
  dateLabel: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function getFetchDateRange(): { min: string; max: string } {
  return getDateRange(
    process.env.FETCH_DATE_FROM,
    process.env.FETCH_DATE_TO,
    process.env.FETCH_DATE || process.env.REPORT_DATE
  );
}

function useHotReplyAi(): boolean {
  const v = process.env.HOT_REPLY_USE_AI;
  if (v === undefined || String(v).trim() === '') return true;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

async function handleHotLead(
  db: any,
  apiKey: string,
  reply: Reply,
  openaiApiKey: string
): Promise<void> {
  const emailId = String(reply.email_id ?? '').trim();
  const eaccount = String(reply.eaccount ?? '').trim();

  if (!emailId || !eaccount) {
    console.log(`   ⚠️  Skip reply (missing email_id/eaccount): ${reply.from_email}`);
    return;
  }

  if (!String(apiKey ?? '').trim()) {
    console.warn(`   ⚠️  Skip hot reply: INSTANTLY_API_KEY is empty`);
    return;
  }

  try {
    const leadRes = await db.query(
      `SELECT first_name FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
      [reply.from_email]
    );
    const firstName = leadRes.rows[0]?.first_name?.trim() || '';

    let html: string | undefined;
    let text: string | undefined;

    if (useHotReplyAi() && String(openaiApiKey ?? '').trim()) {
      try {
        const gen = await generateHotReplyContent(openaiApiKey, {
          firstName,
          subject: reply.subject || '',
          prospectBody: reply.body || '',
        });
        if (gen) {
          html = gen.html;
          text = gen.text;
          console.log(`   ✨ Hot reply: AI-generated`);
        }
      } catch (err: unknown) {
        console.warn(`   ⚠️  Hot reply AI failed, using template: ${getErrorMessage(err)}`);
      }
    }

    if (!html || !text) {
      const t = buildHotReplyTemplate(firstName);
      html = t.html;
      text = t.text;
    }

    const bodyHtml = html.trim();
    const bodyText = text.trim();
    if (!hotReplyBodiesReadyForSend(bodyHtml, bodyText)) {
      console.warn(
        `   ⚠️  Skip send to ${reply.from_email}: reply body missing required URLs or too short (misconfigured template?)`
      );
      return;
    }

    const subjRaw = String(reply.subject ?? '').trim();
    const subject =
      subjRaw.length > 0
        ? subjRaw.startsWith('Re:')
          ? subjRaw
          : `Re: ${subjRaw}`
        : 'Re: Your inquiry';

    await replyToEmail(apiKey, {
      reply_to_uuid: emailId,
      eaccount,
      subject: subject.trim(),
      body_html: bodyHtml,
      body_text: bodyText,
    });

    await db.query(`UPDATE replies SET replied_at = NOW(), updated_at = NOW() WHERE thread_id = $1`, [
      reply.thread_id,
    ]);
    console.log(`   📤 Replied to hot lead: ${reply.from_email}`);
    await sleep(300);
  } catch (err: unknown) {
    console.error(`   ❌ Reply failed for ${reply.from_email}: ${getErrorMessage(err)}`);
  }
}

async function blacklistLead(db: any, email: string): Promise<void> {
  const leadRes = await db.query(
    `SELECT id FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
    [email]
  );

  if (leadRes.rows.length > 0) {
    await db.query(
      `UPDATE leads SET blacklisted = true, blacklist_reason = 'negative_reply', updated_at = NOW() WHERE id = $1`,
      [leadRes.rows[0].id]
    );
    console.log(`   ⛔ Blacklisted lead: ${email}`);
  }
}

// ── Fetch & Classify Service ───────────────────────────────────────

export async function runFetchAndClassifyService(
  db: any,
  runId: string,
  apiKey: string,
  campaignId: string,
  openaiApiKey: string
): Promise<FetchResult> {
  const { min, max } = getFetchDateRange();
  const dateLabel =
    process.env.FETCH_DATE_FROM && process.env.FETCH_DATE_TO
      ? `${process.env.FETCH_DATE_FROM} → ${process.env.FETCH_DATE_TO}`
      : process.env.FETCH_DATE || process.env.REPORT_DATE || 'today';

  console.log(`\n📥 Fetch & Classify: Processing replies (${dateLabel})...\n`);

  let unreadCount: number | undefined;
  try {
    unreadCount = await getUnreadCount(apiKey, campaignId);
    console.log(`   📬 Unread count: ${unreadCount}\n`);
  } catch {
    // Non-fatal
  }

  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: 'instantly',
    status: 'running',
  });

  try {
    const replies = await fetchReplies(apiKey, campaignId, { min, max }, DEFAULTS.FETCH_LIMIT);

    if (replies.length === 0) {
      console.log(`ℹ️  No replies for ${dateLabel}\n`);
      await updateServiceExecution(db, execId, {
        status: 'completed',
        completed_at: new Date(),
        output_count: 0,
      });
      return {
        processed: 0,
        hot: 0,
        soft: 0,
        objection: 0,
        negative: 0,
        out_of_office: 0,
        auto_reply: 0,
        not_a_reply: 0,
        unreadCount,
        dateLabel,
      };
    }

    console.log(`📊 Found ${replies.length} replies\n`);

    // Filter out already-replied threads
    const threadIds = replies.map((r) => r.thread_id).filter(Boolean);
    const alreadyRepliedRes =
      threadIds.length > 0
        ? await db.query(
            `SELECT thread_id FROM replies WHERE thread_id = ANY($1::text[]) AND replied_at IS NOT NULL`,
            [threadIds]
          )
        : { rows: [] };

    const alreadyReplied = new Set(alreadyRepliedRes.rows.map((r: any) => r.thread_id));
    const toProcess = replies.filter((r) => !alreadyReplied.has(r.thread_id));

    if (alreadyReplied.size > 0) {
      console.log(`   ⏭️  Skipping ${alreadyReplied.size} already auto-replied\n`);
    }

    if (toProcess.length === 0) {
      console.log(`ℹ️  No new replies to process\n`);
      await updateServiceExecution(db, execId, {
        status: 'completed',
        completed_at: new Date(),
        output_count: 0,
      });
      return {
        processed: 0,
        hot: 0,
        soft: 0,
        objection: 0,
        negative: 0,
        out_of_office: 0,
        auto_reply: 0,
        not_a_reply: 0,
        unreadCount,
        dateLabel,
      };
    }

    let hot = 0,
      soft = 0,
      objection = 0,
      negative = 0,
      out_of_office = 0,
      auto_reply = 0,
      not_a_reply = 0;

    for (const reply of toProcess) {
      try {
        const subject = reply.subject || '';
        const body = reply.body || '';

        const classification = await classifyWithPrefilter(openaiApiKey, subject, body);
        console.log(`   ${reply.from_email}: ${classification.category} (${classification.confidence})`);

        const bodySnippet = body.substring(0, 500);
        const threadId = reply.thread_id || `thread-${Date.now()}`;
        await db.query(
          `INSERT INTO replies 
           (from_email, subject, body_snippet, thread_id, reply_category, category_confidence, 
            reply_text, timestamp, fetched_at, classified_at, email_id, eaccount)
           VALUES ($1, $2, $3, $4, $5::reply_category, $6, $3, NOW(), NOW(), NOW(), $7, $8)
           ON CONFLICT (thread_id) DO UPDATE SET
             reply_category = EXCLUDED.reply_category,
             category_confidence = EXCLUDED.category_confidence,
             classified_at = EXCLUDED.classified_at,
             email_id = COALESCE(EXCLUDED.email_id, replies.email_id),
             eaccount = COALESCE(EXCLUDED.eaccount, replies.eaccount),
             updated_at = NOW()`,
          [
            reply.from_email,
            subject,
            bodySnippet,
            threadId,
            classification.category,
            classification.confidence,
            reply.email_id || null,
            reply.eaccount || null,
          ]
        );

        switch (classification.category) {
          case 'hot':
            hot++;
            await handleHotLead(db, apiKey, reply, openaiApiKey);
            break;
          case 'soft':
            soft++;
            break;
          case 'objection':
            objection++;
            break;
          case 'negative':
            negative++;
            await blacklistLead(db, reply.from_email);
            break;
          case 'out_of_office':
            out_of_office++;
            break;
          case 'auto_reply':
            auto_reply++;
            break;
          case 'not_a_reply':
            not_a_reply++;
            break;
        }
      } catch (error: unknown) {
        console.error(`   ❌ Error processing ${reply.from_email}: ${getErrorMessage(error)}`);
      }

      await sleep(RATE_LIMITS.INSTANTLY_DELAY_MS);
    }

    await updateServiceExecution(db, execId, {
      status: 'completed',
      completed_at: new Date(),
      output_count: toProcess.length,
    });

    console.log(`\n✅ Classification complete:`);
    console.log(
      `   Customer replies: Hot ${hot}, Soft ${soft}, Objection ${objection}, Negative ${negative}`
    );
    console.log(
      `   Not customer reply: Out of office ${out_of_office}, Auto-reply ${auto_reply}, Not a reply ${not_a_reply}\n`
    );

    return {
      processed: toProcess.length,
      hot,
      soft,
      objection,
      negative,
      out_of_office,
      auto_reply,
      not_a_reply,
      unreadCount,
      dateLabel,
    };
  } catch (error: unknown) {
    console.error(`\n❌ Fetch & classify failed: ${getErrorMessage(error)}\n`);
    await updateServiceExecution(db, execId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: getErrorMessage(error),
    });
    throw error;
  }
}
