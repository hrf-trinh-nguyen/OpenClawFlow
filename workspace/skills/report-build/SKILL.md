---
name: report-build
description: "Aggregate pipeline metrics from state into daily report text. Execute: node workspace/skills/report-build/index.mjs from ~/.openclaw"
---

# report-build

Reads all pipeline metrics from state (apollo/bouncer/instantly/replies counts) and builds a formatted daily report. No external API calls.

## Execute

Run from `~/.openclaw` with shared state:

```bash
cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" node workspace/skills/report-build/index.mjs
```

No required env vars. Reads from state files.

## State output

- `state/daily_report.json` — structured report object
- `state/daily_report_text.json` — formatted Slack-ready report string

## Workflow

First step of `daily-report`: **report-build** → slack-notify
