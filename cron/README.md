# Scheduling — Crontab

All 4 jobs run via **system crontab** (not OpenClaw agent cron).

**Lead source:** Apollo is not used. Use the Agent + **csv-import** skill to import CSV into the DB; the Bouncer cron verifies existing leads, then Load campaign pushes them to Instantly.

## Schedule (Pacific Time)

| Job | Schedule (PT) | Script | Log |
|-----|---------------|--------|-----|
| Bouncer (verify leads) | 5:00 AM | `run-build-list.sh` | `logs/build-list.log` |
| Load Campaign | 5:30 AM | `run-load-campaign.sh` | `logs/load-campaign.log` |
| Process Replies | 10 AM–9 PM (hourly) | `run-process-replies.sh` | `logs/process-replies.log` |
| Daily Report | 10:00 PM | `run-daily-report.sh` | `logs/daily-report.log` |

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
