# Contributing to OpenClaw

This document outlines coding standards and guidelines for the OpenClaw pipeline project. Following these standards ensures consistency and enables AI agents to make accurate changes.

## Project Structure

```
openclaw-mvp/
├── workspace/                    # TypeScript source code
│   ├── lib/                      # Shared libraries
│   │   ├── constants.ts          # All constants, enums, magic strings
│   │   ├── errors.ts             # Custom error classes
│   │   ├── logger.ts             # Structured logging
│   │   ├── utils.ts              # Utility functions
│   │   ├── supabase-pipeline.ts  # Database operations
│   │   └── slack-templates.ts    # Slack message builders
│   ├── skills/                   # Pipeline services
│   │   ├── bouncer/              # Email verification
│   │   │   ├── index.ts          # Main entry point
│   │   │   ├── api.ts            # Bouncer API client
│   │   │   └── pause.ts          # Pause file management
│   │   ├── instantly/            # Email campaign
│   │   │   ├── index.ts          # Main entry point
│   │   │   ├── api.ts            # Instantly API client
│   │   │   ├── load.ts           # Load service
│   │   │   ├── fetch.ts          # Fetch & classify service
│   │   │   ├── classify.ts       # LLM classification
│   │   │   └── templates.ts      # Email templates
│   │   └── ...
│   └── rules/                    # Agent rules and schedules
├── scripts/                      # Shell scripts for cron
│   ├── lib/common.sh             # Shared shell functions
│   ├── run-build-list.sh         # Bouncer cron wrapper
│   ├── run-load-campaign.sh      # Instantly load cron wrapper
│   └── run-process-replies.sh    # Process replies cron wrapper
├── cron/                         # Cron configuration
│   ├── crontab.example           # System crontab (authoritative)
│   └── README.md                 # Schedule documentation
└── supabase/                     # Database migrations
```

## Coding Standards

### 1. Use Constants for Magic Strings

**Bad:**
```typescript
if (status === 'bouncer_verified') { ... }
await batchUpdateLeadStatus(db, ids, 'failed', 'Email not deliverable');
```

**Good:**
```typescript
import { LEAD_STATUS, FAILURE_REASON } from '../../lib/constants.js';

if (status === LEAD_STATUS.BOUNCER_VERIFIED) { ... }
await batchUpdateLeadStatus(db, ids, LEAD_STATUS.FAILED, FAILURE_REASON.EMAIL_NOT_DELIVERABLE);
```

### 2. Use Custom Error Classes

**Bad:**
```typescript
throw new Error('Bouncer submit failed: 402');
```

**Good:**
```typescript
import { BouncerApiError } from '../../lib/errors.js';

throw new BouncerApiError('submit', 402, 'Payment required');
```

### 3. Extract Error Messages Safely

**Bad:**
```typescript
} catch (error: any) {
  console.error(error.message);
}
```

**Good:**
```typescript
import { getErrorMessage } from '../../lib/errors.js';

} catch (error: unknown) {
  console.error(getErrorMessage(error));
}
```

### 4. Keep Files Small and Focused

- **Max ~300 lines per file** - split larger files into modules
- **One responsibility per file** - API client, service logic, utilities
- **Clear naming** - `api.ts`, `load.ts`, `classify.ts`

### 5. Export Types Alongside Functions

```typescript
// api.ts
export interface AddLeadsResult {
  success: number;
  failed: number;
  successIds: string[];
}

export async function addLeads(...): Promise<AddLeadsResult> { ... }
```

### 6. Document ENV Dependencies

At the top of each skill's `index.ts`:

```typescript
/**
 * ENV variables:
 * - BOUNCER_API_KEY: Bouncer API key (required)
 * - BOUNCER_BATCH_SIZE: emails per API batch (default: 100)
 * - SUPABASE_DB_URL: PostgreSQL connection string (required)
 */
```

### 7. Use Consistent Import Paths

Always use `.js` extension for local imports (required for ESM):

```typescript
import { sleep } from '../../lib/utils.js';
import { submitBatch } from './api.js';
```

## Shell Script Standards

### 1. Use Common Functions

```bash
source "$SCRIPT_DIR/lib/common.sh"

setup_repo_root
load_env
apply_limit_env_defaults
```

### 2. Add Error Trapping

```bash
set -euo pipefail
trap 'log_error "Error at line $LINENO"; exit 1' ERR
```

### 3. Use Logging Functions

```bash
log_info "Starting Bouncer"
log_success "Completed in ${DURATION}s"
log_error "Failed: $msg"
```

## Database Operations

### 1. Use Provided Functions

```typescript
import {
  getDb,
  createPipelineRun,
  updatePipelineRun,
  batchUpdateLeadStatus,
} from '../../lib/supabase-pipeline.js';
```

### 2. Always Close Connections

```typescript
const db = getDb();
try {
  // ... operations
} finally {
  await db.end();
}
```

## Error Handling Patterns

### API Errors with Partial Success

```typescript
try {
  const result = await addLeads(apiKey, campaignId, leads);
} catch (error: unknown) {
  if (isInstantlyApiError(error) && error.partialSuccessIds.length > 0) {
    // Persist partial success before re-throwing
    await batchUpdateLeadStatus(db, error.partialSuccessIds, LEAD_STATUS.INSTANTLY_LOADED);
  }
  throw error;
}
```

### Pipeline Abort Pattern

```typescript
if (shouldAbort) {
  await postToAlertChannel('Pipeline stopped');
  throw new PipelineAbortError('bouncer', 'Unexpected status');
}
```

## Testing Changes

### Build TypeScript

```bash
cd workspace && npm run build
```

### Run Locally

```bash
# Bouncer
BOUNCER_LIMIT=10 node workspace/skills/bouncer/index.mjs

# Instantly Load
MODE=load LOAD_LIMIT=5 node workspace/skills/instantly/index.mjs

# Process Replies
MODE=fetch FETCH_DATE=2024-01-15 node workspace/skills/instantly/index.mjs
```

### Check Cron Scripts

```bash
# Dry run (check env vars)
bash -x scripts/run-build-list.sh

# Install crontab
./scripts/install-cron.sh
```

## Checklist for AI Agents

When making changes:

1. [ ] Use constants from `lib/constants.ts` for status strings
2. [ ] Use error classes from `lib/errors.ts` for exceptions
3. [ ] Keep files under 300 lines
4. [ ] Add `.js` extension to all local imports
5. [ ] Run `npm run build` after TypeScript changes
6. [ ] Test cron scripts still work after shell changes
7. [ ] Update `CONTRIBUTING.md` if adding new patterns

## Common Pitfalls

1. **Missing `.js` in imports** - ESM requires file extensions
2. **Using `any` type** - Use `unknown` and type guards
3. **Hardcoded strings** - Add to `constants.ts`
4. **Large files** - Split into focused modules
5. **Unclosed DB connections** - Use `try/finally` with `db.end()`
