-- Migration 010: Extend reply_category to distinguish non-customer messages
-- Purpose: hot/soft/objection/negative = real customer reply only;
--          out_of_office, auto_reply, not_a_reply = not a genuine message from the lead.
-- Created: 2026-03

ALTER TYPE reply_category ADD VALUE IF NOT EXISTS 'out_of_office';
ALTER TYPE reply_category ADD VALUE IF NOT EXISTS 'auto_reply';
ALTER TYPE reply_category ADD VALUE IF NOT EXISTS 'not_a_reply';

COMMENT ON TYPE reply_category IS 'hot/soft/objection/negative = real customer reply; out_of_office/auto_reply/not_a_reply = not a genuine reply';
