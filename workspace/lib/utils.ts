/**
 * Shared utilities for OpenClaw skills
 */

// ── Async Utilities ─────────────────────────────────────────────────

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── JSON Utilities ──────────────────────────────────────────────────

export function parseJsonSafe<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ── Environment Validation ──────────────────────────────────────────

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
}

export function checkRequiredEnv(keys: string[]): EnvValidationResult {
  const missing = keys.filter((key) => !process.env[key]);
  return { valid: missing.length === 0, missing };
}

export function validateRequiredEnv(keys: string[]): void {
  const { valid, missing } = checkRequiredEnv(keys);
  if (!valid) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ── String Utilities ────────────────────────────────────────────────

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

// ── Number Utilities ────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parseIntSafe(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

// ── Date Utilities ──────────────────────────────────────────────────

const REPORT_TIMEZONE = 'America/New_York';

/** Today's date in US Eastern (America/New_York, EST/EDT), YYYY-MM-DD. Reports, daily caps, Instantly date param, etc. */
export function getTodayDateString(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export function getDateRange(
  fromEnv?: string,
  toEnv?: string,
  singleEnv?: string
): { min: string; max: string } {
  if (fromEnv && toEnv) {
    const [y1, m1, d1] = fromEnv.split('-').map(Number);
    const [y2, m2, d2] = toEnv.split('-').map(Number);
    const minDate = new Date(Date.UTC(y1, (m1 || 1) - 1, d1 || 1));
    const maxDate = new Date(Date.UTC(y2, (m2 || 1) - 1, d2 || 1));
    maxDate.setUTCDate(maxDate.getUTCDate() + 1);
    return { min: minDate.toISOString(), max: maxDate.toISOString() };
  }

  if (singleEnv) {
    const [y, m, d] = singleEnv.split('-').map(Number);
    const dayStart = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    return { min: dayStart.toISOString(), max: dayEnd.toISOString() };
  }

  // Default: today in Eastern (see REPORT_TIMEZONE); local Date boundaries follow process TZ when set
  const todayEastern = getTodayDateString();
  const [y, m, d] = todayEastern.split('-').map(Number);
  const localStart = new Date(y, (m || 1) - 1, d || 1);
  const localEnd = new Date(y, (m || 1) - 1, (d || 1) + 1);
  return { min: localStart.toISOString(), max: localEnd.toISOString() };
}

// ── Retry Utilities ─────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
    shouldRetry = () => true,
  } = options;

  let lastError: Error | null = null;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts || !shouldRetry(lastError)) {
        throw lastError;
      }

      console.log(`   ⏳ Attempt ${attempt}/${maxAttempts} failed, retrying in ${currentDelay}ms...`);
      await sleep(currentDelay);
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

// ── Batch Processing ────────────────────────────────────────────────

export async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[], batchIndex: number, totalBatches: number) => Promise<R>,
  options: { delayBetweenBatches?: number } = {}
): Promise<R[]> {
  const { delayBetweenBatches = 0 } = options;
  const results: R[] = [];
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize);

    const result = await processor(batch, batchIndex, totalBatches);
    results.push(result);

    if (delayBetweenBatches > 0 && i + batchSize < items.length) {
      await sleep(delayBetweenBatches);
    }
  }

  return results;
}

// ── Deduplication ───────────────────────────────────────────────────

export function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupeByEmail<T extends { email?: string }>(items: T[]): T[] {
  return dedupeByKey(items, (item) => normalizeEmail(item.email || ''));
}
