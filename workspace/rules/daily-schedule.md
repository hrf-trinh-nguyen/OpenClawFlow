# Daily Schedule

Daily run schedule for OpenClaw outbound automation. All times are **Pacific Time (America/Los_Angeles, UTC-8/UTC-7 DST)**. Use **workflows** for multi-step runs (see workflows.md).

## Reporting Channels

- **Step reports & daily report:** `C0A5S86QH9D` — send a summary after every completed step
- **Errors:** `C0ALRRHK61X` — report any error or exception immediately

After **every** workflow step completes, post a brief summary to `C0A5S86QH9D` (e.g. "Build List done: 200 leads collected, 187 bouncer_verified"). If any step throws an error, post to `C0ALRRHK61X` immediately.

---

## 6:00 AM PT – Build List

- **Workflow:** `build-list`
- Skills: apollo → bouncer
- **Target: 200 `bouncer_verified` leads.** Keep looping apollo → bouncer until `bouncer_verified` count reaches 200. Do not stop early.
- Report completion summary to `C0A5S86QH9D`. Report errors to `C0ALRRHK61X`.

## 6:30 AM PT – Load Campaign

- **Workflow:** `load-campaign`
- Skill: instantly (MODE=load)
- Add verified leads from DB to Instantly campaign (send schedule set in Instantly UI)
- Report completion summary to `C0A5S86QH9D`. Report errors to `C0ALRRHK61X`.

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
