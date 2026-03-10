-- Migration 008: Drop legacy tables no longer used by pipeline
-- Purpose: Remove workflow_runs, skill_executions, campaigns, campaign_leads,
--          apollo_searches, bouncer_verifications. Current flow uses pipeline_runs,
--          service_executions, daily_reports, campaign_daily_analytics.
-- Created: 2026-03-06

-- 1. Drop helper functions that depend on dropped tables
DROP FUNCTION IF EXISTS get_campaign_metrics(UUID);
DROP FUNCTION IF EXISTS get_recent_workflow_runs(INTEGER);

-- 2. Unlink daily_reports from workflow_runs (we use pipeline_run_id now)
ALTER TABLE daily_reports DROP CONSTRAINT IF EXISTS daily_reports_workflow_run_id_fkey;
ALTER TABLE daily_reports DROP COLUMN IF EXISTS workflow_run_id;
DROP INDEX IF EXISTS idx_daily_reports_workflow;

-- 3. Unlink replies from campaigns (campaign_id stays nullable; Instantly uses thread_id)
ALTER TABLE replies DROP CONSTRAINT IF EXISTS replies_campaign_id_fkey;

-- 4. Drop tables (children first)
DROP TABLE IF EXISTS apollo_searches CASCADE;
DROP TABLE IF EXISTS bouncer_verifications CASCADE;
DROP TABLE IF EXISTS skill_executions CASCADE;
DROP TABLE IF EXISTS campaign_leads CASCADE;
DROP TABLE IF EXISTS workflow_runs CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;

COMMENT ON COLUMN daily_reports.pipeline_run_id IS 'Links to pipeline_runs (legacy workflow_run_id removed in 008)';
