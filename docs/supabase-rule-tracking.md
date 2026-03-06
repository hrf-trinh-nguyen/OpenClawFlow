---
title: Supabase Rule Tracking – Guardrails & Fields
overview: Document database fields and skill logic added to support outbound guardrail rules (45-day cooldown, blacklist, bounce/negative rates).
version: 1.0.0
date: 2026-03-05
---

## 1. Goal

This document explains the **additional Supabase fields and logic** that were added on top of the initial Supabase integration to support outbound guardrail rules:

- **45-day cooldown** before re-sending to a lead
- **Blacklist** handling for negative / unsubscribe replies
- **Bounce rate** and **negative reply rate** tracking for campaign guardrails

It complements:

- `SUPABASE_SETUP.md` – how to create the project and run migrations
- `SUPABASE_IMPLEMENTATION.md` – initial schema + per-skill integration

## 2. New Migration – 002_rule_tracking_fields

**File:** `supabase/migrations/002_rule_tracking_fields.sql`

Purpose: add tracking fields that map directly to rules defined in:

- `workspace/rules/build-list-rules.md`
- `workspace/rules/campaign-rules.md`
- `workspace/rules/outbound-management.md`
- `workspace/rules/reply-classification.md`

### 2.1 Lead-level fields (`leads`)

**Rules covered**

- *"Never contact someone emailed in last 45 days"*  
- *"Negative replies (unsubscribe / hard no) should be blacklisted"*

**Schema (delta):**

```sql
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;
```

Existing field from `001_initial_schema` that the rules also depend on:

```sql
last_contacted_at TIMESTAMPTZ
```

**Meaning:**

- `last_contacted_at` – last time this lead was **scheduled/sent** from any Instantly campaign.
- `blacklisted` – when true, this lead should **never be emailed again** (e.g. negative / legal / spam reply).
- `blacklist_reason` – optional text or short code explaining why the lead was blacklisted (e.g. `negative_reply`, `legal_complaint`).

### 2.2 Campaign lead-level fields (`campaign_leads`)

**Rules covered**

- 45-day cooldown per lead  
- Per-campaign send tracking

**Schema (delta):**

```sql
ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS send_count INTEGER NOT NULL DEFAULT 0;
```

**Meaning:**

- `last_sent_at` – last time an email send was **initiated for this lead in this campaign**.
- `send_count` – number of times this lead has been scheduled/sent from this campaign.

These fields can be used in the future to implement **per-campaign** cooldowns or caps if desired.

### 2.3 Reporting fields (`daily_reports`)

**Rules covered**

From `campaign-rules.md`:

- *Bounce rate > 3% within 24h*  
- *Spam complaint > 0.1%*  
- *Negative reply rate > 5%* (and 10% rule in `outbound-management.md`)

**Schema (delta):**

```sql
ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS bounce_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS spam_complaint_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
```

Other existing metrics from `001_initial_schema`:

- `leads_pulled`, `leads_validated`, `leads_removed`
- `replies_fetched`, `hot_count`, `soft_count`, `objection_count`, `negative_count`
- `deliverable_rate`

**Meaning:**

- `bounce_rate` – approximate invalid/bounce rate (%) for that day.  
  Currently computed as: `leads_removed / (leads_validated + leads_removed)`.
- `spam_complaint_rate` – placeholder for future integration (defaults to `0` until spam complaint data is ingested).

## 3. TypeScript Model Updates

**File:** `workspace/lib/supabase.ts`

### 3.1 Interfaces

**Lead:**

```ts
export interface Lead {
  id: string;
  apollo_person_id?: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  title: string;
  linkedin_url?: string;
  email_status: EmailStatus;
  source: LeadSource;
  created_at: string;
  updated_at: string;
  last_contacted_at?: string;
  blacklisted?: boolean;
  blacklist_reason?: string;
}
```

**CampaignLead:**

```ts
export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  added_at: string;
  push_status: PushStatus;
  push_error?: string;
  last_sent_at?: string;
  send_count?: number;
}
```

**DailyReport:**

```ts
export interface DailyReport {
  id: string;
  report_date: string;
  workflow_run_id?: string;
  person_ids_count: number;
  leads_pulled: number;
  leads_validated: number;
  leads_removed: number;
  pushed_ok: number;
  pushed_failed: number;
  replies_fetched: number;
  hot_count: number;
  soft_count: number;
  objection_count: number;
  negative_count: number;
  deliverable_rate: number;
  bounce_rate: number;
  spam_complaint_rate: number;
  report_json: Record<string, any>;
  created_at: string;
}
```

## 4. Helper Methods (Supabase Client)

**4.1. `updateLeadsLastContacted`**

**File:** `workspace/lib/supabase.ts`

```ts
export async function updateLeadsLastContacted(
  client: SupabaseClient,
  leadIds: string[],
  contactedAt?: string
): Promise<void> {
  if (!leadIds.length) return;
  const ts = contactedAt || new Date().toISOString();
  const { error } = await client
    .from('leads')
    .update({ last_contacted_at: ts })
    .in('id', leadIds);

  if (error) throw new Error(`Failed to update last_contacted_at: ${error.message}`);
}
```

Used to keep `leads.last_contacted_at` in sync whenever a lead is successfully pushed into a campaign.

**4.2. `addLeadsToCampaign` (extended)**

```ts
export async function addLeadsToCampaign(
  client: SupabaseClient,
  campaignId: string,
  leadIds: string[],
  pushStatus: PushStatus = 'success',
  pushError?: string
): Promise<void> {
  const now = new Date().toISOString();
  const records = leadIds.map((leadId) => ({
    campaign_id: campaignId,
    lead_id: leadId,
    push_status: pushStatus,
    push_error: pushError,
    last_sent_at: pushStatus === 'success' ? now : null,
    send_count: pushStatus === 'success' ? 1 : 0,
  }));

  const { error } = await client
    .from('campaign_leads')
    .upsert(records, { onConflict: 'campaign_id,lead_id' });

  if (error) throw new Error(`Failed to add leads to campaign: ${error.message}`);
}
```

This gives per-campaign send tracking for each lead.

**4.3. `saveDailyReport` (extended metrics)**

```ts
export async function saveDailyReport(
  client: SupabaseClient,
  reportDate: string,
  workflowRunId: string | undefined,
  metrics: {
    person_ids_count: number;
    leads_pulled: number;
    leads_validated: number;
    leads_removed: number;
    pushed_ok: number;
    pushed_failed: number;
    replies_fetched: number;
    hot_count: number;
    soft_count: number;
    objection_count: number;
    negative_count: number;
    deliverable_rate: number;
    bounce_rate: number;
    spam_complaint_rate: number;
  },
  reportJson: Record<string, any>
): Promise<void> {
  const { error } = await client
    .from('daily_reports')
    .upsert(
      {
        report_date: reportDate,
        workflow_run_id: workflowRunId,
        ...metrics,
        report_json: reportJson,
      },
      { onConflict: 'report_date' }
    );

  if (error) throw new Error(`Failed to save daily report: ${error.message}`);
}
```

## 5. Skill-Level Logic Changes

### 5.1. `instantly-load` – update `last_contacted_at`

**File:** `workspace/skills/instantly-load/index.ts`

Key behavior:

- When Instantly accepts a lead (`pushed_ok`), we:
  - Upsert the relationship in `campaign_leads` (with `last_sent_at` and `send_count`).
  - Update `leads.last_contacted_at` via `updateLeadsLastContacted`.

Effect:

- `build-list` or future skills can enforce **"no send within 45 days"** using `last_contacted_at` (and `blacklisted`).

### 5.2. `report-build` – bounce & negative rates

**File:** `workspace/skills/report-build/index.ts`

New computed fields:

- `bounceRate` – `leads_removed / (leads_validated + leads_removed)` (as `%` string).
- `negativeRate` – `negativeCount / repliesFetched` (as `%` string).

These values are:

- Exposed in `state.daily_report` → Slack text.
- Persisted into `daily_reports` as:
  - `bounce_rate` (numeric)
  - `spam_complaint_rate` (currently `0`, placeholder)

This allows external dashboards or future skills to implement:

- Auto-pause when **bounce_rate > 3**.
- Auto-pause when **negativeRate > 5** (computed from `replies_fetched` + `negative_count`).

### 5.3. `llm-classify` – classification persistence

**File:** `workspace/skills/llm-classify/index.ts`

Behavior recap:

- Classifies replies into `hot | soft | objection | negative`.
- Increments per-category counters in state.
- Saves classifications into `reply_classifications` (unchanged), but now also:
  - Selects `lead_id` along with `id, thread_id, from_email` for future blacklist logic.

Current document does **not yet** turn negative replies into `leads.blacklisted=true`; the schema is prepared for this and can be wired later:

- Find `reply_classifications` where `category = 'negative'`.
- Join to `replies.lead_id`.
- Set `leads.blacklisted = true`, `blacklist_reason = 'negative_reply'`.

## 6. Query Examples

### 6.1. Check leads that are still inside 45-day cooldown

```sql
SELECT email, last_contacted_at
FROM leads
WHERE last_contacted_at IS NOT NULL
  AND last_contacted_at > NOW() - INTERVAL '45 days'
ORDER BY last_contacted_at DESC
LIMIT 50;
```

### 6.2. Find blacklisted leads and why

```sql
SELECT email, blacklist_reason, last_contacted_at
FROM leads
WHERE blacklisted = true
ORDER BY last_contacted_at DESC NULLS LAST;
```

### 6.3. Daily guardrail snapshot

```sql
SELECT
  report_date,
  leads_pulled,
  leads_validated,
  leads_removed,
  deliverable_rate,
  bounce_rate,
  spam_complaint_rate,
  replies_fetched,
  negative_count
FROM daily_reports
ORDER BY report_date DESC
LIMIT 14;
```

## 7. Summary

- **Schema:** `002_rule_tracking_fields.sql` adds the minimal set of fields needed to support **45-day cooldown**, **blacklist**, and **bounce/negative rate** rules.
- **Client:** `supabase.ts` types and helpers were extended to work with these fields.
- **Skills:** `instantly-load` and `report-build` now write these values as part of the normal workflows.
- **Future:** enabling full auto-blacklist and auto-pause behavior only requires small additional updates to `llm-classify` and a guardrail skill that reads `daily_reports`.

