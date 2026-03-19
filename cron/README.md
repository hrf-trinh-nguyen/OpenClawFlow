# Scheduling — Crontab

All jobs run via **system crontab** (not OpenClaw agent cron).

**Lead source:** Apollo is not used. Use the Agent + **csv-import** skill to import CSV into the DB; the Bouncer cron verifies existing leads, then Load campaign pushes them to Instantly.

## Important: Timezone Handling

**Cron uses SERVER TIMEZONE (UTC).** The `TZ` variable in crontab is NOT supported by most Linux cron daemons. All cron expressions in `crontab.example` are written in **UTC**.

PT ↔ UTC conversion (PDT = UTC-7, active Mar–Nov):
- 5 AM PT = 12:00 UTC
- 10 AM PT = 17:00 UTC
- 10 PM PT = 05:00 UTC (next day)

## Schedule

| Job | PT Time | UTC Time | Script | Log |
|-----|---------|----------|--------|-----|
| Bouncer (verify) | 5, 6, 7, 8 AM | 12, 13, 14, 15 | `run-build-list.sh` | `logs/build-list.log` |
| Load Campaign | 5:30, 6:30, 7:30, 8:30 AM | 12:30, 13:30, 14:30, 15:30 | `run-load-campaign.sh` | `logs/load-campaign.log` |
| Process Replies | 10 AM – 9 PM (hourly) | 17–23, 0–4 | `run-process-replies.sh` | `logs/process-replies.log` |
| Daily Report | 10 PM | 05:00 | `run-daily-report.sh` | `logs/daily-report.log` |

**Daily targets:**
- Bouncer: 300 verified/day (4 runs × ~75 each)
- Load: 250 pushed/day (4 runs × ~63 each)

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
crontab -l | grep openclaw
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

All jobs in `cron/jobs.json` are set to `enabled: false`. You do not need to run `register-cron-jobs.sh` or `openclaw cron list`.
