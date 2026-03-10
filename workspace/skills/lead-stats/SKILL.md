---
name: lead-stats
description: "Show lead pipeline statistics: count by status, failed reasons"
version: "1.0.0"
---

# Lead Stats Skill

Queries the `leads` table and aggregates:
- Count by `processing_status` (new, apollo_matched, bouncer_verified, instantly_loaded, replied, failed)
- For failed leads: breakdown by `processing_error` (reason)

## Execute

```bash
cd ~/.openclaw && source .env && node workspace/skills/lead-stats/index.mjs
```

## Output

```
── By status ──
  apollo_matched: 15
  bouncer_verified: 42
  failed: 10
  instantly_loaded: 38
  TOTAL: 105

── Failed leads by reason (processing_error) ──
  6: Email not deliverable
  4: Bouncer error: 402 Payment Required...
```

## When to use

- User asks: "how many leads", "lead stats", "thống kê lead", "có bao nhiêu lead failed"
- Before deciding to move or retry leads
