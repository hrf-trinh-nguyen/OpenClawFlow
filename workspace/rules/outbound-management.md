# Outbound Management Playbook

Single reference for OpenClaw outbound automation. See individual rule files for details.

## Running by workflow

**Prefer workflows** when the user or cron wants to run the full sequence. Details per workflow: see **workflows.md**.

- `Run workflow: build-list` — Apollo Search → Match → Bouncer verify
- `Run workflow: load-campaign` — Push leads to Instantly
- `Run workflow: process-replies` — Fetch replies → LLM classify
- `Run workflow: daily-report` — Build report → Send to Slack

To run **a single skill**, call it by name (e.g. `run apollo`).

## End-to-End Pipeline

```
apollo → bouncer  (workflow: build-list)
        ↓
instantly (MODE=load)  (workflow: load-campaign)
        ↓
Instantly Sends Emails (9 AM–5 PM, set in Instantly UI)
        ↓
instantly (MODE=fetch)  (workflow: process-replies)
        ↓
report-build → slack-notify  (workflow: daily-report)
```

## Daily Schedule (Asia/Ho_Chi_Minh)

| Time     | Workflow        | Skills (in order)                                   |
|----------|-----------------|----------------------------------------------------|
| 6:00 AM  | build-list      | apollo → bouncer                                   |
| 6:30 AM  | load-campaign   | instantly (MODE=load)                              |
| 9–5 PM   | (Instantly UI)  | Sending window (autopilot)                         |
| 6:00 PM  | process-replies | instantly (MODE=fetch)                             |
| 10:00 PM | daily-report    | report-build → slack-notify                         |

## List Building Rules

- Never contact someone emailed in last 45 days
- Validate all emails via Bouncer batch verify before campaign
- Max 500 new contacts per campaign per day
- If invalid rate > 30%: stop and report

## Copy Rotation Rules

- Pause variant with <15% open rate after 200 sends
- Pause variant with 0 replies after 500 sends
- Increase volume on variants with >2% reply rate

## Response Categories (instantly MODE=fetch)

- **hot:** Ready to talk, wants call → log
- **soft:** Interested but timing issue → nurture in 30 days
- **objection:** Decline with reason → log, nurture in 90 days
- **negative:** Unsubscribe or hard no → blacklist, stop sending

## Escalation Triggers

- Deliverability drops below 90% on any account
- More than 5% negative replies on any variant
- Any reply mentioning legal/spam concerns
- Negative rate > 10% across all replies → consider pausing campaign

## API Versions

- **Apollo:** v1 (mixed_people/api_search, people/bulk_match)
- **Bouncer:** v1.1 (email/verify/batch, batch polling, batch download)
- **Instantly:** v2 (leads, emails) — Bearer auth
