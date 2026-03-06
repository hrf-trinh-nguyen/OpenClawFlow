-- OpenClaw Outbound Automation Schema
-- Migration: 002_rule_tracking_fields
-- Purpose: Add tracking fields to support guardrail rules
-- Created: 2026-03-05

-- Leads: blacklist flags (never email again after negative/spam)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;

-- Campaign leads: basic send tracking (when a lead was last sent from this campaign)
ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0;

-- Daily reports: high-level quality metrics for guardrails
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS bounce_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS spam_complaint_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN leads.blacklisted IS 'True when lead should never be emailed again (e.g. negative/spam reply).';
COMMENT ON COLUMN leads.blacklist_reason IS 'Optional free-text or normalized code for why the lead was blacklisted.';
COMMENT ON COLUMN campaign_leads.last_sent_at IS 'Timestamp of the last email send initiated for this lead in this campaign.';
COMMENT ON COLUMN campaign_leads.send_count IS 'Number of times this lead has been scheduled/sent from this campaign.';
COMMENT ON COLUMN daily_reports.bounce_rate IS 'Estimated bounce/invalid rate (%) used for guardrails.';
COMMENT ON COLUMN daily_reports.spam_complaint_rate IS 'Estimated spam complaint rate (%) used for guardrails.';

