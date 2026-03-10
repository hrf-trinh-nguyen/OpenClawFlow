-- Migration 009: Track auto-replied threads (avoid double reply)
-- Purpose: Mark replies that have been auto-replied (hot template); skip them on next process-replies run

ALTER TABLE replies ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_replies_replied_at ON replies(replied_at) WHERE replied_at IS NOT NULL;

COMMENT ON COLUMN replies.replied_at IS 'When we sent auto-reply (hot template) for this thread; NULL = not replied yet';
