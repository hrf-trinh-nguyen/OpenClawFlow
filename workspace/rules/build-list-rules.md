# Build List Rules

Rules for the build-list skill pipeline.

## ICP (Ideal Customer Profile)

- **Titles:** Founder, CEO, Head of Marketing, VP Sales, Growth
- **Industry:** SaaS, B2B Software (tag: 5567cd467369644d39040000)
- **Location:** United States (priority), then expand to UK, Canada
- **Company size:** 10–200 employees

## Pipeline Steps

1. **Apollo Search** – `POST mixed_people/api_search`, 100/page, loop pages until batch_size
2. **Apollo Bulk Match** – `POST people/bulk_match`, 10 IDs/request, extract email + details
3. **Bouncer Batch Verify** – `POST email/verify/batch`, poll until completed, download results
4. **Filter** – Keep only `status === "deliverable"`, discard undeliverable/unknown
5. **Save** – Write valid leads to state for load-campaign

## Daily Target — MUST reach 200 bouncer_verified

**Each day the pipeline MUST collect 200 leads with `bouncer_verified` status.**

- Cron should reach the 200/day target through **multiple short runs**, not one long loop-heavy agent turn
- Each `build-list` cron run should do exactly **one** Apollo batch (`TARGET_COUNT=100`) followed by one Bouncer pass
- After each run, check progress with: `SELECT COUNT(*) FROM leads WHERE processing_status='bouncer_verified' AND DATE(created_at) = CURRENT_DATE;`
- If the daily count is still under 200, let the **next scheduled build-list run** continue progress
- If Apollo returns no more results: log warning, report to `C0ALRRHK61X`, stop gracefully

## Limits & Guardrails

- Batch size: 100 leads per Apollo pull
- Keep each cron run bounded to a single Apollo + Bouncer pass to avoid agent timeout
- Max 500 new contacts per campaign per day
- Never contact someone emailed in last 45 days
- If invalid rate > 30%: log warning, review ICP filters
- Do not pull leads from domains already in campaign (avoid duplicates)
- Do not pull leads from blacklist (if configured)
- Log all excluded leads and reasons

## Email Validation

- Keep only **deliverable** emails (Bouncer status)
- Remove: undeliverable, risky, unknown
- Bouncer batch supports 1000–10000 emails per batch
- Poll interval: 15 seconds, max 40 polls (~10 min)
