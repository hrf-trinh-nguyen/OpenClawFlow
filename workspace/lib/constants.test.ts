import { describe, it, expect } from 'vitest';
import {
  LEAD_STATUSES,
  isValidLeadStatus,
  REPLY_CATEGORIES,
  isValidReplyCategory,
  RATE_LIMITS,
  DEFAULTS,
  API_ENDPOINTS,
} from './constants.js';

describe('LEAD_STATUSES', () => {
  it('includes expected statuses', () => {
    expect(LEAD_STATUSES).toContain('new');
    expect(LEAD_STATUSES).toContain('apollo_matched');
    expect(LEAD_STATUSES).toContain('bouncer_verified');
    expect(LEAD_STATUSES).toContain('failed');
  });
});

describe('isValidLeadStatus', () => {
  it('returns true for valid statuses', () => {
    expect(isValidLeadStatus('new')).toBe(true);
    expect(isValidLeadStatus('bouncer_verified')).toBe(true);
    expect(isValidLeadStatus('failed')).toBe(true);
  });

  it('returns false for invalid', () => {
    expect(isValidLeadStatus('')).toBe(false);
    expect(isValidLeadStatus('unknown')).toBe(false);
    expect(isValidLeadStatus('Bouncer_Verified')).toBe(false);
  });
});

describe('REPLY_CATEGORIES', () => {
  it('includes all 7 categories (customer + non-customer)', () => {
    expect(REPLY_CATEGORIES).toContain('hot');
    expect(REPLY_CATEGORIES).toContain('soft');
    expect(REPLY_CATEGORIES).toContain('objection');
    expect(REPLY_CATEGORIES).toContain('negative');
    expect(REPLY_CATEGORIES).toContain('out_of_office');
    expect(REPLY_CATEGORIES).toContain('auto_reply');
    expect(REPLY_CATEGORIES).toContain('not_a_reply');
    expect(REPLY_CATEGORIES).toHaveLength(7);
  });
});

describe('isValidReplyCategory', () => {
  it('returns true for valid categories', () => {
    expect(isValidReplyCategory('hot')).toBe(true);
    expect(isValidReplyCategory('negative')).toBe(true);
    expect(isValidReplyCategory('out_of_office')).toBe(true);
    expect(isValidReplyCategory('auto_reply')).toBe(true);
    expect(isValidReplyCategory('not_a_reply')).toBe(true);
  });

  it('returns false for invalid', () => {
    expect(isValidReplyCategory('spam')).toBe(false);
    expect(isValidReplyCategory('')).toBe(false);
  });
});

describe('RATE_LIMITS', () => {
  it('has expected numeric limits', () => {
    expect(RATE_LIMITS.INSTANTLY_BULK_ADD_MAX).toBe(1000);
    expect(RATE_LIMITS.APOLLO_MATCH_BATCH_SIZE).toBe(10);
    expect(RATE_LIMITS.BOUNCER_BATCH_SIZE_MAX).toBe(1000);
  });
});

describe('DEFAULTS', () => {
  it('has expected defaults', () => {
    expect(DEFAULTS.TARGET_COUNT).toBe(5);
    expect(DEFAULTS.LOAD_LIMIT).toBe(100);
  });
});

describe('API_ENDPOINTS', () => {
  it('Apollo URLs are strings', () => {
    expect(API_ENDPOINTS.APOLLO.SEARCH).toContain('apollo.io');
    expect(API_ENDPOINTS.APOLLO.BULK_MATCH).toContain('bulk_match');
  });

  it('Bouncer GET_STATUS returns URL with batchId', () => {
    expect(API_ENDPOINTS.BOUNCER.GET_STATUS('abc')).toContain('abc');
  });

  it('Instantly UNREAD_COUNT includes campaign_id', () => {
    expect(API_ENDPOINTS.INSTANTLY.UNREAD_COUNT('id-1')).toContain('campaign_id=id-1');
  });
});
