-- Migration 004: Reporting from pipeline (skill + workflow snapshots)
-- Purpose: Link daily_reports to pipeline runs, enable monthly report queries
-- Created: 2026-03-06

-- Add pipeline_run_id to daily_reports (nullable; workflow_run_id kept for legacy)
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_daily_reports_pipeline ON daily_reports(pipeline_run_id);

COMMENT ON COLUMN daily_reports.pipeline_run_id IS 'Links to pipeline_runs when report is generated from pipeline flow';
