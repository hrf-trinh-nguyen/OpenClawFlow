---
name: slack-notify
description: "Send daily_report_text from state to Slack channel. Execute: node workspace/skills/slack-notify/index.mjs from ~/.openclaw"
---

# slack-notify

Send the daily report text (from state) to the configured Slack channel via Slack API chat.postMessage.

## Execute

Run from `~/.openclaw` with shared state:

```bash
cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" node workspace/skills/slack-notify/index.mjs
```

**Required env:** `SLACK_BOT_TOKEN`, `SLACK_REPORT_CHANNEL`
**Required state:** `state/daily_report_text.json` (from report-build)

## Workflow

Second step of `daily-report`: report-build → **slack-notify**
