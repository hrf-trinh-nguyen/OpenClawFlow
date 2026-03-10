---
name: apollo
description: "Collect leads from Apollo (search + match) and write to DB with status='apollo_matched'"
version: "2.0.0"
---

# Apollo Service (Consolidated)

Combines `apollo-search` + `apollo-match` into one autonomous service.

## What it does

1. **Search Apollo API** for person IDs matching ICP filters (page-by-page, 100/page)
2. **Bulk match** person IDs to get full profiles with emails (10 IDs/batch)
3. **Write to database** with `processing_status='apollo_matched'`
4. **Track progress** in `pipeline_runs` and `service_executions` tables
5. **Stop when target reached** (TARGET_COUNT)

## Parameters (ENV variables)

- `TARGET_COUNT`: number of leads to collect (default: 100). Agent parses from user message (e.g. "get 5 leads" → TARGET_COUNT=5).
- `PERSON_TITLES`: JSON array of job titles (default: VP/director marketing & sales)
- `PERSON_LOCATIONS`: JSON array; overridden by `ICP_MARKET` if set
- `ICP_MARKET`: `en` = US, UK, AU, CA | `us_ca` = US & Canada only (default)
- `ORGANIZATION_NUM_EMPLOYEES_RANGES`: JSON array (default: 10–50 employees `["11,20","21,50"]`)
- `ORGANIZATION_INDUSTRY_TAG_IDS`: optional JSON array of Apollo industry tag IDs (Marketing & Advertising, Computer Software/Tech, E-commerce, SaaS)
- `BATCH_ID`: optional batch identifier (auto-generated if not provided)

Default ICP (sales VP focus): Marketing & Advertising, Computer Software/Tech, E-commerce (Retail & DTC), SaaS; 10–50 employees; US (or US/CA).

## Execute

```bash
cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" \
TARGET_COUNT=500 \
PERSON_TITLES='["founder","ceo"]' \
PERSON_LOCATIONS='["Vietnam"]' \
node workspace/skills/apollo/index.mjs
```

## Output

Leads written to database with:
- `processing_status='apollo_matched'`
- `batch_id` for grouping
- All Apollo fields (name, email, company, title, linkedin_url)

## Error Handling

- **Rate limit (429)**: Pauses 60 seconds, then retries
- **API error**: Logs to `service_executions` table, continues to next batch
- **No more results**: Completes early if Apollo returns empty page

## Database Tables Updated

- `leads`: upserted with new Apollo data
- `pipeline_runs`: created/updated with run status
- `service_executions`: logged for each search/match call
