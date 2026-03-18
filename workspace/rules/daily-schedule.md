# Daily Schedule

Daily run schedule for OpenClaw outbound automation. All times are **Pacific Time (America/Los_Angeles, UTC-8/UTC-7 DST)**. Use **workflows** for multi-step runs (see workflows.md).

## Reporting Channels

- **Step reports & daily report:** `C0A5S86QH9D` — send a summary after every completed step
- **Errors:** `C0ALRRHK61X` — report any error or exception immediately

After **every** workflow step completes, post a brief summary to `C0A5S86QH9D` (e.g. "Build List done: 200 leads collected, 187 bouncer_verified"). If any step throws an error, post to `C0ALRRHK61X` immediately.

---

## 3:00 AM, 4:00 AM, 5:00 AM PT – Build List

- **Workflow:** `build-list`
- Skills: apollo → bouncer
- **Runs via systemd timer** (`openclaw-build-list.timer`) — NOT via OpenClaw cron agent
- **Daily target: 200 `bouncer_verified` leads.** Each run does a single Apollo batch (`TARGET_COUNT=100`) + one Bouncer pass.
- Report completion summary to `C0A5S86QH9D`. Report errors to `C0ALRRHK61X`.
- **Manual run:** `./scripts/run-build-list.sh` or `TARGET_COUNT=50 ./scripts/run-build-list.sh`

## 5:15 AM, 5:45 AM PT – Load Campaign

- **Workflow:** `load-campaign`
- Skill: instantly (MODE=load)
- **Runs via systemd timer** (`openclaw-load-campaign.timer`) — NOT via OpenClaw cron agent
- Add verified leads from DB to Instantly campaign in bounded batches (`LOAD_LIMIT=100`)
- Report completion summary to `C0A5S86QH9D`. Report errors to `C0ALRRHK61X`.
- **Manual run:** `./scripts/run-load-campaign.sh` or `LOAD_LIMIT=50 ./scripts/run-load-campaign.sh`

## 9:00 AM – 5:00 PM PT – Sending Window

- Instantly sends automatically per its UI schedule
- OpenClaw does not intervene during this window

## 10:00 AM – 9:00 PM PT – Process Replies (Every Hour)

- **Workflow:** `process-replies`
- Runs at the top of every hour from 10 AM to 9 PM PT (`0 10-21 * * *`)
- Skills: instantly (MODE=fetch, includes classify + hot reply)
- Fetch today's replies from Instantly inbox, classify via LLM (hot/soft/objection/negative)
- **Hot leads:** Send fixed template reply with Book now + Compare links
- Log hot/soft/objection/negative counts; escalate if negative rate > 10%
- Report each run summary (# replies fetched, # classified, # replied) to `C0A5S86QH9D`. Report errors to `C0ALRRHK61X`.

## 10:00 PM PT – Daily Report

- **Workflow:** `daily-report`
- Skills: report-build → slack-notify
- Aggregate stats from DB, send full report to Slack channel `C0A5S86QH9D`
- Report errors to `C0ALRRHK61X`.
