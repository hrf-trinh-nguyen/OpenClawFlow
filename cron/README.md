# Scheduling — Crontab

All jobs run via **system crontab** (not OpenClaw agent cron).

**Lead source:** Apollo is not used. Use the Agent + **csv-import** skill to import CSV into the DB; the Bouncer cron verifies existing leads, then Load campaign pushes them to Instantly.

## Important: Timezone Handling

**Cron uses SERVER TIMEZONE (UTC)** on the VPS. The `TZ=` line in crontab is not reliable on all distros. All expressions in `crontab.example` use **UTC**.

**Business timezone:** **US Eastern** (`America/New_York`, EST/EDT). Shell scripts and the Node workspace use this for “today”, Slack timestamps, and DB date boundaries.

`crontab.example` is maintained for **EDT (~March–November, UTC−4)**. When the US is on **EST (UTC−5)**, shift each UTC hour by **+1** or update the file and re-run `./scripts/install-cron.sh`.

## Schedule

| Job | Eastern (local) | UTC (EDT) | Script | Log |
|-----|-------------------|-----------|--------|-----|
| Bouncer (verify) | 5, 6, 7, 8 AM | 9, 10, 11, 12 | `run-build-list.sh` | `logs/build-list.log` |
| Load Campaign | 5:30, 6:30, 7:30, 8:30 AM | 9:30–12:30 | `run-load-campaign.sh` | `logs/load-campaign.log` |
| Process Replies | 10 AM – 9 PM (hourly) | 14–23, 0, 1 | `run-process-replies.sh` | `logs/process-replies.log` |
| Daily Report | 10 PM | 02:00 | `run-daily-report.sh` | `logs/daily-report.log` |

### Vietnam time (ICT, UTC+7) — same jobs during **US EDT**

Use this if your team or VPS operators work from Vietnam. ICT does not observe DST.

| Job | US Eastern | UTC (VPS) | Vietnam (ICT) |
|-----|------------|-----------|----------------|
| Bouncer (4×) | 5, 6, 7, 8 AM | 9, 10, 11, 12 | 16:00, 17:00, 18:00, 19:00 (afternoon/evening) |
| Load campaign (4×) | 5:30, 6:30, 7:30, 8:30 AM | 9:30, 10:30, 11:30, 12:30 | 16:30, 17:30, 18:30, 19:30 |
| Process replies (hourly) | 10 AM → 9 PM | 14 → 23, then 0, 1 | 21:00 → 08:00 next morning (12 runs per US Eastern “business day”) |
| Daily report | 10 PM | 02:00 (next UTC calendar day) | 09:00 morning |

**Daily targets:**

- Bouncer: 300 verified/day (4 runs × ~75 each)
- Load: 250 pushed/day (4 runs × ~63 each)

---

## Ready to apply (deploy checklist)

1. **Pull** latest code on the VPS.
2. Run **`./scripts/after-pull-vps.sh`** (install deps + build workspace + optional gateway restart).
3. Run **`./scripts/install-cron.sh`** so `crontab` matches `cron/crontab.example`.
4. Confirm **`crontab -l`** shows four jobs with the UTC hours above.
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

You should see 4 job lines.

---

## After pulling code on VPS

```bash
git pull
./scripts/after-pull-vps.sh
./scripts/install-cron.sh   # if crontab.example changed
```

---

## OpenClaw cron (disabled)

Jobs in `cron/jobs.json` use `America/New_York` if you re-enable OpenClaw cron. Primary scheduling remains **system crontab**.
