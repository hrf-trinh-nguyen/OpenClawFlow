# Daily Schedule

Daily run schedule for OpenClaw outbound automation. All **business** times are **US Eastern** (`America/New_York`, EST/EDT). Scheduling on the VPS uses **system crontab** with **UTC** expressions (see `cron/README.md`).

## Reporting Channels

- **Step reports & daily report:** `SLACK_REPORT_CHANNEL`
- **Errors:** `SLACK_ALERT_CHANNEL`

---

## How Bouncer verification + Instantly load work

1. **Import** — Leads enter the DB as `apollo_matched` (e.g. csv-import).
2. **Bouncer (`run-build-list.sh`)** — Picks up to `BOUNCER_LIMIT` emails per run (the script sets `BOUNCER_LIMIT` = remaining daily headroom under `BOUNCER_DAILY_CAP`). Submits batches to the Bouncer API, polls until results return, then sets each lead to **`bouncer_verified`** (deliverable) or **`failed`**. “Today” for the cap counts rows that **became** `bouncer_verified` with `created_at` on the current **US Eastern** calendar day.
3. **Load (`run-load-campaign.sh`)** — Selects up to `min(LOAD_LIMIT, remaining daily cap)` leads in **`bouncer_verified`** (and not blacklisted), calls Instantly add-leads, then marks successfully added rows **`instantly_loaded`**. Daily cap uses **`updated_at`** today (Eastern) for `instantly_loaded`.

Runs are **short and repeatable**: each cron tick does one bounded batch; no long wait for “enough” leads.

---

## 5, 6, 7, 8 AM ET – Bouncer Verify (4 runs)

- **Script:** `run-build-list.sh` (Bouncer only; no Apollo)
- **UTC (EDT):** 9, 10, 11, 12
- Reads leads with `processing_status=apollo_matched` from DB (e.g. from csv-import), verifies via Bouncer API, updates to `bouncer_verified` or `failed`
- **Daily cap:** `BOUNCER_DAILY_CAP` (default 600)
- **Manual run:** `./scripts/run-build-list.sh`

## 5:30, 6:30, 7:30, 8:30 AM ET – Load Campaign (4 runs)

- **Script:** `run-load-campaign.sh`
- **UTC (EDT):** 9:30, 10:30, 11:30, 12:30
- Skill: instantly (MODE=load)
- Pushes verified leads from DB to Instantly campaign
- **Daily cap:** `INSTANTLY_LOAD_DAILY_CAP` (default 600); per run: `LOAD_LIMIT` (default 200)
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
