# Daily Schedule

Daily run schedule for OpenClaw outbound automation. All times shown are **Pacific Time (PT)**. Scheduling uses **system crontab** with UTC times (see `cron/README.md`).

## Important: Timezone

**Cron runs in UTC** (server timezone). PT times below are for reference; actual cron expressions use UTC.

PT ↔ UTC (PDT, Mar–Nov): PT + 7 = UTC

## Reporting Channels

- **Step reports & daily report:** `SLACK_REPORT_CHANNEL`
- **Errors:** `SLACK_ALERT_CHANNEL`

---

## 5, 6, 7, 8 AM PT – Bouncer Verify (4 runs)

- **Script:** `run-build-list.sh` (Bouncer only; no Apollo)
- **UTC:** 12, 13, 14, 15
- Reads leads with `processing_status=apollo_matched` from DB (e.g. from csv-import), verifies via Bouncer API, updates to `bouncer_verified` or `failed`
- **Daily cap:** `BOUNCER_DAILY_CAP` (default 300)
- **Manual run:** `./scripts/run-build-list.sh`

## 5:30, 6:30, 7:30, 8:30 AM PT – Load Campaign (4 runs)

- **Script:** `run-load-campaign.sh`
- **UTC:** 12:30, 13:30, 14:30, 15:30
- Skill: instantly (MODE=load)
- Pushes verified leads from DB to Instantly campaign
- **Daily cap:** `INSTANTLY_LOAD_DAILY_CAP` (default 250)
- **Manual run:** `./scripts/run-load-campaign.sh`

## 10 AM – 9 PM PT – Process Replies (hourly, 12 runs)

- **Script:** `run-process-replies.sh`
- **UTC:** 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4
- Skill: instantly (MODE=fetch) — fetch inbox, classify replies (hot/soft/objection/negative), auto-reply to hot
- **Manual run:** `./scripts/run-process-replies.sh`

## 10 PM PT – Daily Report

- **Script:** `run-daily-report.sh`
- **UTC:** 05:00 (next day)
- Skills: report-build → slack-notify
- Aggregate metrics from DB and Instantly API, send report to Slack
