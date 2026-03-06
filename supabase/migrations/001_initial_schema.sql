-- OpenClaw Outbound Automation Schema
-- Migration: 001_initial_schema
-- Created: 2026-03-03

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE campaign_status AS ENUM ('active', 'paused', 'completed');
CREATE TYPE email_status AS ENUM ('deliverable', 'undeliverable', 'risky', 'unknown');
CREATE TYPE lead_source AS ENUM ('apollo', 'manual', 'import');
CREATE TYPE push_status AS ENUM ('pending', 'success', 'failed');
CREATE TYPE reply_category AS ENUM ('hot', 'soft', 'objection', 'negative');
CREATE TYPE workflow_name AS ENUM ('build_list', 'load_campaign', 'process_replies', 'daily_report');
CREATE TYPE execution_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE trigger_type AS ENUM ('cron', 'manual', 'api');

-- ============================================================================
-- CORE ENTITY TABLES
-- ============================================================================

-- Table: campaigns
CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instantly_campaign_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    status campaign_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_instantly_id ON campaigns(instantly_campaign_id);

-- Table: leads
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    apollo_person_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    title TEXT NOT NULL,
    linkedin_url TEXT,
    email_status email_status NOT NULL DEFAULT 'unknown',
    source lead_source NOT NULL DEFAULT 'apollo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_contacted_at TIMESTAMPTZ
);

CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_apollo_id ON leads(apollo_person_id);
CREATE INDEX idx_leads_email_status ON leads(email_status);
CREATE INDEX idx_leads_last_contacted ON leads(last_contacted_at DESC);

-- Table: campaign_leads (many-to-many)
CREATE TABLE campaign_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    push_status push_status NOT NULL DEFAULT 'pending',
    push_error TEXT,
    UNIQUE(campaign_id, lead_id)
);

CREATE INDEX idx_campaign_leads_campaign ON campaign_leads(campaign_id, added_at DESC);
CREATE INDEX idx_campaign_leads_lead ON campaign_leads(lead_id);
CREATE INDEX idx_campaign_leads_status ON campaign_leads(push_status);

-- Table: replies
CREATE TABLE replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    thread_id TEXT NOT NULL,
    from_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    reply_text TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(thread_id, timestamp)
);

CREATE INDEX idx_replies_campaign ON replies(campaign_id, timestamp DESC);
CREATE INDEX idx_replies_lead ON replies(lead_id);
CREATE INDEX idx_replies_thread ON replies(thread_id);
CREATE INDEX idx_replies_timestamp ON replies(timestamp DESC);

-- Table: reply_classifications
CREATE TABLE reply_classifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reply_id UUID UNIQUE NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
    category reply_category NOT NULL,
    confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    model TEXT NOT NULL
);

CREATE INDEX idx_reply_class_reply ON reply_classifications(reply_id);
CREATE INDEX idx_reply_class_category ON reply_classifications(category);

-- ============================================================================
-- WORKFLOW EXECUTION TRACKING
-- ============================================================================

-- Table: workflow_runs
CREATE TABLE workflow_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_name workflow_name NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    status execution_status NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    trigger trigger_type NOT NULL DEFAULT 'manual',
    error_message TEXT
);

CREATE INDEX idx_workflow_runs_name ON workflow_runs(workflow_name, started_at DESC);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_campaign ON workflow_runs(campaign_id);

-- Table: skill_executions
CREATE TABLE skill_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    status execution_status NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    duration_ms INTEGER
);

CREATE INDEX idx_skill_exec_workflow ON skill_executions(workflow_run_id, started_at);
CREATE INDEX idx_skill_exec_name ON skill_executions(skill_name);
CREATE INDEX idx_skill_exec_status ON skill_executions(status);

-- ============================================================================
-- METRICS & ANALYTICS
-- ============================================================================

-- Table: apollo_searches
CREATE TABLE apollo_searches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    skill_execution_id UUID NOT NULL REFERENCES skill_executions(id) ON DELETE CASCADE,
    workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    person_ids_collected INTEGER NOT NULL,
    pages_fetched INTEGER NOT NULL,
    icp_filters JSONB NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_apollo_search_exec ON apollo_searches(skill_execution_id);
CREATE INDEX idx_apollo_search_workflow ON apollo_searches(workflow_run_id);
CREATE INDEX idx_apollo_search_date ON apollo_searches(executed_at DESC);

-- Table: bouncer_verifications
CREATE TABLE bouncer_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    skill_execution_id UUID NOT NULL REFERENCES skill_executions(id) ON DELETE CASCADE,
    workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL,
    emails_submitted INTEGER NOT NULL,
    deliverable_count INTEGER NOT NULL,
    undeliverable_count INTEGER NOT NULL,
    deliverable_rate NUMERIC(5,2) NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bouncer_verif_exec ON bouncer_verifications(skill_execution_id);
CREATE INDEX idx_bouncer_verif_workflow ON bouncer_verifications(workflow_run_id);
CREATE INDEX idx_bouncer_verif_date ON bouncer_verifications(executed_at DESC);

-- Table: daily_reports
CREATE TABLE daily_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_date DATE UNIQUE NOT NULL,
    workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
    person_ids_count INTEGER NOT NULL DEFAULT 0,
    leads_pulled INTEGER NOT NULL DEFAULT 0,
    leads_validated INTEGER NOT NULL DEFAULT 0,
    leads_removed INTEGER NOT NULL DEFAULT 0,
    pushed_ok INTEGER NOT NULL DEFAULT 0,
    pushed_failed INTEGER NOT NULL DEFAULT 0,
    replies_fetched INTEGER NOT NULL DEFAULT 0,
    hot_count INTEGER NOT NULL DEFAULT 0,
    soft_count INTEGER NOT NULL DEFAULT 0,
    objection_count INTEGER NOT NULL DEFAULT 0,
    negative_count INTEGER NOT NULL DEFAULT 0,
    deliverable_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    report_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_reports_date ON daily_reports(report_date DESC);
CREATE INDEX idx_daily_reports_workflow ON daily_reports(workflow_run_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Function: update_updated_at_column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: get_campaign_metrics
CREATE OR REPLACE FUNCTION get_campaign_metrics(p_campaign_id UUID)
RETURNS TABLE (
    total_leads BIGINT,
    reply_count BIGINT,
    hot_replies BIGINT,
    soft_replies BIGINT,
    objection_replies BIGINT,
    negative_replies BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT cl.lead_id) as total_leads,
        COUNT(r.id) as reply_count,
        SUM(CASE WHEN rc.category = 'hot' THEN 1 ELSE 0 END) as hot_replies,
        SUM(CASE WHEN rc.category = 'soft' THEN 1 ELSE 0 END) as soft_replies,
        SUM(CASE WHEN rc.category = 'objection' THEN 1 ELSE 0 END) as objection_replies,
        SUM(CASE WHEN rc.category = 'negative' THEN 1 ELSE 0 END) as negative_replies
    FROM campaigns c
    LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
    LEFT JOIN replies r ON c.id = r.campaign_id
    LEFT JOIN reply_classifications rc ON r.id = rc.reply_id
    WHERE c.id = p_campaign_id
    GROUP BY c.id;
END;
$$ LANGUAGE plpgsql;

-- Function: get_recent_workflow_runs
CREATE OR REPLACE FUNCTION get_recent_workflow_runs(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
    workflow_run_id UUID,
    workflow_name workflow_name,
    started_at TIMESTAMPTZ,
    status execution_status,
    skills TEXT[],
    total_duration_ms BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wr.id as workflow_run_id,
        wr.workflow_name,
        wr.started_at,
        wr.status,
        ARRAY_AGG(se.skill_name ORDER BY se.started_at) as skills,
        SUM(se.duration_ms) as total_duration_ms
    FROM workflow_runs wr
    JOIN skill_executions se ON wr.id = se.workflow_run_id
    WHERE wr.started_at >= CURRENT_DATE - (p_days || ' days')::INTERVAL
    GROUP BY wr.id, wr.workflow_name, wr.started_at, wr.status
    ORDER BY wr.started_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE reply_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE apollo_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bouncer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

-- Create permissive policies (allow all for now, can be restricted later)
CREATE POLICY "Allow all operations on campaigns" ON campaigns FOR ALL USING (true);
CREATE POLICY "Allow all operations on leads" ON leads FOR ALL USING (true);
CREATE POLICY "Allow all operations on campaign_leads" ON campaign_leads FOR ALL USING (true);
CREATE POLICY "Allow all operations on replies" ON replies FOR ALL USING (true);
CREATE POLICY "Allow all operations on reply_classifications" ON reply_classifications FOR ALL USING (true);
CREATE POLICY "Allow all operations on workflow_runs" ON workflow_runs FOR ALL USING (true);
CREATE POLICY "Allow all operations on skill_executions" ON skill_executions FOR ALL USING (true);
CREATE POLICY "Allow all operations on apollo_searches" ON apollo_searches FOR ALL USING (true);
CREATE POLICY "Allow all operations on bouncer_verifications" ON bouncer_verifications FOR ALL USING (true);
CREATE POLICY "Allow all operations on daily_reports" ON daily_reports FOR ALL USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE campaigns IS 'Campaign metadata from Instantly';
COMMENT ON TABLE leads IS 'Master lead records from Apollo and other sources';
COMMENT ON TABLE campaign_leads IS 'Junction table linking leads to campaigns';
COMMENT ON TABLE replies IS 'Email replies received from Instantly inbox';
COMMENT ON TABLE reply_classifications IS 'LLM classification results for replies';
COMMENT ON TABLE workflow_runs IS 'Execution tracking for OpenClaw workflows';
COMMENT ON TABLE skill_executions IS 'Individual skill runs within workflows';
COMMENT ON TABLE apollo_searches IS 'Apollo Search API call logs';
COMMENT ON TABLE bouncer_verifications IS 'Bouncer batch email verification logs';
COMMENT ON TABLE daily_reports IS 'Aggregated daily pipeline metrics';
