-- Migration 011: Store email_id and eaccount for reply-by-category skill
-- Purpose: Allow sending replies to leads by reply_category (e.g. hot, soft)
-- Instantly API requires reply_to_uuid (email_id) and eaccount to send a reply

ALTER TABLE replies ADD COLUMN IF NOT EXISTS email_id TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS eaccount TEXT;

CREATE INDEX IF NOT EXISTS idx_replies_email_id ON replies(email_id) WHERE email_id IS NOT NULL;

COMMENT ON COLUMN replies.email_id IS 'Instantly email UUID (reply_to_uuid) for sending reply';
COMMENT ON COLUMN replies.eaccount IS 'Instantly eaccount for sending reply';
