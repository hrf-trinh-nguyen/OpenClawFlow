# Daily Schedule

Daily run schedule for OpenClaw outbound automation. All **business** times are **US Eastern** (`America/New_York`, EST/EDT). **Authoritative schedule:** **`cron/crontab.example`** → system `crontab` (not OpenClaw cron). See **`cron/README.md`** for UTC mapping and “Current pipeline flow”.

## Reporting Channels

- **Step reports & daily report:** `SLACK_REPORT_CHANNEL`
- **Errors:** `SLACK_ALERT_CHANNEL`

---

## How Bouncer verification + Instantly load work

1. **Import** — Leads enter the DB as `apollo_matched` (e.g. csv-import).
2. **Bouncer (`run-build-list.sh`)** — Picks up to **`min(remaining daily cap, BOUNCER_PER_RUN_MAX)`** emails per run (default **100** per batch/API submit; `BOUNCER_BATCH_SIZE` matches). Submits batches to the Bouncer API, polls until results return, then sets each lead to **`bouncer_verified`** (deliverable) or **`failed`**. “Today” for the cap counts rows that **became** `bouncer_verified` with `created_at` on the current **US Eastern** calendar day. Cron fires **every 10 minutes** from early morning through late evening; each run **exits immediately** if the daily cap is already reached or there is nothing pending.
3. **Load (`run-load-campaign.sh`)** — Selects up to **`min(LOAD_LIMIT, remaining daily cap)`** leads per run in **`bouncer_verified`** (and not blacklisted), calls Instantly add-leads, then marks successfully added rows **`instantly_loaded`**. **`LOAD_LIMIT`** = max leads **per push** (each cron run). Cron fires **every 10 minutes** from **~6 AM** ET (staggered vs Bouncer); each run **exits immediately** if the daily cap is reached or there are no verified leads ready. Daily cap uses **`updated_at`** today (Eastern) for `instantly_loaded`.
4. **Process replies (hourly)** — `run-process-replies.sh`: fetch/classify/auto-reply; **no** Slack template. **~9:30 PM ET** — `run-process-replies-evening-slack.sh` with **`PROCESS_REPLIES_SLACK_REPORT=1`** posts **one** Process Replies summary to **`SLACK_REPORT_CHANNEL`**.

Runs are **short and repeatable**: each cron tick does one bounded batch; no long wait for “enough” leads.

---

## ~4:00 AM – 11:50 PM ET – Bouncer Verify (every 10 minutes)

- **Script:** `run-build-list.sh` (Bouncer only; no Apollo)
- **UTC (EDT):** see `cron/crontab.example` (typically UTC hours **8–23** and **0–3**, minutes `:00,:10,…,:50`)
- Reads leads with `processing_status=apollo_matched` from DB (e.g. from csv-import), verifies via Bouncer API, updates to `bouncer_verified` or `failed`
- **Per run:** up to `BOUNCER_PER_RUN_MAX` (default 100); **Daily cap:** `BOUNCER_DAILY_CAP` (default 600)
- **Manual run:** `./scripts/run-build-list.sh`

## ~6:05 AM – 11:55 PM ET – Load Campaign (every 10 minutes, +5 min vs Bouncer)

- **Script:** `run-load-campaign.sh`
- **UTC (EDT):** see `cron/crontab.example` (typically UTC hours **10–23** and **0–3**, minutes `:05,:15,…,:55`)
- Skill: instantly (MODE=load)
- Pushes verified leads from DB to Instantly campaign
- **Per push:** `LOAD_LIMIT` (default 200); **Daily cap:** `INSTANTLY_LOAD_DAILY_CAP` (default 600)
- **Manual run:** `./scripts/run-load-campaign.sh`

## 10 AM – 9 PM ET – Process Replies (hourly, no Slack)

- **Script:** `run-process-replies.sh`
- **UTC (EDT):** 14, 15, …, 23, 0, 1
- Skill: instantly (MODE=fetch) — fetch inbox, classify replies (hot/soft/objection/negative), auto-reply to hot
- **Slack:** none (hourly); see **9:30 PM** job for one summary
- **Manual run:** `./scripts/run-process-replies.sh`

## ~9:30 PM ET – Process Replies Slack summary (1×)

- **Script:** `run-process-replies-evening-slack.sh`
- **UTC (EDT):** 01:30 (next UTC calendar day when US is on EDT)
- Posts **one** Process Replies template to **`SLACK_REPORT_CHANNEL`** (`PROCESS_REPLIES_SLACK_REPORT=1`)
- **Manual run:** `./scripts/run-process-replies-evening-slack.sh`

## 10 PM ET – Daily Report

- **Script:** `run-daily-report.sh`
- **UTC (EDT):** 02:00
- Skills: report-build → slack-notify
- Aggregate metrics from DB and Instantly API, send report to Slack

**DST:** When US is on **EST**, add **+1 hour** to each UTC run time in `cron/crontab.example` or reinstall after updating the template.
