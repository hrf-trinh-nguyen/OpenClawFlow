#!/usr/bin/env node

/**
 * Instantly Service (Consolidated)
 *
 * Modes:
 * - load:    Push verified leads to Instantly campaign
 * - fetch:   Pull replies from Instantly inbox, classify via LLM, auto-reply hot leads
 * - all:     Run both load + fetch
 *
 * ENV variables:
 * - INSTANTLY_API_KEY: Instantly API key (required)
 * - INSTANTLY_CAMPAIGN_ID: Campaign ID (required)
 * - OPENAI_API_KEY: OpenAI API key for reply classification (required for fetch mode)
 * - SUPABASE_DB_URL: PostgreSQL connection string (required)
 * - MODE: 'load' | 'fetch' | 'all' (default: 'all')
 * - LOAD_LIMIT: Max verified leads to load per run (default: 100)
 * - INSTANTLY_LOAD_DAILY_CAP: Max leads to push to Instantly per calendar day PT (default: 200)
 * - FETCH_DATE: Single day YYYY-MM-DD (optional, defaults to today)
 * - FETCH_DATE_FROM + FETCH_DATE_TO: Date range (optional)
 */

import {
  getDb,
  createPipelineRun,
  updatePipelineRun,
  createServiceExecution,
  updateServiceExecution,
  getLeadsReadyForCampaign,
  getInstantlyLoadedCountToday,
  batchUpdateLeadStatus,
} from '../../lib/supabase-pipeline.js';
import {
  sleep,
  parseJsonSafe,
  validateRequiredEnv,
  getDateRange,
  parseIntSafe,
} from '../../lib/utils.js';
import {
  RATE_LIMITS,
  DEFAULTS,
  API_ENDPOINTS,
  HOT_REPLY_TEMPLATE,
  PROMPTS,
  isValidReplyCategory,
  HOT_SIGNAL_PHRASES,
  CLASSIFICATION_MODEL,
  type ReplyCategory,
} from '../../lib/constants.js';
import {
  buildProcessRepliesMessage,
  postToReportChannel,
} from '../../lib/slack-templates.js';

// ── Configuration ──────────────────────────────────────────────────

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;
const INSTANTLY_CAMPAIGN_ID = process.env.INSTANTLY_CAMPAIGN_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODE = process.env.MODE || 'all';
const LOAD_LIMIT = parseIntSafe(process.env.LOAD_LIMIT, DEFAULTS.LOAD_LIMIT);
const LOAD_DAILY_CAP = parseIntSafe(
  process.env.INSTANTLY_LOAD_DAILY_CAP,
  DEFAULTS.INSTANTLY_LOAD_DAILY_CAP
);

// ── Validation ─────────────────────────────────────────────────────

function validateEnv(): void {
  validateRequiredEnv(['INSTANTLY_API_KEY', 'INSTANTLY_CAMPAIGN_ID', 'SUPABASE_DB_URL']);
  if ((MODE === 'fetch' || MODE === 'all') && !OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY required for fetch/classify mode');
    process.exit(1);
  }
}

// ── Date Range ─────────────────────────────────────────────────────

function getFetchDateRange(): { min: string; max: string } {
  return getDateRange(
    process.env.FETCH_DATE_FROM,
    process.env.FETCH_DATE_TO,
    process.env.FETCH_DATE || process.env.REPORT_DATE
  );
}

// ── Instantly API ──────────────────────────────────────────────────

interface AddLeadsResult {
  success: number;
  failed: number;
  successIds: string[];
}

async function instantlyAddLeads(leads: any[]): Promise<AddLeadsResult> {
  if (leads.length === 0) return { success: 0, failed: 0, successIds: [] };

  let totalSuccess = 0;
  let totalFailed = 0;
  const successIds: string[] = [];
  const batchSize = RATE_LIMITS.INSTANTLY_BULK_ADD_MAX;
  const totalBatches = Math.ceil(leads.length / batchSize);

  for (let offset = 0; offset < leads.length; offset += batchSize) {
    const batch = leads.slice(offset, offset + batchSize);
    const batchNum = Math.floor(offset / batchSize) + 1;

    const body = {
      campaign_id: INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      leads: batch.map((l) => ({
        email: l.email,
        first_name: l.first_name || null,
        last_name: l.last_name || null,
        company_name: l.company_name || null,
        personalization: l.title || null,
      })),
    };

    try {
      const response = await fetch(API_ENDPOINTS.INSTANTLY.ADD_LEADS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${INSTANTLY_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const uploaded = data.leads_uploaded ?? 0;
        const created = data.created_leads ?? [];
        totalSuccess += uploaded;

        for (const c of created) {
          if (typeof c.index === 'number' && batch[c.index]?.id) {
            successIds.push(batch[c.index].id);
          }
        }

        const skipped = data.skipped_count ?? 0;
        const duped = data.duplicated_leads ?? 0;
        const invalid = data.invalid_email_count ?? 0;
        totalFailed += Math.max(0, batch.length - uploaded);

        console.log(
          `   ✅ Batch ${batchNum}/${totalBatches}: ${uploaded} uploaded, ${skipped} skipped, ${duped} duped, ${invalid} invalid`
        );
      } else {
        totalFailed += batch.length;
        const msg = data.message || data.error || '';
        console.error(`   ❌ Batch ${batchNum}/${totalBatches} failed: ${response.status} ${msg}`);
      }
    } catch (error: any) {
      totalFailed += batch.length;
      console.error(`   ❌ Batch ${batchNum}/${totalBatches} error: ${error.message}`);
    }

    if (offset + batchSize < leads.length) {
      await sleep(RATE_LIMITS.INSTANTLY_DELAY_MS);
    }
  }

  return { success: totalSuccess, failed: totalFailed, successIds };
}

interface Reply {
  email_id: string;
  eaccount: string;
  from_email: string;
  body: string;
  subject: string;
  thread_id: string;
}

async function instantlyFetchReplies(limit: number = DEFAULTS.FETCH_LIMIT): Promise<Reply[]> {
  const params = new URLSearchParams({
    campaign_id: INSTANTLY_CAMPAIGN_ID || '',
    email_type: 'received',
    sort_order: 'asc',
    limit: String(limit),
  });

  const { min, max } = getFetchDateRange();
  params.set('min_timestamp_created', min);
  params.set('max_timestamp_created', max);

  const url = `${API_ENDPOINTS.INSTANTLY.EMAILS}?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${INSTANTLY_API_KEY}` },
  });

  if (!response.ok) {
    throw new Error(`Instantly fetch replies failed: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.items || data.emails || [];

  return raw.map((e: any) => ({
    email_id: e.id,
    eaccount: e.eaccount || process.env.INSTANTLY_EACCOUNT || '',
    from_email: e.from_address_email || e.lead || e.from_email,
    body: (e.body?.text || e.body?.html || '').trim(),
    subject: e.subject || '',
    thread_id: e.thread_id || e.id,
  }));
}

async function instantlyGetUnreadCount(): Promise<number> {
  const url = API_ENDPOINTS.INSTANTLY.UNREAD_COUNT(INSTANTLY_CAMPAIGN_ID || '');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${INSTANTLY_API_KEY}` },
  });

  if (!response.ok) {
    throw new Error(`Instantly unread count failed: ${response.status}`);
  }

  const data = await response.json();
  return typeof data.count === 'number' ? data.count : (data.unread_count ?? 0);
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

// ── Pre-filter: detect non-customer messages (skip LLM) ──────────────

const OOO_SUBJECT_PATTERNS = /out of office|ooo|automatic reply|abwesenheit|réponse automatique/i;
const OOO_BODY_PATTERNS = /out of (the )?office|away from (my )?office|I am currently out|I will be out|back on \d|returning on \d|limited access to (my )?email/i;
const AUTO_REPLY_PATTERNS = /automatic reply|auto.reply|vacation reply|I'm away|I am away|delivery receipt|read receipt|this is an automated/i;

/** If the message looks like OOO or auto-reply, return that category so we skip LLM and only store. */
function getNonReplyCategory(subject: string, body: string): 'out_of_office' | 'auto_reply' | null {
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

// ── LLM Classification (OpenAI) ────────────────────────────────────

interface Classification {
  category: ReplyCategory;
  confidence: number;
}

async function classifyReply(subject: string, replyText: string): Promise<Classification> {
  const prompt = PROMPTS.CLASSIFICATION.replace('{SUBJECT}', subject || '(no subject)')
    .replace('{REPLY_TEXT}', replyText || '(empty)');

  const response = await fetch(API_ENDPOINTS.OPENAI.CHAT_COMPLETIONS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CLASSIFICATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API failed: ${response.status}`);
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

  return {
    category,
    confidence,
  };
}

// ── Hot Reply Template ─────────────────────────────────────────────

function buildHotReplyTemplate(firstName: string): { html: string; text: string } {
  const name = firstName || 'there';
  const { BOOK_NOW_URL, COMPARE_URL } = HOT_REPLY_TEMPLATE;

  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${BOOK_NOW_URL}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>👉 <a href="${COMPARE_URL}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},\n\nYou can schedule here: Book now\n${BOOK_NOW_URL}\n\nHave a look at this before we connect. Quickly covers us vs. alternatives.\n👉 Compare Design Pickle\n${COMPARE_URL}\n\nSee you then.\n-Bryan Butvidas`;
  return { html, text };
}

// ── Load Service ───────────────────────────────────────────────────

interface LoadResult {
  processed: number;
  succeeded: number;
  failed: number;
}

async function runLoadService(db: any, runId: string): Promise<LoadResult> {
  console.log(`\n📤 Load Service: Pushing verified leads to Instantly...\n`);

  const loadedToday = await getInstantlyLoadedCountToday(db);
  const remainingDaily = Math.max(0, LOAD_DAILY_CAP - loadedToday);
  const limit = Math.min(LOAD_LIMIT, remainingDaily);

  if (limit === 0) {
    console.log(
      `ℹ️  Daily cap reached: ${loadedToday}/${LOAD_DAILY_CAP} loaded today. Skipping load.\n`
    );
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const verifiedLeads = await getLeadsReadyForCampaign(db, limit);

  if (verifiedLeads.length === 0) {
    console.log('ℹ️  No verified leads to load\n');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  console.log(
    `📊 Found ${verifiedLeads.length} verified leads (limit ${limit}, daily cap ${LOAD_DAILY_CAP}, already loaded today: ${loadedToday})\n`
  );

  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: 'instantly',
    status: 'running',
    input_count: verifiedLeads.length,
  });

  try {
    const { success, failed, successIds } = await instantlyAddLeads(verifiedLeads);

    if (successIds.length > 0) {
      await batchUpdateLeadStatus(db, successIds, 'instantly_loaded');
      await db.query(
        `UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [successIds]
      );
    }

    await updateServiceExecution(db, execId, {
      status: 'completed',
      completed_at: new Date(),
      output_count: success,
      failed_count: failed,
    });

    console.log(`\n✅ Load complete: ${success} loaded, ${failed} failed\n`);
    return { processed: verifiedLeads.length, succeeded: success, failed };
  } catch (error: any) {
    console.error(`\n❌ Load failed: ${error.message}\n`);
    await updateServiceExecution(db, execId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error.message,
    });
    throw error;
  }
}

// ── Fetch & Classify Service ───────────────────────────────────────

interface FetchResult {
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

async function runFetchAndClassifyService(db: any, runId: string): Promise<FetchResult> {
  const { min, max } = getFetchDateRange();
  const dateLabel =
    process.env.FETCH_DATE_FROM && process.env.FETCH_DATE_TO
      ? `${process.env.FETCH_DATE_FROM} → ${process.env.FETCH_DATE_TO}`
      : process.env.FETCH_DATE || process.env.REPORT_DATE || 'today';

  console.log(`\n📥 Fetch & Classify: Processing replies (${dateLabel})...\n`);

  let unreadCount: number | undefined;
  try {
    unreadCount = await instantlyGetUnreadCount();
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
    const replies = await instantlyFetchReplies(100);

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

        // Pre-filter: only classify real customer messages; tag OOO/auto without LLM
        const nonReply = getNonReplyCategory(subject, body);
        const classification: Classification = nonReply
          ? { category: nonReply, confidence: 1 }
          : await classifyReply(subject, body);

        console.log(`   ${reply.from_email}: ${classification.category} (${classification.confidence})`);

        const bodySnippet = body.substring(0, 500);
        await db.query(
          `INSERT INTO replies 
           (from_email, subject, body_snippet, thread_id, reply_category, category_confidence, 
            reply_text, timestamp, fetched_at, classified_at)
           VALUES ($1, $2, $3, $4, $5::reply_category, $6, $3, NOW(), NOW(), NOW())
           ON CONFLICT (thread_id) DO UPDATE SET
             reply_category = EXCLUDED.reply_category,
             category_confidence = EXCLUDED.category_confidence,
             classified_at = EXCLUDED.classified_at,
             updated_at = NOW()`,
          [
            reply.from_email,
            subject,
            bodySnippet,
            reply.thread_id || `thread-${Date.now()}`,
            classification.category,
            classification.confidence,
          ]
        );

        switch (classification.category) {
          case 'hot':
            hot++;
            await handleHotLead(db, reply);
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
      } catch (error: any) {
        console.error(`   ❌ Error processing ${reply.from_email}: ${error.message}`);
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
    console.log(`   Not customer reply: Out of office ${out_of_office}, Auto-reply ${auto_reply}, Not a reply ${not_a_reply}\n`);

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
  } catch (error: any) {
    console.error(`\n❌ Fetch & classify failed: ${error.message}\n`);
    await updateServiceExecution(db, execId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error.message,
    });
    throw error;
  }
}

async function handleHotLead(db: any, reply: Reply): Promise<void> {
  if (!reply.email_id || !reply.eaccount) {
    console.log(`   ⚠️  Skip reply (missing email_id/eaccount): ${reply.from_email}`);
    return;
  }

  try {
    const leadRes = await db.query(
      `SELECT first_name FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
      [reply.from_email]
    );
    const firstName = leadRes.rows[0]?.first_name?.trim() || '';
    const { html, text } = buildHotReplyTemplate(firstName);
    const subject = reply.subject?.startsWith('Re:') ? reply.subject : `Re: ${reply.subject || 'Your inquiry'}`;

    await instantlyReplyToEmail({
      reply_to_uuid: reply.email_id,
      eaccount: reply.eaccount,
      subject,
      body_html: html,
      body_text: text,
    });

    await db.query(`UPDATE replies SET replied_at = NOW(), updated_at = NOW() WHERE thread_id = $1`, [reply.thread_id]);
    console.log(`   📤 Replied to hot lead: ${reply.from_email}`);
    await sleep(300);
  } catch (err: any) {
    console.error(`   ❌ Reply failed for ${reply.from_email}: ${err.message}`);
  }
}

async function blacklistLead(db: any, email: string): Promise<void> {
  const leadRes = await db.query(`SELECT id FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`, [email]);

  if (leadRes.rows.length > 0) {
    await db.query(
      `UPDATE leads SET blacklisted = true, blacklist_reason = 'negative_reply', updated_at = NOW() WHERE id = $1`,
      [leadRes.rows[0].id]
    );
    console.log(`   ⛔ Blacklisted lead: ${email}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnv();

  console.log(`\n🚀 Instantly Service Starting (MODE: ${MODE})\n`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  const runId = await createPipelineRun(db, {
    run_type: `instantly_${MODE}`,
    triggered_by: 'manual',
  });

  try {
    let totalProcessed = 0,
      totalSucceeded = 0,
      totalFailed = 0;
    let fetchResult: FetchResult | null = null;

    if (MODE === 'load' || MODE === 'all') {
      const result = await runLoadService(db, runId);
      totalProcessed += result.processed;
      totalSucceeded += result.succeeded;
      totalFailed += result.failed;
    }

    if (MODE === 'fetch' || MODE === 'all') {
      const result = await runFetchAndClassifyService(db, runId);
      fetchResult = result;
      totalProcessed += result.processed;
      totalSucceeded += result.processed;
    }

    await updatePipelineRun(db, runId, {
      status: 'completed',
      completed_at: new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalSucceeded,
      leads_failed: totalFailed,
    });

    // Post Process Replies report to Slack (template, not AI message)
    if (fetchResult && process.env.SLACK_REPORT_CHANNEL) {
      const dateForReport =
        process.env.FETCH_DATE || process.env.REPORT_DATE || new Date().toISOString().split('T')[0];
      const msg = buildProcessRepliesMessage({
        date: dateForReport,
        unreadCount: fetchResult.unreadCount,
        repliesFetched: fetchResult.processed,
        hot: fetchResult.hot,
        soft: fetchResult.soft,
        objection: fetchResult.objection,
        negative: fetchResult.negative,
        outOfOffice: fetchResult.out_of_office,
        autoReply: fetchResult.auto_reply,
        notAReply: fetchResult.not_a_reply,
        autoReplied: fetchResult.hot,
      });
      await postToReportChannel(msg);
    }

    console.log(`✅ Instantly Service Complete\n`);
  } catch (error: any) {
    console.error(`\n❌ Instantly Service Failed: ${error.message}\n`);

    await updatePipelineRun(db, runId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error.message,
    });

    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
