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
 */

import { getDb, createPipelineRun, updatePipelineRun, createServiceExecution, updateServiceExecution, getLeadsByStatus, batchUpdateLeadStatus } from '../../lib/supabase-pipeline.js';

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

async function instantlyAddLeads(leads: any[]): Promise<{ success: number; failed: number; successIds: string[] }> {
  if (leads.length === 0) return { success: 0, failed: 0, successIds: [] };

  const url = `https://api.instantly.ai/api/v2/leads/add`;

  let success = 0;
  let failed = 0;
  const successIds: string[] = [];

  for (const lead of leads) {
    const body = {
      campaign_id: INSTANTLY_CAMPAIGN_ID,
      skip_if_in_workspace: true,
      leads: [
        {
          email: lead.email,
          first_name: lead.first_name || null,
          last_name: lead.last_name || null,
          company_name: lead.company_name || null,
          personalization: lead.title || null
        }
      ]
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

      if (response.ok) {
        success++;
        if (lead.id) successIds.push(lead.id);
      } else {
        failed++;
        const text = await response.text().catch(() => '');
        const detail = text ? ` ${text.slice(0, 300)}` : '';
        console.error(`      ❌ Failed to add ${lead.email}: ${response.status}${detail}`);
      }
    } catch (error: any) {
      failed++;
      console.error(`      ❌ Error adding ${lead.email}: ${error.message}`);
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { success, failed, successIds };
}

async function instantlyFetchReplies(limit: number = 100): Promise<any[]> {
  const url = `https://api.instantly.ai/api/v2/emails?campaign_id=${INSTANTLY_CAMPAIGN_ID}&email_type=received&sort_order=asc&limit=${limit}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${INSTANTLY_API_KEY}`
    }
  });

  if (!response.ok) {
    throw new Error(`Instantly fetch replies failed: ${response.status}`);
  }

  const data = await response.json();
  return data.emails || [];
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

async function instantlyReplyToEmail(params: {
  campaign_id: string;
  email_id: string;
  body: string;
  subject?: string;
}): Promise<void> {
  const url = 'https://api.instantly.ai/api/v2/emails/reply';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INSTANTLY_API_KEY}`
    },
    body: JSON.stringify({
      campaign_id: params.campaign_id,
      email_id: params.email_id,
      body: params.body,
      ...(params.subject && { subject: params.subject })
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
  console.log(`\\n📤 Load Service: Pushing verified leads to Instantly...\\n`);

  const verifiedLeads = await getLeadsByStatus(db, 'bouncer_verified', 10000);

  if (verifiedLeads.length === 0) {
    console.log('ℹ️  No verified leads to load (status=bouncer_verified)\\n');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  console.log(`📊 Found ${verifiedLeads.length} verified leads\\n`);

  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: 'instantly',
    status: 'running',
    input_count: verifiedLeads.length
  });

  try {
    const { success, failed, successIds } = await instantlyAddLeads(verifiedLeads);

    // Update statuses (only for actual successes)
    if (successIds.length > 0) {
      await batchUpdateLeadStatus(db, successIds, 'instantly_loaded');
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
  console.log(`\\n📥 Fetch & Classify Service: Processing replies...\\n`);

  try {
    const unread = await instantlyGetUnreadCount();
    console.log(`   📬 Unread count: ${unread}\\n`);
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
      console.log('ℹ️  No new replies\\n');
      await updateServiceExecution(db, execId, {
        status: 'completed',
        completed_at: new Date(),
        output_count: 0
      });
      return { processed: 0, hot: 0, soft: 0, objection: 0, negative: 0 };
    }

    console.log(`📊 Found ${replies.length} replies\\n`);

    let hot = 0, soft = 0, objection = 0, negative = 0;

    for (const reply of replies) {
      try {
        const classification = await classifyReply(reply.body || '');

        console.log(`   ${reply.from_email}: ${classification.category} (confidence: ${classification.confidence})`);

        // Save to DB
        await db.query(
          `INSERT INTO replies 
           (from_email, subject, body_snippet, thread_id, reply_category, category_confidence, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (thread_id) DO UPDATE SET
             reply_category = EXCLUDED.reply_category,
             category_confidence = EXCLUDED.category_confidence,
             updated_at = NOW()`,
          [
            reply.from_email,
            reply.subject || '',
            (reply.body || '').substring(0, 500),
            reply.thread_id || `thread-${Date.now()}`,
            classification.category,
            classification.confidence
          ]
        );

        if (classification.category === 'hot') hot++;
        else if (classification.category === 'soft') soft++;
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
      output_count: replies.length
    });

    console.log(`\\n✅ Classification complete:\\n`);
    console.log(`   Hot: ${hot}`);
    console.log(`   Soft: ${soft}`);
    console.log(`   Objection: ${objection}`);
    console.log(`   Negative: ${negative}\\n`);

    return { processed: replies.length, hot, soft, objection, negative };

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
