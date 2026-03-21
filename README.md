# OpenClaw Outbound Automation

Outbound lead pipeline powered by **OpenClaw**: lead verification (Bouncer), campaign loading (Instantly), reply processing, and daily reporting. Scheduling uses **system crontab**. Leads are imported via the Agent + **csv-import** skill; no Apollo in the cron flow.

## Overview

| Step | Description |
|------|-------------|
| **Lead source** | Agent + **csv-import** (CSV or Google Sheet) → leads in DB with `processing_status=apollo_matched` |
| **Bouncer** | Cron verifies emails (Bouncer API), updates to `bouncer_verified` or `failed`. Daily cap: `BOUNCER_DAILY_CAP` (default 600). |
| **Load campaign** | Cron pushes verified leads to Instantly. Daily cap: `INSTANTLY_LOAD_DAILY_CAP` (default 600); per run: `LOAD_LIMIT` (default 200). |
| **Process replies** | Cron fetches inbox, classifies replies (hot/soft/objection/negative), auto-replies to hot leads. |
| **Daily report** | Cron aggregates metrics and posts to Slack. |

## Schedule (Crontab)

**Business day:** US Eastern (`America/New_York`). **Cron on VPS:** UTC (see `cron/crontab.example`, EDT offsets documented there).

| Job | Eastern | UTC (EDT) | Script | Log |
|-----|---------|-----------|--------|-----|
| Bouncer | 5, 6, 7, 8 AM | 9–12 | `run-build-list.sh` | `logs/build-list.log` |
| Load campaign | 5:30–8:30 AM | 9:30–12:30 | `run-load-campaign.sh` | `logs/load-campaign.log` |
| Process replies | 10 AM – 9 PM (hourly) | 14–23, 0, 1 | `run-process-replies.sh` | `logs/process-replies.log` |
| Daily report | 10 PM | 02:00 | `run-daily-report.sh` | `logs/daily-report.log` |

See [cron/README.md](cron/README.md) for install and usage.

## Project structure

```
openclaw-mvp/
├── .env                    # API keys, caps (do not commit)
├── openclaw.json           # Gateway, channels, skills env
├── cron/
│   ├── crontab.example     # Crontab template (install via scripts/install-cron.sh)
│   └── jobs.json           # OpenClaw cron (disabled; we use system crontab)
├── scripts/
│   ├── run-build-list.sh   # Bouncer only (verify leads from DB)
│   ├── run-load-campaign.sh
│   ├── run-process-replies.sh
│   ├── run-daily-report.sh
│   ├── after-pull-vps.sh    # After git pull: install, build, restart
│   ├── install-cron.sh     # Install crontab from crontab.example
│   └── lib/common.sh       # Shared helpers, Slack, DB counts
└── workspace/
    ├── skills/
    │   ├── apollo/         # (Optional) Apollo search + match
    │   ├── bouncer/        # Email verification
    │   ├── instantly/      # Load leads + fetch/classify replies
    │   ├── report-build/   # Daily report aggregation
    │   ├── slack-notify/   # Send report to Slack
    │   └── csv-import/     # Import CSV/Google Sheet → DB
    ├── lib/                # Shared TS (constants, DB, Slack templates)
    └── rules/              # Workflows, playbook
```

## Setup

### 1. Dependencies

```bash
npm install -g openclaw
cd workspace && npm install
```

### 2. Environment

Copy `.env.example` to `.env` (repo root or `~/.openclaw/.env`) and set:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | LLM for agent + reply classification |
| `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN` | Slack (Socket Mode) |
| `SLACK_REPORT_CHANNEL`, `SLACK_ALERT_CHANNEL` | Report and alert channel IDs |
| `BOUNCER_API_KEY` | Bouncer email verification |
| `BOUNCER_DAILY_CAP` | Max leads to verify per day (default 300) |
| `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID` | Instantly campaign |
| `INSTANTLY_LOAD_DAILY_CAP` | Max leads to push to Instantly per day (default 600) |
| `SUPABASE_DB_URL` | PostgreSQL connection string |

### 3. Gateway

```bash
openclaw gateway
```

### 4. Crontab (VPS)

```bash
./scripts/install-cron.sh
crontab -l   # verify 4 jobs
```

## Deploy (VPS)

After `git pull`:

```bash
./scripts/after-pull-vps.sh
```

Optionally reinstall crontab if `cron/crontab.example` changed:

```bash
./scripts/install-cron.sh
```

## Run manually

```bash
./scripts/run-build-list.sh      # Bouncer only
./scripts/run-load-campaign.sh
./scripts/run-process-replies.sh
./scripts/run-daily-report.sh
```

## Agent + skills

When chatting with the agent (Slack or CLI), you can:

- **Import leads:** Use the **csv-import** skill with a CSV path or Google Sheet URL → leads go to DB as `apollo_matched`. Next Bouncer cron run will verify them.
- **Workflows:** “Run workflow: load-campaign”, “Run workflow: process-replies”, “Run workflow: daily-report” (see `workspace/rules/workflows.md`).
- **Single skills:** e.g. run bouncer, instantly, report-build, slack-notify directly.

## Pipeline limits (ENV)

Tune these in **`.env`** only — Node reads them via `workspace/lib/constants.ts`; shell cron uses the same names after `load_env` (fallbacks match **`FALLBACK_LIMITS`** in that file; run `npm run build` in `workspace/` so `lib/constants.mjs` exists for shell defaults).

| Variable | Role |
|----------|------|
| `LOAD_LIMIT` | Max verified leads per Instantly **batch** (each cron run). |
| `INSTANTLY_LOAD_DAILY_CAP` | Max leads pushed to Instantly per **Eastern calendar day**. |
| `BOUNCER_DAILY_CAP` | Max new `bouncer_verified` per **Eastern calendar day** (Bouncer cron). |

If a key is missing from `.env`, defaults come from **`FALLBACK_LIMITS`** in `constants.ts` (change numbers there to change global fallbacks).

## References

- [OpenClaw docs](https://docs.openclaw.ai)
- [cron/README.md](cron/README.md) — Crontab install and schedule
- [docs/troubleshooting.md](docs/troubleshooting.md) — Common issues
