---
name: lead-move
description: "Move leads from one processing_status to another"
version: "1.0.0"
---

# Lead Move Skill

Moves leads in the `leads` table from one `processing_status` to another.

## Supported statuses

- `new`
- `apollo_matched`
- `bouncer_verified`
- `instantly_loaded`
- `replied`
- `failed`

## Execute

```bash
# Show supported statuses (no move)
cd ~/.openclaw && source .env && node workspace/skills/lead-move/index.mjs

# Move leads
cd ~/.openclaw && source .env && \
FROM_STATUS=failed TO_STATUS=apollo_matched node workspace/skills/lead-move/index.mjs
```

## ENV variables

- `FROM_STATUS`: current status of leads to move
- `TO_STATUS`: target status

## Common use cases

| Command | Purpose |
|---------|---------|
| `FROM_STATUS=failed TO_STATUS=apollo_matched` | Retry Bouncer on failed leads |
| `FROM_STATUS=failed TO_STATUS=new` | Reset failed leads to new |
| `FROM_STATUS=apollo_matched TO_STATUS=new` | Reset before re-running Apollo |

## When to use

- User says: "move failed leads to apollo_matched", "chuyển failed sang apollo_matched", "retry bouncer for failed"
