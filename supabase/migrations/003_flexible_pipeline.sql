-- Migration 003: Flexible Pipeline Architecture
-- Adds status-driven processing, batch tracking, and pipeline orchestration

-- 1. Create lead_processing_status enum
CREATE TYPE lead_processing_status AS ENUM (
  'new',                  -- Initial state (not yet processed)
  'apollo_matched',       -- Apollo search + match complete
  'bouncer_verified',     -- Bouncer verification complete (deliverable)
  'instantly_loaded',     -- Loaded into Instantly campaign
  'replied',              -- Lead has replied to campaign
  'failed'                -- Processing failed (invalid email, API error, etc.)
);

-- 2. Add new columns to leads table
ALTER TABLE leads 
  ADD COLUMN IF NOT EXISTS processing_status lead_processing_status DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS batch_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- 3. Create indexes for efficient status-based queries
CREATE INDEX IF NOT EXISTS idx_leads_processing_status ON leads(processing_status);
CREATE INDEX IF NOT EXISTS idx_leads_batch_id ON leads(batch_id);
CREATE INDEX IF NOT EXISTS idx_leads_priority_status ON leads(priority DESC, processing_status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- 4. Create pipeline_runs table (tracks high-level pipeline executions)
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type VARCHAR(50) NOT NULL,           -- 'apollo_collection', 'bouncer_verify', 'instantly_load', 'full_pipeline'
  target_count INTEGER,                     -- Target number of leads (for apollo_collection)
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'running',     -- 'running', 'completed', 'failed', 'paused'
  
  -- Results
  leads_processed INTEGER DEFAULT 0,
  leads_succeeded INTEGER DEFAULT 0,
  leads_failed INTEGER DEFAULT 0,
  
  -- Metadata
  triggered_by VARCHAR(100),                -- 'user:slack', 'cron:daily', 'manual'
  icp_filters JSONB,                        -- ICP filters used (for apollo_collection)
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at);

-- 5. Create service_executions table (tracks individual service calls within a pipeline)
CREATE TABLE IF NOT EXISTS service_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  service_name VARCHAR(50) NOT NULL,        -- 'apollo', 'bouncer', 'instantly', 'llm-classify'
  
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'running',     -- 'running', 'completed', 'failed'
  
  -- Input/Output
  input_count INTEGER,                      -- Number of records processed
  output_count INTEGER,                     -- Number of successful results
  failed_count INTEGER DEFAULT 0,
  
  -- API details
  api_calls_made INTEGER DEFAULT 0,
  api_errors INTEGER DEFAULT 0,
  rate_limit_hits INTEGER DEFAULT 0,
  
  -- Metadata
  batch_size INTEGER,
  error_message TEXT,
  execution_metadata JSONB,                 -- Service-specific metadata
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_executions_pipeline_run ON service_executions(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_service_executions_service_name ON service_executions(service_name);
CREATE INDEX IF NOT EXISTS idx_service_executions_started_at ON service_executions(started_at);

-- 6. Update existing leads to have default processing_status
-- (Leads with email_status='deliverable' are assumed to be verified)
UPDATE leads 
SET processing_status = CASE 
  WHEN email_status = 'deliverable' THEN 'bouncer_verified'::lead_processing_status
  WHEN email IS NOT NULL AND email != '' THEN 'apollo_matched'::lead_processing_status
  ELSE 'new'::lead_processing_status
END
WHERE processing_status IS NULL;

-- 7. Create helper function: get leads by status
CREATE OR REPLACE FUNCTION get_leads_by_status(
  p_status lead_processing_status,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  email VARCHAR,
  first_name VARCHAR,
  last_name VARCHAR,
  company_name VARCHAR,
  title VARCHAR,
  linkedin_url VARCHAR,
  email_status VARCHAR,
  batch_id VARCHAR,
  priority INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.id,
    l.email,
    l.first_name,
    l.last_name,
    l.company_name,
    l.title,
    l.linkedin_url,
    l.email_status,
    l.batch_id,
    l.priority
  FROM leads l
  WHERE l.processing_status = p_status
  ORDER BY l.priority DESC, l.created_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 8. Create helper function: update lead status
CREATE OR REPLACE FUNCTION update_lead_status(
  p_lead_id UUID,
  p_new_status lead_processing_status,
  p_error_message TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE leads
  SET 
    processing_status = p_new_status,
    processing_error = p_error_message,
    updated_at = NOW()
  WHERE id = p_lead_id;
END;
$$ LANGUAGE plpgsql;

-- 9. Create helper function: batch update lead status
CREATE OR REPLACE FUNCTION batch_update_lead_status(
  p_lead_ids UUID[],
  p_new_status lead_processing_status,
  p_error_message TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE leads
  SET 
    processing_status = p_new_status,
    processing_error = p_error_message,
    updated_at = NOW()
  WHERE id = ANY(p_lead_ids);
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- 10. Create helper function: get pipeline stats
CREATE OR REPLACE FUNCTION get_pipeline_stats()
RETURNS TABLE (
  processing_status lead_processing_status,
  count BIGINT,
  oldest_created_at TIMESTAMP WITH TIME ZONE,
  newest_created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.processing_status,
    COUNT(*) as count,
    MIN(l.created_at) as oldest_created_at,
    MAX(l.created_at) as newest_created_at
  FROM leads l
  GROUP BY l.processing_status
  ORDER BY l.processing_status;
END;
$$ LANGUAGE plpgsql;

-- 11. Add comment to document the migration
COMMENT ON TABLE pipeline_runs IS 'Tracks high-level pipeline executions (e.g., "collect 500 leads from Apollo")';
COMMENT ON TABLE service_executions IS 'Tracks individual service calls within a pipeline run (e.g., Apollo search batch 1/5)';
COMMENT ON COLUMN leads.processing_status IS 'Current processing stage in the pipeline';
COMMENT ON COLUMN leads.batch_id IS 'Batch identifier for grouping related leads';
COMMENT ON COLUMN leads.priority IS 'Processing priority (higher = process first)';
