import { describe, it, expect } from 'vitest';
import {
  parseJsonSafe,
  checkRequiredEnv,
  truncate,
  normalizeEmail,
  clamp,
  parseIntSafe,
  getTodayDateString,
  getDateRange,
  dedupeByKey,
  dedupeByEmail,
  processBatches,
  withRetry,
  sleep,
} from './utils.js';

describe('parseJsonSafe', () => {
  it('returns parsed object for valid JSON', () => {
    expect(parseJsonSafe('{"a":1}', {})).toEqual({ a: 1 });
    expect(parseJsonSafe('[1,2]', [])).toEqual([1, 2]);
  });

  it('returns fallback for invalid JSON', () => {
    expect(parseJsonSafe('not json', { x: 1 })).toEqual({ x: 1 });
    expect(parseJsonSafe('', [])).toEqual([]);
  });
});

describe('checkRequiredEnv', () => {
  it('returns valid when all keys present', () => {
    expect(checkRequiredEnv(['PATH', 'USER'])).toEqual({ valid: true, missing: [] });
  });

  it('returns missing keys when some absent', () => {
    const result = checkRequiredEnv(['PATH', 'ENV_VAR_DOES_NOT_EXIST_XYZ', 'ANOTHER_MISSING']);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('ENV_VAR_DOES_NOT_EXIST_XYZ');
    expect(result.missing).toContain('ANOTHER_MISSING');
  });

  it('returns all missing when none set', () => {
    expect(checkRequiredEnv(['_MISSING_A_', '_MISSING_B_'])).toEqual({
      valid: false,
      missing: ['_MISSING_A_', '_MISSING_B_'],
    });
  });
});

describe('truncate', () => {
  it('returns string as-is when within maxLength', () => {
    expect(truncate('hi', 10)).toBe('hi');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates and appends ... when over maxLength', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('abcd', 3)).toBe('...');
    expect(truncate('a', 3)).toBe('a');
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Bar.COM  ')).toBe('foo@bar.com');
  });

  it('handles empty/falsy', () => {
    expect(normalizeEmail('')).toBe('');
    expect(normalizeEmail(undefined as unknown as string)).toBe('');
  });
});

describe('clamp', () => {
  it('clamps to min/max', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('parseIntSafe', () => {
  it('parses valid number strings', () => {
    expect(parseIntSafe('42', 0)).toBe(42);
    expect(parseIntSafe(' 99 ', 0)).toBe(99);
  });

  it('returns fallback for invalid or empty', () => {
    expect(parseIntSafe('', 7)).toBe(7);
    expect(parseIntSafe(undefined, 7)).toBe(7);
    expect(parseIntSafe('abc', 7)).toBe(7);
  });
});

describe('getTodayDateString', () => {
  it('returns ISO date string YYYY-MM-DD', () => {
    const s = getTodayDateString();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getDateRange', () => {
  it('uses fromEnv and toEnv when both provided', () => {
    const { min, max } = getDateRange('2026-01-01', '2026-01-03');
    expect(min).toContain('2026-01-01');
    expect(max).toContain('2026-01-04'); // exclusive end
  });

  it('uses singleEnv when provided', () => {
    const { min, max } = getDateRange(undefined, undefined, '2026-06-15');
    expect(min).toContain('2026-06-15');
    expect(max).toContain('2026-06-16');
  });

  it('returns today range when no env', () => {
    const { min, max } = getDateRange();
    expect(min).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(max).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('dedupeByKey', () => {
  it('removes duplicates by key', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
    expect(dedupeByKey(items, (x) => x.id)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('filters empty key', () => {
    const items = [{ id: 'a' }, { id: '' }, { id: 'a' }];
    expect(dedupeByKey(items, (x) => x.id)).toEqual([{ id: 'a' }]);
  });
});

describe('dedupeByEmail', () => {
  it('dedupes by normalized email', () => {
    const items = [
      { email: 'A@b.com' },
      { email: 'a@b.com' },
      { email: ' c@d.com ' },
    ];
    expect(dedupeByEmail(items)).toEqual([{ email: 'A@b.com' }, { email: ' c@d.com ' }]);
  });
});

describe('processBatches', () => {
  it('calls processor per batch and returns results', async () => {
    const results = await processBatches(
      [1, 2, 3, 4, 5],
      2,
      async (batch, batchIndex, totalBatches) => batchIndex + totalBatches
    );
    expect(results).toEqual([3, 4, 5]); // 3 batches: indices 0,1,2 + totalBatches 3
  });

  it('handles empty items', async () => {
    const results = await processBatches([], 5, async () => 'x');
    expect(results).toEqual([]);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(async () => 42);
    expect(result).toBe(42);
  });

  it('retries then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw new Error('fail');
      return 1;
    }, { maxAttempts: 3, delayMs: 1 });
    expect(result).toBe(1);
    expect(calls).toBe(2);
  });

  it('throws after maxAttempts', async () => {
    await expect(
      withRetry(async () => {
        throw new Error('nope');
      }, { maxAttempts: 2, delayMs: 1 })
    ).rejects.toThrow('nope');
  });
});

describe('sleep', () => {
  it('resolves after roughly given ms', async () => {
    const start = Date.now();
    await sleep(20);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(15);
  });
});
