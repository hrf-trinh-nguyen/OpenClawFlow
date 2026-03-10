-- Migration 007: Campaign daily analytics (multi-campaign support)
-- Purpose: Store Instantly API analytics per campaign per day; add campaign_id to daily_reports
-- Created: 2026-03-09

-- 1. Table: campaign_daily_analytics (Instantly API data per campaign per day)
CREATE TABLE IF NOT EXISTS campaign_daily_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  campaign_id TEXT NOT NULL,

  -- From GET /api/v2/campaigns/analytics/daily
  sent INTEGER NOT NULL DEFAULT 0,
  contacted INTEGER NOT NULL DEFAULT 0,
  new_leads_contacted INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  unique_opened INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  unique_replies INTEGER NOT NULL DEFAULT 0,
  replies_automatic INTEGER NOT NULL DEFAULT 0,
  unique_replies_automatic INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  unique_clicks INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(report_date, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_daily_analytics_date ON campaign_daily_analytics(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_daily_analytics_campaign ON campaign_daily_analytics(campaign_id);

COMMENT ON TABLE campaign_daily_analytics IS 'Instantly API daily analytics per campaign (sent, opens, replies)';

-- 2. Add campaign_id and Instantly columns to daily_reports (primary campaign snapshot)
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS opened INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS replies INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN daily_reports.campaign_id IS 'Primary campaign ID for Instantly data (sent, opened, replies)';
COMMENT ON COLUMN daily_reports.sent IS 'Emails sent (from Instantly API, primary campaign)';
COMMENT ON COLUMN daily_reports.opened IS 'Unique opens (from Instantly API, primary campaign)';
COMMENT ON COLUMN daily_reports.replies IS 'Unique replies (from Instantly API, primary campaign)';
