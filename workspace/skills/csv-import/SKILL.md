---
name: csv-import
description: "Import leads from CSV file or Google Sheet public link into DB with status='apollo_matched'"
version: "1.0.0"
---

# CSV Import Service

Import leads from CSV file (local) or Google Sheet (public link) into the database, ready for Bouncer verification.

## What it does

1. **Parse source**: CSV file path OR Google Sheet public URL
2. **Fetch data**: Read local file or download Google Sheet as CSV
3. **Batch insert**: Insert leads in batches (default 50 rows) with delay
4. **Deduplicate**: Skip emails already in DB or duplicated in source
5. **Set status**: `processing_status='apollo_matched'` so leads go through Bouncer

## Parameters (ENV variables)

- `CSV_SOURCE`: **Required**. Either:
  - Local file path: `/path/to/file.csv` or `csv/apollo-export.csv`
  - Google Sheet public URL: `https://docs.google.com/spreadsheets/d/SHEET_ID/...`
- `CSV_BATCH_SIZE`: Rows per batch (default: 50)
- `CSV_BATCH_DELAY`: Delay between batches in ms (default: 500)
- `BATCH_ID`: Optional batch identifier (auto-generated if not provided)

## CSV/Sheet Column Mapping

| Source Column        | DB Column (leads) | Notes            |
|---------------------|-------------------|------------------|
| First Name          | first_name        | Required         |
| Last Name           | last_name         | Required         |
| Title               | title             | Required         |
| Company Name        | company_name      | Required         |
| Email               | email             | Required, UNIQUE |
| Person Linkedin Url | linkedin_url      | Optional         |

Other columns (Website, Company Linkedin Url, etc.) are ignored.

**Default values for missing fields:**
- `processing_status` = `'apollo_matched'`
- `source` = `'import'`
- `email_status` = `'unknown'`
- `priority` = `0`

## Execute

### From local CSV file:

```bash
cd ~/.openclaw && source .env
CSV_SOURCE="csv/apollo-contacts-export-200.csv" \
node workspace/skills/csv-import/index.mjs
```

### From Google Sheet public link:

```bash
cd ~/.openclaw && source .env
CSV_SOURCE="https://docs.google.com/spreadsheets/d/1ABC.../edit#gid=0" \
node workspace/skills/csv-import/index.mjs
```

**Important:** The Google Sheet must be **publicly accessible** (Anyone with the link can view).

## Output

Leads written to database with:
- `processing_status='apollo_matched'` (ready for Bouncer)
- `source='import'`
- `batch_id` for grouping

## Log Output

```
=== CSV Import Service ===
   Source: https://docs.google.com/spreadsheets/d/1ABC.../edit
   Batch ID: csv-gsheet-1710756000
   Total rows: 200
   Valid leads (with email): 198
   Skipped invalid/missing email rows: 2

[batch 1/4] inserted: 48, skipped_existing: 2, skipped_dup: 0, skipped_insert: 0
[batch 2/4] inserted: 50, skipped_existing: 0, skipped_dup: 0, skipped_insert: 0
...

=== Done: 196 inserted | skipped_existing 2 | skipped_dup 0 | skipped_invalid_email 2 | skipped_insert 0 ===
```

## After Import

Run Bouncer to verify emails:

```bash
node workspace/skills/bouncer/index.mjs
```

## Error Handling

- **Invalid email**: Skipped (logged as `skipped_invalid_email`)
- **Duplicate in DB**: Skipped (logged as `skipped_existing`)
- **Duplicate in source**: Skipped (logged as `skipped_dup`)
- **Insert error**: Logged with email and error message

## Database Tables Updated

- `leads`: inserted with new lead data
