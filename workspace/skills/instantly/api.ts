/**
 * Instantly API client
 *
 * Handles all HTTP interactions with Instantly email campaign API.
 */

import { sleep } from '../../lib/utils.js';
import { RATE_LIMITS, API_ENDPOINTS } from '../../lib/constants.js';
import { InstantlyApiError } from '../../lib/errors.js';

// ── Types ──────────────────────────────────────────────────────────

export interface AddLeadsResult {
  success: number;
  failed: number;
  successIds: string[];
}

export interface Reply {
  email_id: string;
  eaccount: string;
  from_email: string;
  body: string;
  subject: string;
  thread_id: string;
}

export interface Lead {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  title?: string | null;
}

// ── Add Leads API ──────────────────────────────────────────────────

export async function addLeads(
  apiKey: string,
  campaignId: string,
  leads: Lead[]
): Promise<AddLeadsResult> {
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
      campaign_id: campaignId,
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
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const uploaded = data.leads_uploaded ?? 0;
        const created: Array<{ index?: number; email?: string }> = data.created_leads ?? [];
        totalSuccess += uploaded;

        const seen = new Set<string>();
        for (const c of created) {
          let leadId: string | undefined;
          if (typeof c.index === 'number' && batch[c.index]?.id) {
            leadId = batch[c.index].id;
          } else if (c.email) {
            const match = batch.find(
              (l) => l.email && String(l.email).toLowerCase() === String(c.email).toLowerCase()
            );
            leadId = match?.id;
          }
          if (leadId && !seen.has(leadId)) {
            seen.add(leadId);
            successIds.push(leadId);
          }
        }

        const skipped = data.skipped_count ?? 0;
        const duped = data.duplicated_leads ?? 0;
        const invalid = data.invalid_email_count ?? 0;
        totalFailed += Math.max(0, batch.length - uploaded);

        if (successIds.length > 0 && successIds.length !== created.length) {
          console.log(
            `   ⚠️  Mapping: ${successIds.length} lead IDs from ${created.length} created_leads (deduped by id)`
          );
        }
        console.log(
          `   ✅ Batch ${batchNum}/${totalBatches}: ${uploaded} uploaded (${successIds.length} confirmed for DB), ${skipped} skipped, ${duped} duped, ${invalid} invalid`
        );
      } else {
        const msg = data.message || data.error || '';
        const err = new InstantlyApiError('add-leads', response.status, `${response.status} ${msg}`);
        err.withPartialSuccess(successIds);
        console.error(`   ❌ Batch ${batchNum}/${totalBatches} failed: ${response.status} ${msg}`);
        throw err;
      }
    } catch (error: unknown) {
      if (error instanceof InstantlyApiError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Batch ${batchNum}/${totalBatches} error: ${msg}`);
      const err = new InstantlyApiError('add-leads', null, msg);
      err.withPartialSuccess(successIds);
      throw err;
    }

    if (offset + batchSize < leads.length) {
      await sleep(RATE_LIMITS.INSTANTLY_DELAY_MS);
    }
  }

  return { success: totalSuccess, failed: totalFailed, successIds };
}

// ── Fetch Replies API ──────────────────────────────────────────────

export async function fetchReplies(
  apiKey: string,
  campaignId: string,
  dateRange: { min: string; max: string },
  limit: number = 100
): Promise<Reply[]> {
  const params = new URLSearchParams({
    campaign_id: campaignId,
    email_type: 'received',
    sort_order: 'asc',
    limit: String(limit),
    min_timestamp_created: dateRange.min,
    max_timestamp_created: dateRange.max,
  });

  const url = `${API_ENDPOINTS.INSTANTLY.EMAILS}?${params.toString()}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new InstantlyApiError('fetch', response.status, `${response.status}`);
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

// ── Unread Count API ───────────────────────────────────────────────

export async function getUnreadCount(apiKey: string, campaignId: string): Promise<number> {
  const url = API_ENDPOINTS.INSTANTLY.UNREAD_COUNT(campaignId);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new InstantlyApiError('unread-count', response.status, `${response.status}`);
  }

  const data = await response.json();
  return typeof data.count === 'number' ? data.count : (data.unread_count ?? 0);
}

// ── Reply API ──────────────────────────────────────────────────────

export async function replyToEmail(
  apiKey: string,
  params: {
    reply_to_uuid: string;
    eaccount: string;
    subject: string;
    body_html: string;
    body_text: string;
  }
): Promise<void> {
  const replyToUuid = String(params.reply_to_uuid ?? '').trim();
  const eaccount = String(params.eaccount ?? '').trim();
  const bodyHtml = String(params.body_html ?? '').trim();
  const bodyText = String(params.body_text ?? '').trim();
  const subject = String(params.subject ?? '').trim() || 'Re: Your inquiry';

  if (!replyToUuid || !eaccount) {
    throw new InstantlyApiError('reply', 400, 'Missing or empty reply_to_uuid or eaccount');
  }
  if (!bodyHtml || !bodyText) {
    throw new InstantlyApiError('reply', 400, 'Missing or empty body_html or body_text');
  }
  if (!String(apiKey ?? '').trim()) {
    throw new InstantlyApiError('reply', 401, 'Missing or empty API key');
  }

  const response = await fetch(API_ENDPOINTS.INSTANTLY.REPLY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      reply_to_uuid: replyToUuid,
      eaccount,
      subject,
      body: { html: bodyHtml, text: bodyText },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new InstantlyApiError('reply', response.status, `${response.status} ${text}`);
  }
}
