# OpenClaw Outbound Automation

Autonomous outbound automation powered by **OpenClaw**. List building, campaign loading, reply processing, and daily reporting—all running on skills + cron.

## Overview

OpenClaw runs the full pipeline while Instantly handles actual email sending:

| Time (Asia/Ho_Chi_Minh) | Workflow | Action |
|-------------------------|----------|--------|
| **6:00 AM** | `build-list` | apollo → bouncer |
| **6:30 AM** | `load-campaign` | instantly (MODE=load) |
| **9:00 AM – 5:00 PM** | *(Instantly UI)* | Sending window (autopilot) |
| **6:00 PM** | `process-replies` | instantly (MODE=fetch) |
| **10:00 PM** | `daily-report` | report-build → slack-notify |

**Philosophy:** 2 emails per prospect, 45-day coverage cycle. Full TAM coverage every 45 days.

## Structure

```
~/.openclaw/  (symlink → openclaw-mvp)
├── openclaw.json       # Gateway, channels, skills env, cron config
├── .env                # API keys (do not commit)
├── cron/jobs.json      # Cron jobs (add via openclaw cron add)
└── workspace/
    ├── skills/
    │   ├── apollo/
    │   ├── bouncer/
    │   ├── instantly/
    │   ├── report-build/
    │   └── slack-notify/
    └── rules/
        ├── workflows.md            # Workflow definitions (Run workflow: &lt;name&gt;)
        ├── build-list-rules.md
        ├── campaign-rules.md
        ├── reply-classification.md
        ├── daily-schedule.md
        └── outbound-management.md   # Main playbook
```

## Setup

### 1. Install OpenClaw

Install the CLI globally (skills use a local **@openclaw/sdk** shim so they load when the gateway runs from this workspace):

```bash
npm install -g openclaw
openclaw --version  # 2026.3.2
```

Then install workspace dependencies (this also creates the `@openclaw/sdk` shim in `workspace/node_modules`):

```bash
cd workspace && npm install
```

### 2. Environment Variables

Copy `workspace/.env.example` to `~/.openclaw/.env` (or repo root `.env`) and fill in:

```bash
OPENAI_API_KEY=           # LLM for agent + reply classification (OpenAI)
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_REPORT_CHANNEL=     # Channel ID (e.g. C01234ABCDE)
APOLLO_API_KEY=
BOUNCER_API_KEY=
INSTANTLY_API_KEY=
INSTANTLY_CAMPAIGN_ID=
```

### 3. Model & LLM

- Set `agents.defaults.model` in `openclaw.json` (e.g. `openai/gpt-4o` or `anthropic/claude-opus-4-6`).
- Set `OPENAI_API_KEY` in `.env` for OpenAI, or `ANTHROPIC_API_KEY` for Anthropic.

See [OpenClaw Configuration](https://docs.openclaw.ai/gateway/configuration-reference).

### 4. Run Gateway

```bash
openclaw gateway
```

### 5. Register Cron Jobs

With the gateway running:

```bash
./scripts/register-cron-jobs.sh
openclaw cron list
```

## Slack (Socket Mode)

Slack uses **Socket Mode** by default. See [OpenClaw Slack docs](https://docs.openclaw.ai/channels/slack#socket-mode-default): enable Socket Mode in the Slack app, create an App Token (`xapp-...`) with `connections:write`, install the app and set `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` in `.env`.

### Two ways to run skills from Slack

**1. Slash commands (recommended)**  
`openclaw.json` has `channels.slack.commands.native: true` and `channels.slack.commands.nativeSkills: true`. In the Slack app you must **create slash commands** so the gateway can run skills:

- **Option A – one command:** Create a slash command named **`skill`**. Users run e.g. `/skill apollo` or `/skill build-list` (workflow = run skills in order per `rules/workflows.md`).
- **Option B – one per skill:** Create slash commands for each skill: `/apollo`, `/bouncer`, `/instantly`, `/report-build`, `/slack-notify`. Use the same Request URL as for other slash commands (your gateway’s Slack events URL).

Slack reserves `/status`; register **`/agentstatus`** for the status command. **Cách tạo từng command trong Slack:** xem [docs/slack-slash-commands.md](docs/slack-slash-commands.md). See also [Slash commands](https://docs.openclaw.ai/tools/slash-commands).

**2. Chat (workflow / “what skills”)**  
In DM or channel, the agent is instructed to treat these as workflow commands and to read `TOOLS.md` for the skill list:

- **Run workflow: build-list** — apollo → bouncer
- **Run workflow: load-campaign** — instantly (MODE=load)
- **Run workflow: process-replies** — instantly (MODE=fetch)
- **Run workflow: daily-report** — report-build → slack-notify
- **“What skills do you have?”** — agent answers using the "Runnable workspace skills" section in `TOOLS.md`.

**Setup:** If you use a **channel**, add it under `channels.slack.channels`; the bot must be in the channel and you must @mention it if `requireMention` is on. Restart the gateway after changing config.

## Workflows & skills

**Commands:** Use `Run workflow: build-list` (etc.). See `workspace/rules/workflows.md`.

| Workflow | Skills (in order) |
|----------|-------------------|
| build-list | apollo → bouncer |
| load-campaign | instantly (MODE=load) |
| process-replies | instantly (MODE=fetch) |
| daily-report | report-build → slack-notify |

| Skill | Service | Env |
|-------|---------|-----|
| apollo | Apollo Search + Match | APOLLO_API_KEY |
| bouncer | Bouncer batch verify | BOUNCER_API_KEY |
| instantly | Load leads / fetch replies / classify | INSTANTLY_API_KEY, INSTANTLY_CAMPAIGN_ID |
| report-build | Aggregate metrics | — |
| slack-notify | Slack channel | SLACK_CHANNEL (SLACK_REPORT_CHANNEL) |

## Rules

Markdown files in `workspace/rules/` define the playbook:

- **workflows.md** – Workflow names and skill order (Run workflow: &lt;name&gt;)
- **build-list-rules.md** – ICP, validation, guardrails
- **campaign-rules.md** – 2-email sequence, copy rotation, pause rules
- **reply-classification.md** – hot/soft/objection/negative, actions, escalation
- **daily-schedule.md** – 6:00 / 6:30 / 18:00 / 22:00 schedule
- **outbound-management.md** – Single reference playbook

## Cron Jobs

Per [OpenClaw Cron Jobs](https://docs.openclaw.ai/automation/cron-jobs): jobs live in `~/.openclaw/cron/jobs.json`. Config in `openclaw.json` only (enabled, store, sessionRetention, runLog).

| Name | Schedule | Timezone |
|------|----------|----------|
| 6AM - Build List | `0 6 * * *` | Asia/Ho_Chi_Minh |
| 6:30AM - Load Campaign | `30 6 * * *` | Asia/Ho_Chi_Minh |
| 6PM - Process Replies | `0 18 * * *` | Asia/Ho_Chi_Minh |
| 10PM - Daily Report | `0 22 * * *` | Asia/Ho_Chi_Minh |

## Slack

- `openclaw.json` → `channels.slack`: Socket Mode, allowFrom (Slack user IDs)
- Reports go to `SLACK_REPORT_CHANNEL`

## Commands

```bash
openclaw doctor           # Check config
openclaw gateway          # Run gateway
openclaw cron list        # List cron jobs
openclaw skill run apollo   # Run a single skill; or send "Run workflow: build-list" for full sequence
```

## Troubleshooting

- **API rate limit** (`⚠️ API rate limit reached` in logs): LLM provider (e.g. OpenAI) throttling; wait a few minutes or check usage/limits. See [docs/troubleshooting.md](docs/troubleshooting.md).
- **Slack / skills / channels:** Same doc.

## References

- [OpenClaw Pi Integration](https://docs.openclaw.ai/pi) – Embedded agent, session storage, model resolution
- [OpenClaw Cron Jobs](https://docs.openclaw.ai/automation/cron-jobs) – Scheduler, isolated runs, delivery
- [OpenClaw Configuration](https://docs.openclaw.ai/gateway/configuration-reference) – agents.defaults.model, env vars
