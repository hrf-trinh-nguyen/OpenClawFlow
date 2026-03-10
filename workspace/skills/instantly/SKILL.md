---
name: instantly
description: "Load leads to Instantly, fetch replies, classify with LLM (consolidated service)"
version: "2.0.0"
---

# Instantly Service (Consolidated)

Combines `instantly-load` + `instantly-fetch` + `llm-classify` into one service.

## What it does

Depending on `MODE` environment variable:

### MODE='load' (default when run after bouncer)
1. Read leads with `processing_status='bouncer_verified'`
2. Push to Instantly campaign via API
3. Update to `processing_status='instantly_loaded'`

### MODE='fetch' or 'classify'
1. Fetch recent replies from Instantly inbox
2. Classify each reply using OpenAI (hot/soft/objection/negative)
3. Save to `replies` table with `reply_category` and `category_confidence`
4. **Hot leads:** Send fixed template reply via Instantly (Design Pickle: Book now + Compare links). Uses `first_name` from leads table.

### MODE='all'
Runs both load + fetch/classify in sequence.

## Parameters (ENV variables)

- `MODE`: 'load' | 'fetch' | 'classify' | 'all' (default: 'all')
- `INSTANTLY_API_KEY`: Instantly API key (required)
- `INSTANTLY_CAMPAIGN_ID`: Campaign ID (required)
- `INSTANTLY_EACCOUNT`: Email account for replies (fallback if API omits eaccount)
- `OPENAI_API_KEY`: OpenAI API key (required for fetch/classify)
- **Date filtering (fetch):** Default = today only (0h-24h local). No more pulling all replies.
  - `FETCH_DATE`: Single day (YYYY-MM-DD), e.g. `FETCH_DATE=2026-03-06`
  - `FETCH_DATE_FROM` + `FETCH_DATE_TO`: Date range (YYYY-MM-DD)

## Execute

```bash
# Load verified leads to Instantly
cd ~/.openclaw && MODE=load node workspace/skills/instantly/index.mjs

# Fetch and classify replies (default: today only)
cd ~/.openclaw && MODE=fetch node workspace/skills/instantly/index.mjs

# Specific date
cd ~/.openclaw && FETCH_DATE=2026-03-06 MODE=fetch node workspace/skills/instantly/index.mjs

# Date range
cd ~/.openclaw && FETCH_DATE_FROM=2026-03-01 FETCH_DATE_TO=2026-03-05 MODE=fetch node workspace/skills/instantly/index.mjs

# Run both
cd ~/.openclaw && MODE=all node workspace/skills/instantly/index.mjs
```

## Output

- **Load**: Updates leads to `processing_status='instantly_loaded'`
- **Fetch/Classify**: Saves replies to `replies` table with category

## Error Handling

- **Load**: Continues on individual lead failures, logs total success/failed
- **Fetch**: Retries on network errors, continues to next reply on classification errors
- **Rate limits**: 100ms delay between lead adds, 500ms between reply classifications

## Database Tables Updated

- `leads`: `processing_status='instantly_loaded'`
- `replies`: upserted with `reply_category`, `category_confidence`
- `pipeline_runs`: created/updated with run status
- `service_executions`: logged for each operation

## Performance

- **Load**: Uses Instantly bulk add API (POST /api/v2/leads/add), max 1000 leads per request. Batches of 1000, 500ms delay between batches.
- **Fetch/Classify**: ~2 replies/second (500ms delay + LLM call)
