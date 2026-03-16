# Workflow Definitions

**For the agent:** When the user or cron sends **"Run workflow: &lt;name&gt;"** (or "run workflow &lt;name&gt;"), use the **pipeline skills** below. Run from `~/.openclaw` with env loaded (`source .env` or `export` from `.env`). Complete the entire sequence, then send **one** final summary.

---

## build-list

**Purpose:** Collect leads from Apollo (search + match), then verify emails via Bouncer. All data is database-driven (`leads` table, `processing_status`).

**Daily target: 200 `bouncer_verified` leads.** For cron, reach this target through **multiple short runs**, not one long looping run. Each run should do **one batch only** to avoid agent timeout.

**Progress check:**
```bash
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM leads WHERE processing_status='bouncer_verified' AND DATE(created_at) = CURRENT_DATE;"
```

**Run in sequence (single pass per run):**

1. **Apollo service** — collect 100 leads for this batch, write to DB with `processing_status='apollo_matched'`
   ```bash
   cd ~/.openclaw && source .env && TARGET_COUNT=100 node workspace/skills/apollo/index.mjs
   ```
2. **Bouncer service** — verify all leads with status `apollo_matched`, update to `bouncer_verified` or `failed`
   ```bash
   node workspace/skills/bouncer/index.mjs
   ```
3. **Stop after this batch** — report current daily `bouncer_verified` count. The next cron run continues progress toward the 200/day target.

**For cron:** Do not loop apollo → bouncer repeatedly inside one agent turn. Keep the run short and report progress.

**After completing:** Report step summary to Slack channel `C0A5S86QH9D`. Report any errors to `C0ALRRHK61X`.

**Command:** `Run workflow: build-list`

**Manual short-run command for chat/Slack:** Use this when you want AI to run one safe batch only and avoid timeout:
```bash
cd ~/.openclaw && source .env && TARGET_COUNT=100 node workspace/skills/apollo/index.mjs && node workspace/skills/bouncer/index.mjs
```
Recommended phrasing to AI:
- `Run one build-list batch`
- `Run build-list single batch`
- `Collect one batch only, do not loop to 200`

---

## load-campaign

**Purpose:** Push verified leads (status `bouncer_verified`) into the Instantly campaign.

**Run:**

1. **Instantly service (load)** — pull up to 100 `bouncer_verified` leads from DB, add to Instantly, set `instantly_loaded`
   ```bash
   cd ~/.openclaw && source .env && LOAD_LIMIT=100 MODE=load node workspace/skills/instantly/index.mjs
   ```

**For cron:** Keep each load run bounded to `LOAD_LIMIT=100` so large verified batches do not cause long agent turns.

**After completing:** Report step summary to Slack channel `C0A5S86QH9D`. Report any errors to `C0ALRRHK61X`.

**Command:** `Run workflow: load-campaign`

**Manual short-run command for chat/Slack:** Use this when you want AI to load a bounded batch only:
```bash
cd ~/.openclaw && source .env && LOAD_LIMIT=100 MODE=load node workspace/skills/instantly/index.mjs
```
Recommended phrasing to AI:
- `Run one load-campaign batch`
- `Load up to 100 verified leads`
- `Run load-campaign single batch`

---

## process-replies

**Purpose:** Fetch replies from Instantly and classify them with the LLM. **Default: today only** (0h-24h); never pulls all replies. Runs hourly 10AM–9PM Pacific Time.

**Run:**

1. **Instantly service (fetch + classify)** — fetch today's replies, classify hot/soft/objection/negative, send automated reply to hot leads, save to DB
   ```bash
   cd ~/.openclaw && source .env && MODE=fetch node workspace/skills/instantly/index.mjs
   ```

**After completing:** Report step summary (# replies fetched, # hot/soft/objection/negative, # replies sent) to Slack channel `C0A5S86QH9D`. Report any errors to `C0ALRRHK61X`.

**Fetch replies for a specific date:**
   ```bash
   cd ~/.openclaw && source .env && FETCH_DATE=2026-03-06 MODE=fetch node workspace/skills/instantly/index.mjs
   ```

**Fetch replies for a date range** (user provides start + end):
   ```bash
   cd ~/.openclaw && source .env && FETCH_DATE_FROM=2026-03-01 FETCH_DATE_TO=2026-03-05 MODE=fetch node workspace/skills/instantly/index.mjs
   ```

**Fetch + tổng hợp (report):**
   ```bash
   cd ~/.openclaw && source .env && \
   FETCH_DATE=$(date +%Y-%m-%d) MODE=fetch node workspace/skills/instantly/index.mjs && \
   REPORT_DATE=$(date +%Y-%m-%d) OPENCLAW_STATE_DIR="$HOME/.openclaw/state" node workspace/skills/report-build/index.mjs
   ```

**Command:** `Run workflow: process-replies` / `fetch reply hôm nay và tổng hợp`

---

## daily-report

**Purpose:** Aggregate metrics and send the daily report to Slack channel `C0A5S86QH9D`.

**Skill order:**

1. `report-build` — aggregate metrics from state → daily_report_text
2. `slack-notify` — send daily_report_text to the Slack channel (`C0A5S86QH9D`)

```bash
cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" node workspace/skills/report-build/index.mjs
cd ~/.openclaw && OPENCLAW_STATE_DIR="$HOME/.openclaw/state" node workspace/skills/slack-notify/index.mjs
```

**Note:** `SLACK_REPORT_CHANNEL` env var must be set to `C0A5S86QH9D`. Report any errors to `C0ALRRHK61X`.

**Command:** `Run workflow: daily-report`

---

## full

**Purpose:** Run the entire pipeline end-to-end: collect leads → verify → load to campaign → fetch & classify replies → build report → send to Slack.

**Run in sequence:**

1. **Apollo** — collect N leads (default 100; set `TARGET_COUNT`)
2. **Bouncer** — verify all `apollo_matched` leads
3. **Instantly (load)** — push `bouncer_verified` to campaign
4. **Instantly (fetch)** — fetch replies, classify hot/soft/objection/negative
5. **report-build** — aggregate metrics from DB
6. **slack-notify** — send daily report to Slack

```bash
cd ~/.openclaw && source .env && \
TARGET_COUNT=100 node workspace/skills/apollo/index.mjs && \
node workspace/skills/bouncer/index.mjs && \
MODE=load node workspace/skills/instantly/index.mjs && \
MODE=fetch node workspace/skills/instantly/index.mjs && \
OPENCLAW_STATE_DIR="$HOME/.openclaw/state" node workspace/skills/report-build/index.mjs && \
OPENCLAW_STATE_DIR="$HOME/.openclaw/state" node workspace/skills/slack-notify/index.mjs
```

**Command:** `Run workflow: full` or `Run full flow`

---

## Quick reference

| Workflow        | Steps |
|-----------------|--------|
| **full**        | apollo → bouncer → instantly load → instantly fetch → report-build → slack-notify |
| build-list      | apollo service → bouncer service |
| load-campaign   | instantly service (MODE=load) |
| process-replies | instantly service (MODE=fetch) |
| daily-report    | report-build → slack-notify |

**Pipeline skills** (database-driven): `workspace/skills/apollo`, `workspace/skills/bouncer`, `workspace/skills/instantly`  
**Skills** (reporting): `workspace/skills/report-build`, `workspace/skills/slack-notify`
