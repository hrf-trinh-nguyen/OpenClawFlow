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

## Limits & Guardrails

- Max 100 leads per run (configurable via batch_size)
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
