/**
 * Bouncer API client
 *
 * Handles all HTTP interactions with Bouncer batch verification API.
 * See: https://docs.usebouncer.com/
 */

import { sleep } from '../../lib/utils.js';
import { RATE_LIMITS, API_ENDPOINTS, BOUNCER_RESULT } from '../../lib/constants.js';
import { BouncerApiError } from '../../lib/errors.js';

// ── Types ──────────────────────────────────────────────────────────

export interface BouncerResult {
  email: string;
  status: string;
  reason?: string;
}

export interface PartitionResult {
  ok: true;
  deliverableIds: string[];
  failedIds: string[];
  /** `bouncer_verified` + email_status risky */
  riskyIds: string[];
  /** `bouncer_verified` + email_status unknown (includes unrecognized Bouncer strings) */
  unknownIds: string[];
}

export interface PartitionError {
  ok: false;
  reason: string;
}

export type PartitionOutcome = PartitionResult | PartitionError;

// ── API Functions ──────────────────────────────────────────────────

export async function submitBatch(apiKey: string, emails: string[]): Promise<string> {
  const body = emails.map((email) => ({ email }));

  const response = await fetch(API_ENDPOINTS.BOUNCER.SUBMIT_BATCH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new BouncerApiError('submit', response.status, `${response.status} ${text}`);
  }

  const data = await response.json();

  if (!data.batchId) {
    throw new BouncerApiError('submit', null, 'Response missing batchId');
  }

  return data.batchId;
}

export async function getBatchStatus(apiKey: string, batchId: string): Promise<string> {
  const response = await fetch(API_ENDPOINTS.BOUNCER.GET_STATUS(batchId), {
    headers: { 'x-api-key': apiKey },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new BouncerApiError('poll', response.status, `${response.status} ${text}`);
  }

  const data = await response.json();
  return data.status || 'unknown';
}

export async function downloadResults(apiKey: string, batchId: string): Promise<BouncerResult[]> {
  const response = await fetch(API_ENDPOINTS.BOUNCER.DOWNLOAD(batchId), {
    headers: { 'x-api-key': apiKey },
  });

  if (response.status === 405) {
    throw new BouncerApiError('download', 405, 'Batch not completed yet');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new BouncerApiError('download', response.status, `${response.status} ${text}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function pollBatch(
  apiKey: string,
  batchId: string,
  maxWaitMs: number = RATE_LIMITS.BOUNCER_MAX_WAIT_MS,
  onStatus?: (status: string) => void
): Promise<BouncerResult[]> {
  const startTime = Date.now();
  const pollInterval = RATE_LIMITS.BOUNCER_POLL_INTERVAL_MS;

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getBatchStatus(apiKey, batchId);

    if (status === 'completed') {
      return downloadResults(apiKey, batchId);
    }

    if (status === 'failed') {
      throw new BouncerApiError('poll', null, 'Batch failed');
    }

    onStatus?.(status);
    await sleep(pollInterval);
  }

  throw new BouncerApiError('timeout', null, `Batch timed out after ${maxWaitMs / 1000}s`);
}

// ── Result Processing ──────────────────────────────────────────────

/**
 * Map Bouncer per-email results to DB updates.
 * - deliverable → bouncer_verified + email_status deliverable
 * - undeliverable → failed + undeliverable
 * - risky → bouncer_verified + email_status risky (not failed)
 * - unknown / anything else → bouncer_verified + email_status unknown
 * Only missing rows for submitted emails returns ok: false (response incomplete).
 */
export function partitionResults(
  results: BouncerResult[],
  batch: { id?: string; email?: string | null }[],
  emailsSent: string[]
): PartitionOutcome {
  const seen = new Set<string>();
  const deliverableIds: string[] = [];
  const failedIds: string[] = [];
  const riskyIds: string[] = [];
  const unknownIds: string[] = [];

  for (const result of results) {
    const email = typeof result?.email === 'string' ? result.email.trim() : '';
    if (!email) continue;
    seen.add(email);

    const status = String(result?.status ?? '').toLowerCase().trim();
    const lead = batch.find((l) => l.email === email);
    if (!lead?.id) continue;

    if (status === BOUNCER_RESULT.DELIVERABLE) {
      deliverableIds.push(lead.id);
    } else if (status === BOUNCER_RESULT.UNDELIVERABLE) {
      failedIds.push(lead.id);
    } else if (status === BOUNCER_RESULT.RISKY) {
      riskyIds.push(lead.id);
    } else if (status === BOUNCER_RESULT.UNKNOWN || status === '') {
      unknownIds.push(lead.id);
    } else {
      // Unrecognized Bouncer status string — store as unknown, still verified for pipeline
      unknownIds.push(lead.id);
    }
  }

  for (const e of emailsSent) {
    if (!seen.has(e)) {
      return { ok: false, reason: `Response missing result row for \`${e}\`` };
    }
  }

  return { ok: true, deliverableIds, failedIds, riskyIds, unknownIds };
}
