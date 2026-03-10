#!/usr/bin/env node

/**
 * Instantly Service (Consolidated)
 * 
 * Combines: instantly-load + instantly-fetch + llm-classify
 * - Load: Push verified leads to Instantly campaign
 * - Fetch: Pull replies from Instantly inbox
 * - Classify: Use LLM to classify replies (hot/soft/objection/negative)
 * 
 * ENV variables:
 * - INSTANTLY_API_KEY: Instantly API key
 * - INSTANTLY_CAMPAIGN_ID: Campaign ID
 * - OPENAI_API_KEY: OpenAI API key (for classification)
 * - SUPABASE_DB_URL: PostgreSQL connection string
 * - MODE: 'load' | 'fetch' | 'classify' | 'all' (default: 'all')
 * - FETCH_DATE: Optional YYYY-MM-DD for single day (overrides default today)
 * - FETCH_DATE_FROM + FETCH_DATE_TO: Date range (YYYY-MM-DD) when user provides start/end
 * - When no date params: defaults to TODAY only (0h-24h local) to avoid pulling all replies
 *   Uses min_timestamp_created/max_timestamp_created per Instantly API v2
 */

import { getDb, createPipelineRun, updatePipelineRun, createServiceExecution, updateServiceExecution, getLeadsReadyForCampaign, batchUpdateLeadStatus } from '../../lib/supabase-pipeline.js';

// ── Configuration ──────────────────────────────────────────────────

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY;
const INSTANTLY_CAMPAIGN_ID = process.env.INSTANTLY_CAMPAIGN_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODE = process.env.MODE || 'all';

if (!INSTANTLY_API_KEY) {
  console.error('❌ INSTANTLY_API_KEY not found in env');
  process.exit(1);
}

if (!INSTANTLY_CAMPAIGN_ID) {
  console.error('❌ INSTANTLY_CAMPAIGN_ID not found in env');
  process.exit(1);
}

// ── Instantly API ──────────────────────────────────────────────────
// Bulk add: POST /api/v2/leads/add — max 1000 leads per request
// https://developer.instantly.ai/api/v2/lead/bulkaddleads

const INSTANTLY_BULK_ADD_MAX = 1000;

async function instantlyAddLeads(leads: any[]): Promise<{ success: number; failed: number; successIds: string[] }> {
  if (leads.length === 0) return { success: 0, failed: 0, successIds: [] };

  const url = 'https://api.instantly.ai/api/v2/leads/add';
  let totalSuccess = 0;
  let totalFailed = 0;
  const successIds: string[] = [];

  for (let offset = 0; offset < leads.length; offset += INSTANTLY_BULK_ADD_MAX) {
    const batch = leads.slice(offset, offset + INSTANTLY_BULK_ADD_MAX);
    const batchNum = Math.floor(offset / INSTANTLY_BULK_ADD_MAX) + 1;
    const totalBatches = Math.ceil(leads.length / INSTANTLY_BULK_ADD_MAX);

    const body = {
      campaign_id: INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,
      skip_if_in_campaign: true,
      leads: batch.map((l) => ({
        email: l.email,
        first_name: l.first_name || null,
        last_name: l.last_name || null,
        company_name: l.company_name || null,
        personalization: l.title || null
      }))
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${INSTANTLY_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const uploaded = data.leads_uploaded ?? 0;
        const created = data.created_leads ?? [];
        totalSuccess += uploaded;

        for (const c of created) {
          const idx = c.index;
          if (typeof idx === 'number' && batch[idx]?.id) {
            successIds.push(batch[idx].id);
          }
        }
        const skipped = data.skipped_count ?? 0;
        const duped = data.duplicated_leads ?? 0;
        const invalid = data.invalid_email_count ?? 0;
        totalFailed += Math.max(0, batch.length - uploaded);

        console.log(`   ✅ Batch ${batchNum}/${totalBatches}: ${uploaded} uploaded, ${skipped} skipped, ${duped} duped, ${invalid} invalid`);
      } else {
        totalFailed += batch.length;
        const msg = data.message || data.error || '';
        console.error(`   ❌ Batch ${batchNum}/${totalBatches} failed: ${response.status} ${msg}`);
      }
    } catch (error: any) {
      totalFailed += batch.length;
      console.error(`   ❌ Batch ${batchNum}/${totalBatches} error: ${error.message}`);
    }

    if (offset + INSTANTLY_BULK_ADD_MAX < leads.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { success: totalSuccess, failed: totalFailed, successIds };
}

/**
 * Compute date range for fetch. Always filters by date (never fetch all).
 * - No params: today 0h-24h (local)
 * - FETCH_DATE: single day
 * - FETCH_DATE_FROM + FETCH_DATE_TO: date range
 */
function getFetchDateRange(): { min: string; max: string } {
  const from = process.env.FETCH_DATE_FROM;
  const to = process.env.FETCH_DATE_TO;
  const single = process.env.FETCH_DATE || process.env.REPORT_DATE;

  if (from && to) {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    const minDate = new Date(Date.UTC(y1, (m1 || 1) - 1, d1 || 1));
    const maxDate = new Date(Date.UTC(y2, (m2 || 1) - 1, d2 || 1));
    maxDate.setUTCDate(maxDate.getUTCDate() + 1);
    return { min: minDate.toISOString(), max: maxDate.toISOString() };
  }

  if (single) {
    const [y, m, d] = single.split('-').map(Number);
    const dayStart = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    return { min: dayStart.toISOString(), max: dayEnd.toISOString() };
  }

  // Default: today 0h-24h (local timezone)
  const now = new Date();
  const localStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const localEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { min: localStart.toISOString(), max: localEnd.toISOString() };
}

/**
 * Fetch received emails from Instantly API v2.
 * GET /api/v2/emails — returns { items, next_starting_after }
 * Always filters by date (today by default) to avoid pulling all replies.
 * @see https://developer.instantly.ai/api/v2/email/def-2
 */
async function instantlyFetchReplies(limit: number = 100): Promise<any[]> {
  const params = new URLSearchParams({
    campaign_id: INSTANTLY_CAMPAIGN_ID || '',
    email_type: 'received',
    sort_order: 'asc',
    limit: String(limit)
  });

  const { min, max } = getFetchDateRange();
  params.set('min_timestamp_created', min);
  params.set('max_timestamp_created', max);

  const url = `https://api.instantly.ai/api/v2/emails?${params.toString()}`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${INSTANTLY_API_KEY}` }
  });

  if (!response.ok) {
    throw new Error(`Instantly fetch replies failed: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.items || data.emails || [];

  // API v2: id (reply_to_uuid), eaccount (account that sent original email to lead = our reply-from account).
  return raw.map((e: any) => ({
    email_id: e.id,
    eaccount: e.eaccount || process.env.INSTANTLY_EACCOUNT || '', // eaccount from GET /emails response
    from_email: e.from_address_email || e.lead || e.from_email,
    body: (e.body?.text || e.body?.html || '').trim(),
    subject: e.subject || '',
    thread_id: e.thread_id || e.id
  }));
}

async function instantlyGetUnreadCount(): Promise<number> {
  const url = `https://api.instantly.ai/api/v2/emails/unread/count?campaign_id=${INSTANTLY_CAMPAIGN_ID}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${INSTANTLY_API_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error(`Instantly unread count failed: ${response.status}`);
  }

  const data = await response.json();
  return typeof data.count === 'number' ? data.count : (data.unread_count ?? 0);
}

// ── Hot Reply Template (Design Pickle) ─────────────────────────────────────

const BOOK_NOW_URL = 'https://designpickle.com/design-pickle-consultation';
const COMPARE_URL = 'https://designpickle.com/comparison';

function buildHotReplyTemplate(firstName: string): { html: string; text: string } {
  const name = firstName || 'there';
  const html = `Awesome ${name},<br><br>You can schedule here: <a href="${BOOK_NOW_URL}">Book now</a><br><br>Have a look at this before we connect. Quickly covers us vs. alternatives.<br>👉 <a href="${COMPARE_URL}">Compare Design Pickle</a><br><br>See you then.<br>-Bryan Butvidas`;
  const text = `Awesome ${name},\n\nYou can schedule here: Book now\n${BOOK_NOW_URL}\n\nHave a look at this before we connect. Quickly covers us vs. alternatives.\n👉 Compare Design Pickle\n${COMPARE_URL}\n\nSee you then.\n-Bryan Butvidas`;
  return { html, text };
}

/**
 * Reply to an email via Instantly API v2.
 * @see https://developer.instantly.ai/api/v2/email/replytoemail
 * Uses reply_to_uuid (email id) and eaccount (sending account).
 */
async function instantlyReplyToEmail(params: {
  reply_to_uuid: string;
  eaccount: string;
  subject: string;
  body_html: string;
  body_text: string;
}): Promise<void> {
  const url = 'https://api.instantly.ai/api/v2/emails/reply';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INSTANTLY_API_KEY}`
    },
    body: JSON.stringify({
      reply_to_uuid: params.reply_to_uuid,
      eaccount: params.eaccount,
      subject: params.subject || 'Re: Your inquiry',
      body: { html: params.body_html, text: params.body_text }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Instantly reply failed: ${response.status} ${text}`);
  }
}

// ── LLM Classification ─────────────────────────────────────────────

async function classifyReply(replyText: string): Promise<{ category: string; confidence: number }> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not found');
  }

  const prompt = `Classify this outbound email reply into one of four categories:
- hot (ready to talk)
- soft (interested but timing issue)
- objection (decline with reason)
- negative (unsubscribe or hard no)

Reply: ${replyText}

Return JSON only: { "category": "...", "confidence": 0-1 }`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  try {
    const parsed = JSON.parse(content);
    return {
      category: parsed.category || 'objection',
      confidence: parsed.confidence || 0.0
    };
  } catch {
    return { category: 'objection', confidence: 0.0 };
  }
}

// ── Service Functions ──────────────────────────────────────────────

async function runLoadService(db: any, runId: string) {
  console.log(`\n📤 Load Service: Pushing verified leads to Instantly...\n`);

  const verifiedLeads = await getLeadsReadyForCampaign(db, 10000);

  if (verifiedLeads.length === 0) {
    console.log('ℹ️  No verified leads to load (bouncer_verified, not blacklisted, 45-day ok)\n');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  console.log(`📊 Found ${verifiedLeads.length} verified leads ready for campaign\n`);

  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: 'instantly',
    status: 'running',
    input_count: verifiedLeads.length
  });

  try {
    const { success, failed, successIds } = await instantlyAddLeads(verifiedLeads);

    // Update statuses and last_contacted_at (only for actual successes)
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
      failed_count: failed
    });

    console.log(`\\n✅ Load complete: ${success} loaded, ${failed} failed\\n`);

    return { processed: verifiedLeads.length, succeeded: success, failed };

  } catch (error: any) {
    console.error(`\\n❌ Load failed: ${error.message}\\n`);

    await updateServiceExecution(db, execId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error.message
    });

    throw error;
  }
}

async function runFetchAndClassifyService(db: any, runId: string) {
  const { min, max } = getFetchDateRange();
  const dateLabel = process.env.FETCH_DATE_FROM && process.env.FETCH_DATE_TO
    ? `${process.env.FETCH_DATE_FROM} → ${process.env.FETCH_DATE_TO}`
    : process.env.FETCH_DATE || process.env.REPORT_DATE || 'today';
  console.log(`\n📥 Fetch & Classify Service: Processing replies (${dateLabel}, ${min.slice(0, 10)} → ${max.slice(0, 10)})...\n`);

  try {
    const unread = await instantlyGetUnreadCount();
    console.log(`   📬 Unread count: ${unread}\n`);
  } catch {
    // Non-fatal
  }

  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: 'instantly',
    status: 'running'
  });

  try {
    const replies = await instantlyFetchReplies(100);

    if (replies.length === 0) {
      console.log(`ℹ️  No replies for ${dateLabel}\n`);
      await updateServiceExecution(db, execId, {
        status: 'completed',
        completed_at: new Date(),
        output_count: 0
      });
      return { processed: 0, hot: 0, soft: 0, objection: 0, negative: 0 };
    }

    console.log(`📊 Found ${replies.length} replies\n`);

    // Skip replies we've already auto-replied (avoid double reply)
    const threadIds = replies.map((r) => r.thread_id).filter(Boolean);
    const alreadyRepliedRes = threadIds.length > 0
      ? await db.query(
          `SELECT thread_id FROM replies WHERE thread_id = ANY($1::text[]) AND replied_at IS NOT NULL`,
          [threadIds]
        )
      : { rows: [] };
    const alreadyReplied = new Set(alreadyRepliedRes.rows.map((r) => r.thread_id));
    const toProcess = replies.filter((r) => !alreadyReplied.has(r.thread_id));

    if (alreadyReplied.size > 0) {
      console.log(`   ⏭️  Skipping ${alreadyReplied.size} already auto-replied\n`);
    }
    if (toProcess.length === 0) {
      console.log(`ℹ️  No new replies to process\n`);
      await updateServiceExecution(db, execId, { status: 'completed', completed_at: new Date(), output_count: 0 });
      return { processed: 0, hot: 0, soft: 0, objection: 0, negative: 0 };
    }

    let hot = 0, soft = 0, objection = 0, negative = 0;

    for (const reply of toProcess) {
      try {
        const classification = await classifyReply(reply.body || '');

        console.log(`   ${reply.from_email}: ${classification.category} (confidence: ${classification.confidence})`);

        // Save to DB (schema: 006_replies_instantly_schema)
        const bodySnippet = (reply.body || '').substring(0, 500);
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
            reply.subject || '',
            bodySnippet,
            reply.thread_id || `thread-${Date.now()}`,
            classification.category,
            classification.confidence
          ]
        );

        // Blacklist lead on negative reply (from_email = person who replied = our lead)
        if (classification.category === 'negative') {
          const leadRes = await db.query(
            `SELECT id FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
            [reply.from_email]
          );
          if (leadRes.rows.length > 0) {
            await db.query(
              `UPDATE leads SET blacklisted = true, blacklist_reason = 'negative_reply', updated_at = NOW() WHERE id = $1`,
              [leadRes.rows[0].id]
            );
            console.log(`   ⛔ Blacklisted lead: ${reply.from_email}`);
          }
        }

        // Send fixed template reply for hot leads (Design Pickle)
        if (classification.category === 'hot') {
          hot++;
          if (reply.email_id && reply.eaccount) {
            try {
              const leadRes = await db.query(
                `SELECT first_name FROM leads WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
                [reply.from_email]
              );
              const firstName = leadRes.rows[0]?.first_name?.trim() || '';
              const { html, text } = buildHotReplyTemplate(firstName);
              const subject = (reply.subject || '').startsWith('Re:') ? reply.subject : `Re: ${reply.subject || 'Your inquiry'}`;
              await instantlyReplyToEmail({
                reply_to_uuid: reply.email_id,
                eaccount: reply.eaccount,
                subject,
                body_html: html,
                body_text: text
              });
              await db.query(
                `UPDATE replies SET replied_at = NOW(), updated_at = NOW() WHERE thread_id = $1`,
                [reply.thread_id]
              );
              console.log(`   📤 Replied to hot lead: ${reply.from_email}`);
              await new Promise((r) => setTimeout(r, 300));
            } catch (err: any) {
              console.error(`   ❌ Reply failed for ${reply.from_email}: ${err.message}`);
            }
          } else {
            console.log(`   ⚠️  Skip reply (missing email_id/eaccount): ${reply.from_email}`);
          }
        } else if (classification.category === 'soft') soft++;
        else if (classification.category === 'objection') objection++;
        else negative++;

      } catch (error: any) {
        console.error(`   ❌ Error processing reply from ${reply.from_email}: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await updateServiceExecution(db, execId, {
      status: 'completed',
      completed_at: new Date(),
      output_count: toProcess.length
    });

    console.log(`\n✅ Classification complete:\n`);
    console.log(`   Hot: ${hot}`);
    console.log(`   Soft: ${soft}`);
    console.log(`   Objection: ${objection}`);
    console.log(`   Negative: ${negative}\\n`);

    return { processed: toProcess.length, hot, soft, objection, negative };

  } catch (error: any) {
    console.error(`\\n❌ Fetch & classify failed: ${error.message}\\n`);

    await updateServiceExecution(db, execId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error.message
    });

    throw error;
  }
}

// ── Main Service ───────────────────────────────────────────────────

async function main() {
  console.log(`\\n🚀 Instantly Service Starting (MODE: ${MODE})\\n`);

  const db = getDb();
  if (!db) {
    console.error('❌ Failed to connect to database');
    process.exit(1);
  }

  const runId = await createPipelineRun(db, {
    run_type: `instantly_${MODE}`,
    triggered_by: 'manual'
  });

  try {
    let totalProcessed = 0, totalSucceeded = 0, totalFailed = 0;

    if (MODE === 'load' || MODE === 'all') {
      const loadResult = await runLoadService(db, runId);
      totalProcessed += loadResult.processed;
      totalSucceeded += loadResult.succeeded;
      totalFailed += loadResult.failed;
    }

    if (MODE === 'fetch' || MODE === 'classify' || MODE === 'all') {
      const fetchResult = await runFetchAndClassifyService(db, runId);
      totalProcessed += fetchResult.processed;
      totalSucceeded += fetchResult.processed;
    }

    await updatePipelineRun(db, runId, {
      status: 'completed',
      completed_at: new Date(),
      leads_processed: totalProcessed,
      leads_succeeded: totalSucceeded,
      leads_failed: totalFailed
    });

    console.log(`✅ Instantly Service Complete\\n`);

  } catch (error: any) {
    console.error(`\\n❌ Instantly Service Failed: ${error.message}\\n`);

    await updatePipelineRun(db, runId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: error.message
    });

    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
