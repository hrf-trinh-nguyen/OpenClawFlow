---
name: reply-by-category
description: "Send Instantly reply template to leads with a specific reply_category (hot, soft, objection)"
version: "1.0.0"
---

# Reply By Category Skill

Queries the `replies` table for threads with the given `reply_category` that have NOT been replied yet, then sends the standard hot-reply template via Instantly API.

## Parameters (env)

| Variable | Description | Default |
|----------|-------------|---------|
| `REPLY_CATEGORY` | Single category: hot, soft, objection | — |
| `REPLY_CATEGORIES` | Comma-separated list, e.g. `hot,soft` | — |
| `REPLY_LIMIT` | Max replies to send per run | 50 |

Use **one** of `REPLY_CATEGORY` or `REPLY_CATEGORIES`. If both set, `REPLY_CATEGORIES` takes precedence.

## Requirements

- `replies` table must have `email_id` and `eaccount` (run migration `011_replies_email_id_eaccount.sql`)
- Only replies fetched **after** that migration will have these fields; older rows are skipped
- `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID`, `SUPABASE_DB_URL` must be set

## Execute

```bash
cd ~/.openclaw && source .env && REPLY_CATEGORY=soft node workspace/skills/reply-by-category/index.mjs
```

Or via Agent: "Send reply to leads with reply_category soft" → Agent sets `REPLY_CATEGORY=soft` and runs the skill.

## When to use

- User says: "send reply to hot leads that haven't been replied yet"
- User says: "reply to soft leads", "reply to objection leads"
- User provides a category (hot, soft, objection) and wants to send the Book now + Compare template
