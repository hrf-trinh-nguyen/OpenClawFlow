# Flexible Pipeline Execution Guide

**For the agent:** This document explains how to interpret user prompts and execute pipeline services with dynamic parameters.

---

## Core Concept

Users can describe their intent in **natural language** (Vietnamese, English, or any language). You parse the intent and execute the appropriate service with extracted parameters.

**Key principle:** Services are **database-driven** and **autonomous**. They pull data from the `leads` table based on `processing_status`, so they don't depend on previous steps completing first.

---

## Service Overview

| Service | Purpose | Reads from DB (status) | Writes to DB (status) |
|---------|---------|------------------------|----------------------|
| **apollo** | Collect leads from Apollo Search + Match | — | `apollo_matched` |
| **bouncer** | Verify emails via Bouncer batch API | `apollo_matched` | `bouncer_verified` (or `failed`) |
| **instantly** | Load leads into Instantly campaign | `bouncer_verified` | `instantly_loaded` |
| **report** | Aggregate metrics and send to Slack | (all statuses) | — |

---

## Prompt Patterns & Parameter Extraction

### Pattern 1: Collect leads from Apollo

**User prompts (examples):**
- "lấy 500 leads từ Apollo"
- "get 500 new contacts from Apollo"
- "tôi muốn 1000 người liên lạc mới hôm nay"
- "pull 200 founders from Apollo in Vietnam"
- "collect 50 B2B SaaS CEOs"

**What you do:**
1. **Extract parameters:**
   - `targetCount`: number (500, 1000, 200, 50)
   - `icpFilters`: object (titles, locations, industries) — infer from prompt or use defaults
   
2. **Run apollo service:**
   ```bash
   cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" \
   TARGET_COUNT=500 \
   PERSON_TITLES='["founder","ceo"]' \
   PERSON_LOCATIONS='["Vietnam"]' \
   node workspace/skills/apollo/index.mjs
   ```

3. **Progress tracking:**
   - Apollo service will:
     - Search person IDs page-by-page (100/page)
     - Bulk match immediately (10 IDs/batch)
     - Upsert to DB with `processing_status='apollo_matched'`
     - Stop when `targetCount` reached
   - You monitor DB: `SELECT COUNT(*) FROM leads WHERE processing_status='apollo_matched' AND created_at > NOW() - INTERVAL '1 hour'`

4. **Reply to user:**
   ```
   ✅ Apollo collection started (target: 500 leads)
   → Progress: 127/500 leads matched (25% complete)
   → Estimated time: ~8 minutes remaining
   
   I'll notify you when complete. Meanwhile, these leads are being written to the database with status='apollo_matched'.
   ```

---

### Pattern 2: Verify emails (Bouncer)

**User prompts:**
- "verify tất cả emails đang chờ"
- "verify all pending leads"
- "chạy Bouncer cho leads mới"
- "check email deliverability"

**What you do:**
1. **Check DB for pending leads:**
   ```sql
   SELECT COUNT(*) FROM leads WHERE processing_status = 'apollo_matched';
   ```

2. **If count > 0, run bouncer service:**
   ```bash
   cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" \
   node workspace/skills/bouncer/index.mjs
   ```

3. **Service behavior:**
   - Bouncer pulls 100 leads at a time (Bouncer API batch limit)
   - Submits to Bouncer batch verify API
   - Polls until batch completes (~1-2 min)
   - Updates DB: deliverable → `bouncer_verified`, others → `failed`
   - Repeats until no more `apollo_matched` leads

4. **Reply to user:**
   ```
   ✅ Found 487 leads pending verification
   ✅ Bouncer batch 1/5 (100 leads) → 94 deliverable, 6 invalid
   ✅ Bouncer batch 2/5 (100 leads) → 96 deliverable, 4 invalid
   ...
   ✅ Complete: 462/487 verified (94.9% deliverable rate)
   
   Verified leads now have status='bouncer_verified' and are ready to load into Instantly.
   ```

---

### Pattern 3: Load campaign (Instantly)

**User prompts:**
- "load tất cả leads đã verify vào Instantly"
- "push verified leads to campaign"
- "add leads to Instantly"

**What you do:**
1. **Check DB:**
   ```sql
   SELECT COUNT(*) FROM leads WHERE processing_status = 'bouncer_verified';
   ```

2. **Run instantly service:**
   ```bash
   cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" \
   node workspace/skills/instantly/index.mjs
   ```

3. **Reply:**
   ```
   ✅ Found 462 verified leads
   ✅ Pushed to Instantly campaign: 458 success, 4 failed
   
   Leads now have status='instantly_loaded'. Instantly will send emails during 9AM-5PM window.
   ```

---

### Pattern 4: Run full pipeline

**User prompts:**
- "chạy full workflow: 500 leads"
- "run complete pipeline with 300 new contacts"
- "execute end-to-end from Apollo to Instantly"

**What you do:**
1. **Run services in sequence:**
   ```bash
   # Step 1: Apollo (500 leads)
   TARGET_COUNT=500 node workspace/skills/apollo/index.mjs
   
   # Step 2: Bouncer (all apollo_matched leads)
   node workspace/skills/bouncer/index.mjs
   
   # Step 3: Instantly (all bouncer_verified leads)
   node workspace/skills/instantly/index.mjs
   ```

2. **Reply with full summary:**
   ```
   ✅ Full pipeline completed:
   
   1️⃣ Apollo: 502 leads matched (target: 500)
   2️⃣ Bouncer: 476/502 verified (94.8% deliverable)
   3️⃣ Instantly: 472/476 loaded (4 skipped - duplicates)
   
   📊 Final result: 472 new leads in campaign, ready to send.
   ```

---

### Pattern 5: View report by date

**User prompts:**
- "xem report ngày 06/03/2026"
- "report ngày 6 tháng 3"
- "báo cáo 6/3/2026"
- "show report for March 6, 2026"

**What you do:**
1. **Parse date** → convert to `YYYY-MM-DD`:
   - `06/03/2026` (DD/MM/YYYY) → `2026-03-06`
   - "ngày 6 tháng 3 năm 2026" → `2026-03-06`
   - "March 6, 2026" → `2026-03-06`
   - When ambiguous (e.g. 06/03), assume **DD/MM/YYYY** for Vietnamese context.

2. **Run report-build:**
   ```bash
   cd ~/.openclaw && source .env && \
   REPORT_DATE=2026-03-06 node workspace/skills/report-build/index.mjs
   ```

3. **Reply** with the printed report (Apollo, Bouncer, Instantly, Replies metrics for that date).

---

## Parameter Reference

### Apollo Service ENV vars

| Variable | Type | Example | Description |
|----------|------|---------|-------------|
| `TARGET_COUNT` | number | `500` | How many leads to collect |
| `PERSON_TITLES` | JSON array | `'["founder","ceo"]'` | Job titles to search |
| `PERSON_LOCATIONS` | JSON array | `'["United States","Vietnam"]'` | Locations |
| `ORGANIZATION_NUM_EMPLOYEES_RANGES` | JSON array | `'["11,20","21,50"]'` | Company size |
| `APOLLO_API_KEY` | string | (from .env) | Apollo API key |

### Bouncer Service ENV vars

| Variable | Type | Example | Description |
|----------|------|---------|-------------|
| `BOUNCER_API_KEY` | string | (from .env) | Bouncer API key |
| `BOUNCER_BATCH_SIZE` | number | `100` | Max 100 per batch (API limit) |

### Instantly Service ENV vars

| Variable | Type | Example | Description |
|----------|------|---------|-------------|
| `INSTANTLY_API_KEY` | string | (from .env) | Instantly API key |
| `INSTANTLY_CAMPAIGN_ID` | string | (from .env) | Campaign ID |

### Report-build ENV vars

| Variable | Type | Example | Description |
|----------|------|---------|-------------|
| `REPORT_DATE` | string | `2026-03-06` | Date in YYYY-MM-DD. Default: today. Use for "xem report ngày X" requests. |

---

## Common Scenarios

### Scenario A: Incremental collection
```
User: "lấy thêm 100 leads nữa"

Agent:
→ Check DB: currently have 472 leads with status='instantly_loaded'
→ Run: TARGET_COUNT=100 apollo service
→ Reply: "✅ Collected 100 more leads (total: 572 in system)"
```

### Scenario B: Re-verify old leads
```
User: "verify lại những leads có email_status=unknown"

Agent:
→ Update DB: UPDATE leads SET processing_status='apollo_matched' WHERE email_status='unknown'
→ Run: bouncer service
→ Reply: "✅ Re-verified 23 leads: 19 deliverable, 4 failed"
```

### Scenario C: Status check
```
User: "có bao nhiêu leads đang chờ xử lý?"

Agent:
→ Query DB:
  SELECT processing_status, COUNT(*) FROM leads GROUP BY processing_status;
→ Reply:
  📊 Lead pipeline status:
  • apollo_matched: 127 (pending verification)
  • bouncer_verified: 34 (ready to load)
  • instantly_loaded: 458 (in campaign)
  • failed: 12 (invalid emails)
```

---

## Error Handling

### Apollo API rate limit
```
Error: Apollo API 429 Too Many Requests

Agent response:
⚠️ Apollo rate limit hit at 287/500 leads. 
I'll pause for 1 minute and resume automatically.

Current status: 287 leads with status='apollo_matched' in DB.
You can run Bouncer on these while waiting.
```

### Bouncer batch timeout
```
Error: Bouncer batch timed out after 10 minutes

Agent response:
⚠️ Bouncer batch #3 timed out. 
Marked 100 leads as status='failed' with error='bouncer_timeout'.

Completed: 200/500 leads verified.
You can retry failed leads later or skip them.
```

### Instantly duplicate email
```
Warning: 4 leads skipped (already in workspace)

Agent response:
✅ Instantly load complete: 468/472 loaded (4 skipped - duplicates)

The 4 duplicates remain status='bouncer_verified' in case you want to add them to a different campaign.
```

---

## Best Practices

### 1. Always check DB first
Before running any service, query DB to see current state:
```sql
-- How many leads at each status?
SELECT processing_status, COUNT(*) FROM leads GROUP BY processing_status;

-- Recent activity?
SELECT processing_status, COUNT(*) FROM leads 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY processing_status;
```

### 2. Provide progress updates
For long-running operations (>30 seconds), give incremental updates:
```
✅ Apollo: 127/500 (25%)
✅ Apollo: 284/500 (57%)
✅ Apollo: 502/500 (100% - target reached)
```

### 3. Explain status transitions
Help users understand the pipeline:
```
Your 500 leads will go through these stages:
1. apollo_matched (collected from Apollo)
2. bouncer_verified (email validated)
3. instantly_loaded (pushed to campaign)
4. Campaign sends emails 9AM-5PM (set in Instantly UI)
```

### 4. Handle flexible wording
Recognize variations:
- "lấy leads" = "get leads" = "collect contacts" = "pull prospects"
- "verify" = "validate" = "check emails" = "bouncer"
- "load" = "push" = "add to campaign" = "upload to Instantly"

### 5. Infer missing parameters
If user says "lấy 500 leads" without specifying ICP:
```
✅ Collecting 500 leads with default ICP:
• Titles: vp marketing, head of marketing, vp sales, director of marketing/sales
• Locations: US & Canada (set ICP_MARKET=en for US, UK, AU, CA)
• Company size: 10–50 employees
• Industries: Marketing & Advertising, Computer Software/Tech, E-commerce, SaaS

(Override with PERSON_LOCATIONS, ORGANIZATION_NUM_EMPLOYEES_RANGES, ORGANIZATION_INDUSTRY_TAG_IDS.)
```

---

## Summary

✅ **You parse natural language** (any language) into parameters  
✅ **Services are autonomous** (read from DB by status)  
✅ **Flexible execution** (500 leads, 1000 leads, re-verify old, etc.)  
✅ **Progress tracking** (query DB mid-run to show progress)  
✅ **Resume capability** (kill mid-run, restart from last status)

The user just needs to say what they want. You figure out:
1. Which service to run (apollo / bouncer / instantly)
2. What parameters to pass (TARGET_COUNT, filters, etc.)
3. How to track progress (query DB for counts by status)
4. When to notify complete (all leads reached target status)
