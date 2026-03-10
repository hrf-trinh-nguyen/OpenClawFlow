-- Migration 006: Align replies table with Instantly skill (process-replies)
-- Purpose: Fix schema mismatch so INSERT from Instantly fetch/classify works
-- Created: 2026-03-06

-- 1. Make campaign_id nullable (Instantly skill does not have campaign row; replies can exist without it)
ALTER TABLE replies ALTER COLUMN campaign_id DROP NOT NULL;

-- 2. Make reply_text and timestamp nullable (classification-first flow)
ALTER TABLE replies ALTER COLUMN reply_text DROP NOT NULL;
ALTER TABLE replies ALTER COLUMN timestamp DROP NOT NULL;

-- 3. Add columns for Instantly skill INSERT
ALTER TABLE replies ADD COLUMN IF NOT EXISTS body_snippet TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS reply_category reply_category;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS category_confidence NUMERIC(3,2);
ALTER TABLE replies ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Drop old unique constraint (thread_id, timestamp)
ALTER TABLE replies DROP CONSTRAINT IF EXISTS replies_thread_id_timestamp_key;

-- 5. Add UNIQUE(thread_id) for ON CONFLICT (thread_id) DO UPDATE
CREATE UNIQUE INDEX IF NOT EXISTS replies_thread_id_key ON replies (thread_id);

-- 6. Add index for report-build query on reply_category
CREATE INDEX IF NOT EXISTS idx_replies_reply_category ON replies(reply_category);
CREATE INDEX IF NOT EXISTS idx_replies_classified_at ON replies(classified_at);

COMMENT ON COLUMN replies.body_snippet IS 'First 500 chars of reply body (from Instantly fetch)';
COMMENT ON COLUMN replies.reply_category IS 'LLM classification: hot, soft, objection, negative';
COMMENT ON COLUMN replies.category_confidence IS 'Confidence 0-1 from LLM classification';
COMMENT ON COLUMN replies.classified_at IS 'When this reply was classified by LLM';
