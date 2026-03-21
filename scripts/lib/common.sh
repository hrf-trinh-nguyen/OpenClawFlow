#!/usr/bin/env bash
# Common functions for OpenClaw shell scripts
# All business dates/times use US Eastern (America/New_York, EST/EDT).

# Ensure Eastern for script output and Node child processes when run manually
export TZ="${TZ:-America/New_York}"

# ── Environment Setup ────────────────────────────────────────────────

setup_repo_root() {
  REPO_ROOT="${OPENCLAW_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  cd "$REPO_ROOT" || exit 1
}

load_env() {
  if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$REPO_ROOT/.env"
    set +a
  fi
}

# Fill LOAD_LIMIT / INSTANTLY_LOAD_DAILY_CAP / BOUNCER_DAILY_CAP when missing.
# Numeric fallbacks come from workspace/lib/constants.mjs → FALLBACK_LIMITS (run: npm run build in workspace).
# Prefer setting all three in .env — then this only acts as safety net.
apply_limit_env_defaults() {
  local fb_load=200 fb_inst=600 fb_bouncer=600
  if [ -n "${REPO_ROOT:-}" ] && [ -f "$REPO_ROOT/workspace/lib/constants.mjs" ]; then
    local line
    line="$(
      cd "$REPO_ROOT" && node --input-type=module -e "
        import { FALLBACK_LIMITS } from './workspace/lib/constants.mjs';
        process.stdout.write(
          FALLBACK_LIMITS.LOAD_LIMIT + ' ' +
          FALLBACK_LIMITS.INSTANTLY_LOAD_DAILY_CAP + ' ' +
          FALLBACK_LIMITS.BOUNCER_DAILY_CAP
        );
      " 2>/dev/null
    )" || line=""
    if [ -n "$line" ]; then
      read -r fb_load fb_inst fb_bouncer <<< "$line"
    fi
  fi
  : "${LOAD_LIMIT:=${fb_load}}"
  : "${INSTANTLY_LOAD_DAILY_CAP:=${fb_inst}}"
  : "${BOUNCER_DAILY_CAP:=${fb_bouncer}}"
}

# ── Slack Notifications ──────────────────────────────────────────────

post_slack() {
  local channel="$1"
  local text="$2"

  if [ -z "${SLACK_BOT_TOKEN:-}" ] || [ -z "$channel" ]; then
    return 0
  fi

  curl -fsS https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"${channel}\",\"text\":$(echo "$text" | jq -Rs .)}" \
    >/dev/null 2>&1 || true
}

post_slack_report() {
  local text="$1"
  post_slack "${SLACK_REPORT_CHANNEL:-}" "$text"
}

post_slack_alert() {
  local text="$1"
  post_slack "${SLACK_ALERT_CHANNEL:-}" "$text"
}

# ── Database Queries ─────────────────────────────────────────────────

get_verified_count_today() {
  node --input-type=module <<'EOF'
import pg from 'pg';
const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
if (!conn) { console.log('0'); process.exit(0); }
const pool = new pg.Pool({ connectionString: conn });
try {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM leads
    WHERE processing_status='bouncer_verified'
      AND DATE(created_at AT TIME ZONE 'America/New_York') = (NOW() AT TIME ZONE 'America/New_York')::date
  `);
  console.log(r.rows[0]?.c ?? 0);
} catch { console.log('0'); } finally { await pool.end(); }
EOF
}

# Count leads marked instantly_loaded today (updated_at today, Eastern)
get_loaded_count_today() {
  node --input-type=module <<'EOF'
import pg from 'pg';
const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
if (!conn) { console.log('0'); process.exit(0); }
const pool = new pg.Pool({ connectionString: conn });
try {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM leads
    WHERE processing_status='instantly_loaded'
      AND DATE(updated_at AT TIME ZONE 'America/New_York') = (NOW() AT TIME ZONE 'America/New_York')::date
  `);
  console.log(r.rows[0]?.c ?? 0);
} catch { console.log('0'); } finally { await pool.end(); }
EOF
}

# Count leads inserted from Apollo today (created_at today, Eastern)
get_apollo_inserted_count_today() {
  node --input-type=module <<'EOF'
import pg from 'pg';
const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
if (!conn) { console.log('0'); process.exit(0); }
const pool = new pg.Pool({ connectionString: conn });
try {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM leads
    WHERE apollo_person_id IS NOT NULL
      AND DATE(created_at AT TIME ZONE 'America/New_York') = (NOW() AT TIME ZONE 'America/New_York')::date
  `);
  console.log(r.rows[0]?.c ?? 0);
} catch { console.log('0'); } finally { await pool.end(); }
EOF
}

# Count leads inserted by a specific Apollo batch_id
get_apollo_inserted_count_for_batch() {
  local batch_id="$1"
  node --input-type=module <<'EOF'
import pg from 'pg';
const batchId = process.env.BATCH_ID || '';
const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
if (!conn || !batchId) { console.log('0'); process.exit(0); }
const pool = new pg.Pool({ connectionString: conn });
try {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM leads WHERE batch_id = $1`,
    [batchId]
  );
  console.log(r.rows[0]?.c ?? 0);
} catch { console.log('0'); } finally { await pool.end(); }
EOF
}

# Count bouncer_verified leads for a specific Apollo batch_id
get_bouncer_verified_count_for_batch() {
  local batch_id="$1"
  node --input-type=module <<'EOF'
import pg from 'pg';
const batchId = process.env.BATCH_ID || '';
const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
if (!conn || !batchId) { console.log('0'); process.exit(0); }
const pool = new pg.Pool({ connectionString: conn });
try {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM leads
     WHERE batch_id = $1 AND processing_status = 'bouncer_verified'`,
    [batchId]
  );
  console.log(r.rows[0]?.c ?? 0);
} catch { console.log('0'); } finally { await pool.end(); }
EOF
}

# Count leads pending verification (apollo_matched, not yet verified)
get_pending_verify_count() {
  node --input-type=module <<'EOF'
import pg from 'pg';
const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
if (!conn) { console.log('0'); process.exit(0); }
const pool = new pg.Pool({ connectionString: conn });
try {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM leads
    WHERE processing_status = 'apollo_matched'
  `);
  console.log(r.rows[0]?.c ?? 0);
} catch { console.log('0'); } finally { await pool.end(); }
EOF
}

# Count verified leads ready to load (bouncer_verified, not yet loaded)
get_verified_ready_count() {
  node --input-type=module <<'EOF'
import pg from 'pg';
const conn = (process.env.SUPABASE_DB_URL || '').trim().replace(/^['"]|['"]$/g, '');
if (!conn) { console.log('0'); process.exit(0); }
const pool = new pg.Pool({ connectionString: conn });
try {
  const r = await pool.query(`
    SELECT COUNT(*)::int AS c FROM leads
    WHERE processing_status = 'bouncer_verified'
      AND (blacklisted = false OR blacklisted IS NULL)
  `);
  console.log(r.rows[0]?.c ?? 0);
} catch { console.log('0'); } finally { await pool.end(); }
EOF
}

# Current time in US Eastern (for Slack report accuracy)
get_pt_timestamp() {
  TZ=America/New_York date '+%b %d, %I:%M %p ET'
}

# Apollo runs/day guard (based on local state file, Eastern calendar date)
get_pt_date() {
  TZ=America/New_York date +%F
}

apollo_run_guard() {
  local max_runs="${1:-3}"
  local state_dir="${REPO_ROOT}/state"
  mkdir -p "$state_dir"
  local day
  day="$(get_pt_date)"
  local f="${state_dir}/apollo-runs-${day}.txt"
  local runs=0
  if [ -f "$f" ]; then
    runs="$(wc -l < "$f" | tr -d ' ')"
  fi
  if [ "$runs" -ge "$max_runs" ]; then
    echo "SKIP"
    return 0
  fi
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $(hostname) $$" >> "$f"
  echo "OK"
}

# ── Timing Utilities ─────────────────────────────────────────────────

start_timer() {
  START_TIME=$(date +%s)
}

get_duration() {
  local end_time
  end_time=$(date +%s)
  echo $((end_time - START_TIME))
}

# ── Logging ──────────────────────────────────────────────────────────

log_info() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $*"
}

log_error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

log_success() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $*"
}

# ── Error Handling ───────────────────────────────────────────────────

handle_error() {
  local script_name="$1"
  local step="$2"
  local msg="[$script_name] $step FAILED on $(hostname)"
  log_error "$msg"
  post_slack_alert "$msg"
  exit 1
}
