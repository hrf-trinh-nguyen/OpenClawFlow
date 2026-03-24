/**
 * Instantly Load Service
 *
 * Pushes verified leads to Instantly campaign.
 */

import {
  createServiceExecution,
  updateServiceExecution,
  getLeadsReadyForCampaign,
  getInstantlyLoadedCountToday,
  batchUpdateLeadStatus,
} from '../../lib/supabase-pipeline.js';
import { DEFAULTS, LEAD_STATUS } from '../../lib/constants.js';
import { postToAlertChannel } from '../../lib/slack-templates.js';
import { isInstantlyApiError, getErrorMessage } from '../../lib/errors.js';
import { addLeads, type Lead } from './api.js';

// ── Types ──────────────────────────────────────────────────────────

export interface LoadResult {
  processed: number;
  succeeded: number;
  failed: number;
}

// ── Load Service ───────────────────────────────────────────────────

export async function runLoadService(
  db: any,
  runId: string,
  apiKey: string,
  campaignId: string
): Promise<LoadResult> {
  console.log(`\n📤 Load Service: Pushing verified leads to Instantly...\n`);

  const loadedToday = await getInstantlyLoadedCountToday(db);
  const remainingDaily = Math.max(0, DEFAULTS.INSTANTLY_LOAD_DAILY_CAP - loadedToday);
  const limit = Math.min(DEFAULTS.LOAD_LIMIT, remainingDaily);

  if (limit === 0) {
    console.log(
      `ℹ️  Daily cap reached: ${loadedToday}/${DEFAULTS.INSTANTLY_LOAD_DAILY_CAP} loaded today. Skipping load.\n`
    );
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const verifiedLeads = await getLeadsReadyForCampaign(db, limit);

  if (verifiedLeads.length === 0) {
    console.log('ℹ️  No verified leads to load\n');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  console.log(
    `📊 Found ${verifiedLeads.length} verified leads (limit ${limit}, daily cap ${DEFAULTS.INSTANTLY_LOAD_DAILY_CAP}, already loaded today: ${loadedToday})\n`
  );

  const execId = await createServiceExecution(db, {
    pipeline_run_id: runId,
    service_name: 'instantly',
    status: 'running',
    input_count: verifiedLeads.length,
  });

  try {
    const { success, failed, successIds } = await addLeads(apiKey, campaignId, verifiedLeads as Lead[]);

    if (successIds.length > 0) {
      await batchUpdateLeadStatus(db, successIds, LEAD_STATUS.INSTANTLY_LOADED);
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
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    const partialIds = isInstantlyApiError(error) ? error.partialSuccessIds : [];

    if (partialIds.length > 0) {
      await batchUpdateLeadStatus(db, partialIds, LEAD_STATUS.INSTANTLY_LOADED);
      await db.query(
        `UPDATE leads SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [partialIds]
      );
    }

    console.error(`\n❌ Load failed: ${msg}\n`);
    await postToAlertChannel(
      [
        `🚨 *Instantly load failed* (API error)`,
        `\`${msg}\``,
        partialIds.length > 0
          ? `_Partial success: ${partialIds.length} lead(s) were updated in the DB before the failure._`
          : `_Check INSTANTLY_API_KEY, INSTANTLY_CAMPAIGN_ID, and Instantly API status._`,
      ].join('\n')
    ).catch(() => {});

    await updateServiceExecution(db, execId, {
      status: 'failed',
      completed_at: new Date(),
      output_count: partialIds.length,
      failed_count: verifiedLeads.length - partialIds.length,
      error_message: msg,
    });

    throw error;
  }
}
