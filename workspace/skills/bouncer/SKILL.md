---
name: bouncer
description: "Verify emails via Bouncer batch API, read from DB status='apollo_matched'"
version: "2.0.0"
---

# Bouncer Service

Autonomous email verification service using Bouncer batch API.

## What it does

1. **Read from database** all leads with `processing_status='apollo_matched'`
2. **Submit batches** to Bouncer (100 emails/batch, API limit)
3. **Poll for results** (5-second intervals, max 5 minutes)
4. **Update database**:
   - Deliverable → `processing_status='bouncer_verified'`
   - Invalid → `processing_status='failed'`
5. **Track progress** in `pipeline_runs` and `service_executions`

## Parameters (ENV variables)

- `BOUNCER_API_KEY`: Bouncer API key (required)
- `BOUNCER_BATCH_SIZE`: batch size (default: 1000, max: 1000 per Bouncer rate limit)

## Execute

```bash
cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" \
node workspace/skills/bouncer/index.mjs
```

## Output

Updates database:
- Deliverable leads: `processing_status='bouncer_verified'` + `email_status='deliverable'`
- Invalid leads: `processing_status='failed'` + `email_status='undeliverable'`

## Error Handling

- **Insufficient credits (402)**: Stops processing, marks remaining leads as failed
- **Batch timeout**: Marks batch as failed after 5 minutes, continues to next batch
- **API error**: Logs to `service_executions`, marks batch as failed, continues

## Database Tables Updated

- `leads`: `processing_status`, `email_status`, `updated_at`
- `pipeline_runs`: created/updated with run status
- `service_executions`: logged for each batch submitted

## Performance

- **Batch size**: 100 emails (Bouncer API limit)
- **Poll interval**: 5 seconds
- **Typical batch time**: 30-90 seconds
- **Throughput**: ~1000 emails in 10-15 minutes
