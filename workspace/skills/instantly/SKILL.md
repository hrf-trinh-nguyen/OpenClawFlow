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

### MODE='all'
Runs both load + fetch/classify in sequence.

## Parameters (ENV variables)

- `MODE`: 'load' | 'fetch' | 'classify' | 'all' (default: 'all')
- `INSTANTLY_API_KEY`: Instantly API key (required)
- `INSTANTLY_CAMPAIGN_ID`: Campaign ID (required)
- `OPENAI_API_KEY`: OpenAI API key (required for fetch/classify)

## Execute

```bash
# Load verified leads to Instantly
cd ~/.openclaw && MODE=load node workspace/skills/instantly/index.mjs

# Fetch and classify replies
cd ~/.openclaw && MODE=fetch node workspace/skills/instantly/index.mjs

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

- **Load**: ~10 leads/second (100ms delay per lead)
- **Fetch/Classify**: ~2 replies/second (500ms delay + LLM call)
