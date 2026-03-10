---
name: lead-delete
description: "Delete leads by processing_status"
version: "1.0.0"
---

# Lead Delete Skill

Deletes leads from the database by `processing_status`.

## What it does

- **No params**: Lists supported statuses and usage
- **DELETE_STATUS=<status>**: Deletes all leads with that status

## Supported statuses

`new`, `apollo_matched`, `bouncer_verified`, `instantly_loaded`, `replied`, `failed`

## Execute

```bash
# Show usage
cd ~/.openclaw && source .env && node workspace/skills/lead-delete/index.mjs

# Delete all failed leads
DELETE_STATUS=failed node workspace/skills/lead-delete/index.mjs

# Delete all apollo_matched
DELETE_STATUS=apollo_matched node workspace/skills/lead-delete/index.mjs
```

## ENV variables

- `SUPABASE_DB_URL`: PostgreSQL connection (required)
- `DELETE_STATUS`: Status to delete (required when deleting)

## ⚠️ Destructive

This permanently deletes leads. Use with care.
