# Scheduling — System crontab (authoritative)

**This repo’s automation schedule lives in `cron/crontab.example` → installed with `./scripts/install-cron.sh` → your user’s `crontab -l`.**

- **`openclaw.json`** has `"cron": { "enabled": false }` — the OpenClaw gateway does **not** run pipeline jobs on a timer.
- **`cron/jobs.json`** and **`scripts/register-cron-jobs.sh`** are only relevant if you **enable** OpenClaw cron later. Day-to-day: **ignore them**; treat **`crontab.example`** as the source of truth.

**Lead source:** Apollo is not used in cron. Use the Agent + **csv-import** skill to put leads in the DB; **system crontab** runs Bouncer → Load → replies → daily report via shell scripts.

---

## Current pipeline flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. IMPORT (manual / Agent + csv-import skill)                              │
│    CSV / Sheet → DB, processing_status = apollo_matched                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. BOUNCER — scripts/run-build-list.sh (cron, ~every 10 min, ET window)     │
│    • Reads apollo_matched → Bouncer API → bouncer_verified or failed        │
│    • Per run: ≤ BOUNCER_PER_RUN_MAX (default 100); daily: BOUNCER_DAILY_CAP  │
│    • Skips if cap reached or no pending leads                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. LOAD INSTANTLY — scripts/run-load-campaign.sh (cron, ~every 10 min,      │
│    from ~6 AM ET, +5 min vs Bouncer minutes)                                  │
│    • Reads bouncer_verified → Instantly add-leads → instantly_loaded        │
│    • Per run: ≤ LOAD_LIMIT (default 200); daily: INSTANTLY_LOAD_DAILY_CAP   │
│    • Skips if cap reached or no verified leads ready                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. PROCESS REPLIES — scripts/run-process-replies.sh (hourly, no Slack)      │
│    • Instantly inbox → classify → auto-reply hot, etc.                      │
│    • scripts/run-process-replies-evening-slack.sh (~9:30 PM ET) → one Slack │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. DAILY REPORT — scripts/run-daily-report.sh (1×/day, ~10 PM ET)           │
│    • Aggregates metrics → Slack                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**OpenClaw gateway** (when running): Slack, skills on demand — **separate** from this cron pipeline unless you trigger workflows manually.

## Important: Timezone Handling

**Cron uses SERVER TIMEZONE (UTC)** on the VPS. The `TZ=` line in crontab is not reliable on all distros. All expressions in `crontab.example` use **UTC**.

**Business timezone:** **US Eastern** (`America/New_York`, EST/EDT). Shell scripts and the Node workspace use this for “today”, Slack timestamps, and DB date boundaries.

`crontab.example` is maintained for **EDT (~March–November, UTC−4)**. When the US is on **EST (UTC−5)**, shift each UTC hour by **+1** or update the file and re-run `./scripts/install-cron.sh`.

## Schedule

| Job | Eastern (local) | UTC (EDT) | Script | Log |
|-----|-------------------|-----------|--------|-----|
| Bouncer (verify) | ~4:00 AM – 11:50 PM (every 10m) | UTC 8–23 + 0–3 (EDT) | `run-build-list.sh` | `logs/build-list.log` |
| Load Campaign | ~6:05 AM – 11:55 PM (+5m) | UTC 10–23 + 0–3 (EDT) | `run-load-campaign.sh` | `logs/load-campaign.log` |
| Process Replies (hourly, no Slack) | 10 AM – 9 PM | 14–23, 0, 1 | `run-process-replies.sh` | `logs/process-replies.log` |
| Process Replies (Slack summary) | ~9:30 PM | 01:30 (EDT) | `run-process-replies-evening-slack.sh` | `logs/process-replies-evening.log` |
| Daily Report | 10 PM | 02:00 | `run-daily-report.sh` | `logs/daily-report.log` |

### Vietnam time (ICT, UTC+7) — same jobs during **US EDT**

Use this if your team or VPS operators work from Vietnam. ICT does not observe DST.

| Job | US Eastern | UTC (VPS) | Vietnam (ICT) |
|-----|------------|-----------|----------------|
| Bouncer | ~4:00 AM – 11:50 PM | 8–23, 0–3 UTC | ICT +7 from UTC (wide window) |
| Load campaign | ~6:05 AM – 11:55 PM | 10–23, 0–3 UTC | +5m vs Bouncer minutes |
| Process replies (hourly, no Slack) | 10 AM → 9 PM | 14 → 23, then 0, 1 | 21:00 → 08:00 next morning (12 runs) |
| Process replies (Slack summary) | ~9:30 PM | 01:30 UTC (EDT) | ~08:30 next morning ICT |
| Daily report | 10 PM | 02:00 (next UTC calendar day) | 09:00 morning |

**Daily targets (defaults; override in `.env`):**

- Bouncer: up to `BOUNCER_DAILY_CAP` verified/day (default 600); each run processes up to `BOUNCER_PER_RUN_MAX` (default 100). Cron retries every 10 min until cap or queue empty.
- Load: up to `INSTANTLY_LOAD_DAILY_CAP` pushed/day (default 600); each run pushes at most `LOAD_LIMIT` (default 200). Cron from ~6 AM ET every 10 min until cap or no verified leads.

---

## Ready to apply (deploy checklist)

1. **Pull** latest code on the VPS.
2. Run **`./scripts/after-pull-vps.sh`** (install deps + build workspace + optional gateway restart).
3. Run **`./scripts/install-cron.sh`** so `crontab` matches `cron/crontab.example`.
4. Confirm **`crontab -l`** shows the expected job lines (Bouncer + Load + Process replies hourly + evening Slack + Daily report).
5. If you use **systemd** `openclaw.service` / timers from `deploy/`: **`daemon-reload`** and **restart** as needed.
6. **EST (winter):** UTC offsets differ from EDT — update `crontab.example` or adjust UTC hours and reinstall (see note at top).

---

## Install Crontab

```bash
cd /home/deploy/openclaw-mvp   # or ~/OpenClawFlow
./scripts/install-cron.sh
```

The script substitutes the repo path for your current directory.

**Verify:**

```bash
crontab -l
```

---

## Run manually (testing)

```bash
./scripts/run-build-list.sh
./scripts/run-load-campaign.sh
./scripts/run-process-replies.sh
./scripts/run-daily-report.sh
```

---

## View logs

```bash
tail -f logs/build-list.log
tail -f logs/load-campaign.log
tail -f logs/process-replies.log
tail -f logs/daily-report.log

# All logs
tail -f logs/*.log
```

---

## Verify cron is active (on VPS)

```bash
crontab -l | grep OPENCLAW_REPO
```

You should see the OpenClaw job lines (Bouncer, Load, Process replies, Daily report).

---

## After pulling code on VPS

```bash
git pull
./scripts/after-pull-vps.sh
./scripts/install-cron.sh   # if crontab.example changed
```

---

## OpenClaw cron (disabled — optional duplicate)

`openclaw.json` → `"cron.enabled": false`. **`cron/jobs.json`** is **not** used for your current setup.

If you ever set `"cron.enabled": true`, you could mirror schedules there — but then you’d risk **double-running** jobs unless you remove system crontab entries. **Recommended:** keep **only system crontab** for the pipeline.
