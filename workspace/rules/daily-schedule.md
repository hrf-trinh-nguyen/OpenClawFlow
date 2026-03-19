# Daily Schedule

Daily run schedule for OpenClaw outbound automation. All times are **Pacific Time (America/Los_Angeles)**. Scheduling uses **system crontab** (see repo root `cron/README.md`).

## Reporting Channels

- **Step reports & daily report:** Send a summary after every completed step (channel from `SLACK_REPORT_CHANNEL`)
- **Errors:** Report any error or exception to `SLACK_ALERT_CHANNEL`

---

## 5:00 AM PT – Bouncer (verify leads)

- **Script:** `run-build-list.sh` (Bouncer only; no Apollo)
- Reads leads with `processing_status=apollo_matched` from DB (e.g. from csv-import), verifies via Bouncer API, updates to `bouncer_verified` or `failed`
- **Daily cap:** `BOUNCER_DAILY_CAP` (default 300)
- **Manual run:** `./scripts/run-build-list.sh`

## 5:30 AM PT – Load Campaign

- **Script:** `run-load-campaign.sh`
- Skill: instantly (MODE=load)
- Pushes verified leads from DB to Instantly campaign. **Daily cap:** `INSTANTLY_LOAD_DAILY_CAP` (default 250)
- **Manual run:** `./scripts/run-load-campaign.sh`

## 10:00 AM – 9:00 PM PT – Process Replies (hourly)

- **Script:** `run-process-replies.sh`
- Skill: instantly (MODE=fetch) — fetch inbox, classify replies (hot/soft/objection/negative), auto-reply to hot
- **Manual run:** `./scripts/run-process-replies.sh`

## 10:00 PM PT – Daily Report

- **Script:** `run-daily-report.sh`
- Skills: report-build → slack-notify
- Aggregate metrics from DB and Instantly API, send report to Slack
