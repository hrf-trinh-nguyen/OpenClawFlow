# Daily Schedule

Daily run schedule for OpenClaw outbound automation. Use **workflows** for multi-step runs (see workflows.md).

## 6:00 AM – Build List

- **Workflow:** `build-list`
- Skills: apollo → bouncer
- Pull leads from Apollo, validate emails via Bouncer, save clean lead list to state

## 6:30 AM – Load Campaign

- **Workflow:** `load-campaign`
- Skill: instantly (MODE=load)
- Add verified leads from state to Instantly campaign (send schedule set in Instantly UI)

## 9:00 AM – 5:00 PM – Sending Window

- Instantly sends automatically per its UI schedule
- OpenClaw does not intervene during this window

## 6:00 PM – Process Replies

- **Workflow:** `process-replies`
- Skills: instantly (MODE=fetch, includes classify)
- Fetch replies from Instantly inbox, classify via LLM
- Log hot/soft/objection/negative counts; escalate if negative rate > 10%

## 10:00 PM – Daily Report

- **Workflow:** `daily-report`
- Skills: report-build → slack-notify
- Aggregate stats from state, send report to Slack channel
