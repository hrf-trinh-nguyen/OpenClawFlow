# Reporting Flow (DB-Driven)

Report data is persisted after each skill and workflow so you can build daily and monthly reports.

---

## 1. When Data Is Saved

| When | What | Where |
|------|------|-------|
| **After each skill** | Execution metrics (input_count, output_count, failed_count, duration) | `service_executions` |
| **After each pipeline run** | Run summary (leads_processed, leads_succeeded, leads_failed) | `pipeline_runs` |
| **After report-build** | Daily aggregated metrics | `daily_reports` |

---

## 2. Daily Report

**report-build** reads from DB (not state):

- `pipeline_runs` + `service_executions` → Apollo, Bouncer, Instantly metrics by date
- `replies` → replies fetched by date
- `reply_classifications` → hot/soft/objection/negative by date

Then writes to `daily_reports` and `state/daily_report_text` (for slack-notify).

**Run:**
```bash
cd ~/.openclaw && source .env && node workspace/skills/report-build/index.mjs
```

**Optional:** `REPORT_DATE=2026-03-05` for a specific date.

---

## 3. Monthly Report

**scripts/monthly-report** aggregates `daily_reports` for a given month.

**Run:**
```bash
cd workspace && source ../.env && npm run monthly-report
```

**Optional:** `YEAR=2026 MONTH=2` for February 2026.

---

## 4. Schema

- **daily_reports**: `report_date`, `pipeline_run_id`, `person_ids_count`, `leads_pulled`, `leads_validated`, `leads_removed`, `pushed_ok`, `pushed_failed`, `replies_fetched`, `hot_count`, `soft_count`, `objection_count`, `negative_count`, `deliverable_rate`, `bounce_rate`, `spam_complaint_rate`, `report_json`
- **Migration 004**: Added `pipeline_run_id` to link to pipeline runs (optional).

---

## 5. Query Monthly Data (SQL)

```sql
SELECT report_date, person_ids_count, leads_pulled, leads_validated,
       pushed_ok, pushed_failed, replies_fetched, hot_count, soft_count,
       objection_count, negative_count
FROM daily_reports
WHERE report_date >= '2026-03-01' AND report_date < '2026-04-01'
ORDER BY report_date;
```
