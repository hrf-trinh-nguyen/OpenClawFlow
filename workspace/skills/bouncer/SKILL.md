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
   - `deliverable` → `bouncer_verified` + `email_status='deliverable'`
   - `risky` → `bouncer_verified` + `email_status='risky'` (still eligible for Instantly load)
   - `unknown` (or unrecognized status) → `bouncer_verified` + `email_status='unknown'`
   - `undeliverable` → `failed` + `email_status='undeliverable'`
5. **Track progress** in `pipeline_runs` and `service_executions`

## Parameters (ENV variables)

- `BOUNCER_API_KEY`: Bouncer API key (required)
- `BOUNCER_BATCH_SIZE`: emails per API batch (default: 100, max: 1000 per Bouncer)
- `BOUNCER_PER_RUN_MAX`: max leads per cron run (shell `run-build-list.sh`; default 100, from `FALLBACK_LIMITS`)
- `SLACK_BOT_TOKEN` + `SLACK_ALERT_CHANNEL`: alerts on **API/technical** failures or **incomplete** Bouncer response (missing result row)

## Execute

```bash
cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" \
node workspace/skills/bouncer/index.mjs
```

## Output

Updates database:
- Deliverable: `bouncer_verified` + `email_status='deliverable'`
- Risky / unknown: `bouncer_verified` + `email_status='risky'` or `'unknown'` (not treated as undeliverable)
- Invalid: `failed` + `email_status='undeliverable'`

## Error Handling

- **Normal “bad email”**: Bouncer `undeliverable` → lead `failed` with reason `Email not deliverable` (batch continues).
- **Risky / unknown / any other Bouncer string**: mapped to `bouncer_verified` with the appropriate `email_status` — **run does not stop** for result status alone.
- **Incomplete response** (submitted email missing from Bouncer download): **Stops** that run — no DB updates for that batch; **`SLACK_ALERT_CHANNEL`** notified; exit 1.
- **API / technical errors** (submit, poll, download, timeout, 402, etc.): **Stops** — leads in that batch are **not** mass-marked failed; **Slack alert**; writes `state/bouncer-paused` so **cron skips Bouncer** until you fix the API or a **successful** run removes the file; exit 1.

## Database Tables Updated

- `leads`: `processing_status`, `email_status`, `updated_at`
- `pipeline_runs`: created/updated with run status
- `service_executions`: logged for each batch submitted

## Performance

- **Batch size**: 100 emails (Bouncer API limit)
- **Poll interval**: 5 seconds
- **Typical batch time**: 30-90 seconds
- **Throughput**: ~1000 emails in 10-15 minutes
