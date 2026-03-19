# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

---

## Runnable skills (outbound pipeline)

**You have 9 skills.** When the user asks "what skills do you have", "run build-list", "run workflow build-list", etc., **run the pipeline skills** (from `~/.openclaw` with `source .env`).

| Name | What it does |
|------|--------------|
| **apollo** | Collect leads from Apollo (search + match), write to DB `apollo_matched`. |
| **bouncer** | Verify emails; update to `bouncer_verified` or `failed`. |
| **instantly** | MODE=load: push verified to campaign. MODE=fetch: fetch + classify replies. |
| `report-build` | Aggregate metrics into daily report text. |
| `slack-notify` | Send daily report to Slack. |
| `lead-stats` | Count leads by status; for failed: breakdown by processing_error. |
| `lead-move` | Move leads from one status to another (FROM_STATUS, TO_STATUS, optional LIMIT). |
| `lead-delete` | Delete leads by status (DELETE_STATUS, optional LIMIT). Permanent. |
| `reply-by-category` | Send reply template to leads with a given reply_category (hot, soft, objection). ENV: REPLY_CATEGORY or REPLY_CATEGORIES (comma), REPLY_LIMIT. |

### Workflows (run in this order)

| Workflow | Steps |
|----------|--------|
| **full** | apollo → bouncer → instantly load → instantly fetch → report-build → slack-notify (entire pipeline) |
| **build-list** | `TARGET_COUNT=10 node workspace/skills/apollo/index.mjs` → `node workspace/skills/bouncer/index.mjs` |
| **load-campaign** | `MODE=load node workspace/skills/instantly/index.mjs` |
| **process-replies** | `MODE=fetch node workspace/skills/instantly/index.mjs` |
| **daily-report** | `node workspace/skills/report-build/index.mjs` → `node workspace/skills/slack-notify/index.mjs` |

**Important:** From `cd ~/.openclaw`, run with env: `source .env` (or export vars). For daily-report skills use `OPENCLAW_STATE_DIR="$HOME/.openclaw/state"`. Run **all** steps of a workflow in one go, then one summary.

**Apollo default filters:** English-speaking US/CA only; 10–50 employees; industries: Marketing & Advertising, Computer Software/Tech, E-commerce, SaaS. Override with `ICP_MARKET=en` (US, UK, AU, CA) or `PERSON_LOCATIONS`, `ORGANIZATION_NUM_EMPLOYEES_RANGES`, `ORGANIZATION_INDUSTRY_TAG_IDS`.

**Report by date:** When user asks "show report for March 6, 2026" or "report for 6 March", parse date to `YYYY-MM-DD` (DD/MM/YYYY → 06/03/2026 = 2026-03-06) and run:
```bash
REPORT_DATE=2026-03-06 node workspace/skills/report-build/index.mjs
```

**Reply by category:** When user asks "send reply to hot leads" or "reply to leads with category soft":
```bash
REPLY_CATEGORY=hot node workspace/skills/reply-by-category/index.mjs
# Or multiple: REPLY_CATEGORIES=hot,soft,objection REPLY_LIMIT=20 node workspace/skills/reply-by-category/index.mjs
```
Requires migration 011 (email_id, eaccount in replies). Only works for replies fetched *after* that migration.

**Ref:** `rules/workflows.md`, `rules/flexible-pipeline-execution.md`.

---

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
