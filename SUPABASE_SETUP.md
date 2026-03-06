# Supabase Integration - Setup & Testing Guide

This guide covers the Supabase database integration for OpenClaw outbound automation.

## Overview

The Supabase integration provides:
- **Real-time persistence** of all workflow data (leads, replies, classifications)
- **Execution tracking** for workflows and skills
- **Historical analytics** with unlimited retention
- **Dashboard-ready data** via SQL queries

All database writes are **non-blocking** — skills succeed even if Supabase writes fail.

## Setup Steps

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the database to provision (~2 minutes)
3. Navigate to **Settings → API** and copy:
   - `Project URL` (e.g., `https://xyz.supabase.co`)
   - `anon` public API key

### 2. Run Migration

In your Supabase project:

1. Go to **SQL Editor**
2. Click **New Query**
3. Copy the contents of [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
4. Paste and click **Run**
5. Verify 10 tables were created: `campaigns`, `leads`, `campaign_leads`, `replies`, `reply_classifications`, `workflow_runs`, `skill_executions`, `apollo_searches`, `bouncer_verifications`, `daily_reports`

### 3. Configure Environment

Update [`/home/os/openclaw-mvp/.env`](/home/os/openclaw-mvp/.env):

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your-anon-key-here
```

**Note:** The `.env` file is already configured to pass these values to all skills via `openclaw.json`.

### 4. Restart OpenClaw Gateway

```bash
# Stop the current gateway (Ctrl+C in terminal)
# Then restart:
openclaw gateway
```

The gateway will reload the new environment variables.

## Testing

### Manual Test: Run Build-List Workflow

```bash
# In OpenClaw chat or Slack:
Run workflow: build-list
```

This will:
1. Create a `workflow_runs` entry (status: running)
2. Run `apollo-search` → creates `skill_executions` + `apollo_searches` entries
3. Run `apollo-match` → upserts `leads` table
4. Run `bouncer-verify` → updates `leads.email_status`, creates `bouncer_verifications` entry
5. Mark `workflow_runs` as completed

### Verify Data in Supabase

Go to **Supabase → Table Editor**:

**Check `workflow_runs`:**
```sql
SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT 5;
```

**Check `skill_executions`:**
```sql
SELECT 
  se.skill_name,
  se.status,
  se.duration_ms,
  se.output_data
FROM skill_executions se
WHERE workflow_run_id = (SELECT id FROM workflow_runs ORDER BY started_at DESC LIMIT 1)
ORDER BY se.started_at;
```

**Check `leads`:**
```sql
SELECT COUNT(*) as total_leads, email_status, COUNT(*) 
FROM leads 
GROUP BY email_status;
```

**Check `apollo_searches`:**
```sql
SELECT 
  person_ids_collected,
  pages_fetched,
  icp_filters,
  executed_at
FROM apollo_searches
ORDER BY executed_at DESC
LIMIT 1;
```

### Full Pipeline Test

Run all workflows in sequence:

```bash
# In OpenClaw:
Run workflow: build-list
# Wait for completion, then:
Run workflow: load-campaign
# Wait for completion, then (assuming you have replies):
Run workflow: process-replies
# Finally:
Run workflow: daily-report
```

Check that:
1. `campaign_leads` table has entries linking leads to your campaign
2. `replies` table has fetched emails (if any)
3. `reply_classifications` table has LLM classifications
4. `daily_reports` table has today's aggregated metrics

## Database Schema Reference

### Core Entities

- **`campaigns`** - Instantly campaign metadata
- **`leads`** - Master lead records (upserted by email)
- **`campaign_leads`** - Many-to-many junction (which leads in which campaigns)
- **`replies`** - Email replies from Instantly
- **`reply_classifications`** - LLM classifications (hot/soft/objection/negative)

### Execution Tracking

- **`workflow_runs`** - Each workflow execution (build_list, load_campaign, process_replies, daily_report)
- **`skill_executions`** - Individual skill runs within workflows

### Analytics

- **`apollo_searches`** - Apollo Search API logs (person IDs collected, filters used)
- **`bouncer_verifications`** - Bouncer batch verification logs (deliverable rates)
- **`daily_reports`** - Aggregated daily metrics (saved by `report-build` skill)

## Useful Queries

### Campaign Performance

```sql
SELECT 
  c.name,
  COUNT(DISTINCT cl.lead_id) as total_leads,
  COUNT(r.id) as reply_count,
  SUM(CASE WHEN rc.category = 'hot' THEN 1 ELSE 0 END) as hot_replies,
  SUM(CASE WHEN rc.category = 'soft' THEN 1 ELSE 0 END) as soft_replies
FROM campaigns c
LEFT JOIN campaign_leads cl ON c.id = cl.campaign_id
LEFT JOIN replies r ON c.id = r.campaign_id
LEFT JOIN reply_classifications rc ON r.id = rc.reply_id
WHERE c.instantly_campaign_id = 'YOUR_CAMPAIGN_ID'
GROUP BY c.id, c.name;
```

### Daily Trends (Last 30 Days)

```sql
SELECT 
  report_date,
  leads_validated,
  replies_fetched,
  hot_count,
  deliverable_rate
FROM daily_reports
WHERE report_date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY report_date DESC;
```

### Workflow Execution History (Last 7 Days)

```sql
SELECT 
  wr.workflow_name,
  wr.started_at,
  wr.completed_at,
  wr.status,
  ARRAY_AGG(se.skill_name ORDER BY se.started_at) as skills_run,
  SUM(se.duration_ms) as total_duration_ms
FROM workflow_runs wr
LEFT JOIN skill_executions se ON wr.id = se.workflow_run_id
WHERE wr.started_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY wr.id
ORDER BY wr.started_at DESC;
```

### Lead Quality Analysis

```sql
SELECT 
  email_status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM leads
GROUP BY email_status
ORDER BY count DESC;
```

### Reply Conversion Funnel

```sql
SELECT 
  rc.category,
  COUNT(*) as count,
  ROUND(AVG(rc.confidence), 2) as avg_confidence
FROM reply_classifications rc
JOIN replies r ON rc.reply_id = r.id
WHERE r.timestamp >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY rc.category
ORDER BY count DESC;
```

## Troubleshooting

### Supabase Writes Failing

Check logs in OpenClaw:
```
[Supabase] Warning: <error message>
```

Common issues:
1. **Invalid credentials** - Verify `SUPABASE_URL` and `SUPABASE_KEY` in `.env`
2. **Missing tables** - Re-run migration SQL script
3. **RLS policies** - Ensure RLS policies allow writes (migration script sets permissive policies)

### No Data in Tables

1. Verify environment variables are loaded:
   ```bash
   # Check that skills have Supabase env vars:
   cat ~/.openclaw/openclaw.json | grep -A 2 "apollo-search"
   ```

2. Check skill execution logs for `[Supabase]` messages

3. Verify Supabase client initialization doesn't fail (check for error logs)

### Duplicate Entries

The schema uses unique constraints to prevent duplicates:
- `leads.email` - unique
- `campaign_leads(campaign_id, lead_id)` - unique
- `replies(thread_id, timestamp)` - unique
- `reply_classifications.reply_id` - unique

Upserts will update existing records rather than create duplicates.

## Next Steps

1. **Build a dashboard** using Supabase's built-in data visualization or tools like Metabase, Retool, or custom React app
2. **Set up alerts** using Supabase Edge Functions to trigger notifications when metrics hit thresholds
3. **Export data** for analysis in tools like Google Sheets, Tableau, or Python notebooks
4. **Archive old data** by creating views or materialized views for historical analysis

## Notes

- All writes are wrapped in try-catch — skill execution continues even if Supabase fails
- `workflow_run_id` is stored in state and passed between skills for correlation
- Data retention is unlimited (as requested) — set up archival if needed later
- RLS policies are currently permissive (allow all) — restrict by user/role if multi-tenant later
