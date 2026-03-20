# Daily Schedule

Daily run schedule for OpenClaw outbound automation. All **business** times are **US Eastern** (`America/New_York`, EST/EDT). Scheduling on the VPS uses **system crontab** with **UTC** expressions (see `cron/README.md`).

## Reporting Channels

- **Step reports & daily report:** `SLACK_REPORT_CHANNEL`
- **Errors:** `SLACK_ALERT_CHANNEL`

---

## 5, 6, 7, 8 AM ET – Bouncer Verify (4 runs)

- **Script:** `run-build-list.sh` (Bouncer only; no Apollo)
- **UTC (EDT):** 9, 10, 11, 12
- Reads leads with `processing_status=apollo_matched` from DB (e.g. from csv-import), verifies via Bouncer API, updates to `bouncer_verified` or `failed`
- **Daily cap:** `BOUNCER_DAILY_CAP` (default 300)
- **Manual run:** `./scripts/run-build-list.sh`

## 5:30, 6:30, 7:30, 8:30 AM ET – Load Campaign (4 runs)

- **Script:** `run-load-campaign.sh`
- **UTC (EDT):** 9:30, 10:30, 11:30, 12:30
- Skill: instantly (MODE=load)
- Pushes verified leads from DB to Instantly campaign
- **Daily cap:** `INSTANTLY_LOAD_DAILY_CAP` (default 250)
- **Manual run:** `./scripts/run-load-campaign.sh`

## 10 AM – 9 PM ET – Process Replies (hourly, 12 runs)

- **Script:** `run-process-replies.sh`
- **UTC (EDT):** 14, 15, …, 23, 0, 1
- Skill: instantly (MODE=fetch) — fetch inbox, classify replies (hot/soft/objection/negative), auto-reply to hot
- **Manual run:** `./scripts/run-process-replies.sh`

## 10 PM ET – Daily Report

- **Script:** `run-daily-report.sh`
- **UTC (EDT):** 02:00
- Skills: report-build → slack-notify
- Aggregate metrics from DB and Instantly API, send report to Slack

**DST:** When US is on **EST**, add **+1 hour** to each UTC run time in `cron/crontab.example` or reinstall after updating the template.
