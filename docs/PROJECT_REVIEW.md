# OpenClaw Project Review (Senior)

Review of the OpenClaw outbound automation project: structure, alignment with OpenClaw patterns, and recommended fixes.

---

## 1. What’s Working Well

### 1.1 Skill layout
- **5 skills** under `workspace/skills/`: apollo, bouncer, instantly, report-build, slack-notify.
- Pipeline skills (apollo → bouncer → instantly) are **DB-driven** via `processing_status`; no shared file state between them.
- Clear split: pipeline (apollo, bouncer, instantly) vs reporting (report-build, slack-notify).

### 1.2 OpenClaw config
- **openclaw.json**: gateway, Slack channel, cron, skill entries with env (API keys, `OPENCLAW_STATE_DIR`).
- **Cron** (`cron/jobs.json`): 6AM build-list, 6:30 load-campaign, 18:00 process-replies, 22:00 daily-report; timezone Asia/Ho_Chi_Minh.
- **Channels**: Slack socket mode, allowlist, native commands so the agent can run skills from Slack.

### 1.3 Agent instructions
- **AGENTS.md**: 5 skills, workflows, pipeline (build-list, load-campaign, process-replies, daily-report).
- **rules/workflows.md**: exact bash commands for each workflow.
- **rules/flexible-pipeline-execution.md**: natural-language → params, DB status flow, examples.
- **TOOLS.md**: runnable skills and workflow table.

### 1.4 Database
- **Supabase (pg)**: single connection via `SUPABASE_DB_URL`; no Supabase JS client.
- **001**: leads, campaigns, workflow_runs, skill_executions, daily_reports, etc.
- **003**: pipeline_runs, service_executions, lead processing_status (new, apollo_matched, bouncer_verified, instantly_loaded, replied, failed).
- Pipeline skills use 003; report-build/slack-notify use 001 (workflow_runs, skill_executions).

### 1.5 State resolution
- **lib/state.ts**: `OPENCLAW_STATE_DIR` or resolve from script path so state dir is consistent when running from Slack/cron.

---

## 2. Critical Gaps

### 2.1 Daily report sees no pipeline data (report-build vs pipeline)

**Issue:**  
report-build reads **only state** (e.g. `person_ids_count`, `leads_pulled`, `leads_validated`, `pushed_ok`, `replies_fetched`, `hot_count`, …).  
Pipeline skills (apollo, bouncer, instantly) **do not write these state keys**; they only write to the DB (leads, pipeline_runs, service_executions).

**Effect:**  
If you only run the new pipeline (build-list → load-campaign → process-replies), report-build will always aggregate **zeros** and the daily report will be empty/meaningless.

**Options:**

1. **Bridge state (short term)**  
   In apollo, bouncer, instantly (or in a small “report-bridge” step): after each run, set the same state keys report-build expects (e.g. from DB counts), e.g. `stateSet('leads_pulled', count)`, `stateSet('leads_validated', count)`, etc., so report-build keeps working as-is.

2. **Make report-build DB-driven (recommended)**  
   Change report-build to:
   - Read metrics from DB: counts from `leads` (by `processing_status`), from `pipeline_runs` / `service_executions`, and from `replies` (or reply classifications) for the report date range.
   - Optionally keep state as a fallback for backward compatibility.
   - Then one source of truth (DB) for both pipeline and report.

### 2.2 workflow_run_id never set for pipeline runs

**Issue:**  
report-build and slack-notify use `stateGet('workflow_run_id')` and call `createSkillExecution(supabase, workflowRunId, …)`, `completeWorkflowRun(supabase, workflowRunId, …)`.  
Pipeline workflows (build-list, load-campaign, process-replies) **never** create a `workflow_runs` row or set `workflow_run_id` in state.

**Effect:**  
- report-build/slack-notify will not attach to any workflow run when run after build-list/load-campaign/process-replies.
- No linkage in DB between “build-list run” and “daily report run” for the same day.

**Options:**

1. **Start a workflow run for build-list**  
   When the agent starts build-list, first create a row in `workflow_runs` (e.g. `build_list`), put its id in state (`workflow_run_id`), then run apollo → bouncer. Same idea for load-campaign and process-replies if you want one run per workflow. report-build and slack-notify then keep using `workflow_run_id` from state.

2. **Unify on pipeline_runs**  
   Treat pipeline_runs as the canonical “run” and have report-build (and optionally slack-notify) accept a pipeline_run_id or “today’s” pipeline runs instead of workflow_run_id. This implies report-build (and possibly slack) using the same DB model as the pipeline (003) and possibly deprecating workflow_run_id for these flows.

### 2.3 Workspace path vs project path

**Issue:**  
`openclaw.json` has `agents.defaults.workspace: "/home/os/.openclaw/workspace"`. The repo is at `/home/os/openclaw-mvp`. So either:

- The “real” workspace is `~/.openclaw/workspace` (e.g. symlink or copy of `openclaw-mvp/workspace`), and state is under `openclaw-mvp/state` or `~/.openclaw/state`, or  
- You run from `openclaw-mvp` but the config still points at `~/.openclaw/workspace`.

**Effect:**  
If the agent runs `cd ~/.openclaw && ... node workspace/skills/apollo/index.mjs`, it must see the same workspace and (if used) state that you expect. Mismatch causes “wrong directory” or “state not found”.

**Recommendation:**  
- Either set `workspace` to the path that actually contains `workspace/skills` (e.g. `openclaw-mvp` if you run from repo root), or  
- Document that the deploy copies/symlinks `openclaw-mvp/workspace` to `~/.openclaw/workspace` and set `OPENCLAW_STATE_DIR` to one canonical state dir (e.g. `openclaw-mvp/state` or `~/.openclaw/state`) everywhere.

---

## 3. Design / Consistency

### 3.1 Two DB “worlds” (001 vs 003)

- **001**: workflow_runs, skill_executions, daily_reports — used by report-build, slack-notify (supabase.ts).
- **003**: pipeline_runs, service_executions, leads.processing_status — used by apollo, bouncer, instantly (supabase-pipeline.ts).

So you have two tracking models. That’s workable but adds cognitive and maintenance load. Long term, either:

- Migrate report (and optionally Slack) to 003 (pipeline_runs as the run record), or  
- Keep 001 for “legacy” reporting but have pipeline skills also write a minimal workflow_runs row and set `workflow_run_id` in state so report/slack can attach to it.

### 3.2 supabase.ts vs supabase-pipeline.ts vs supabase-legacy.ts

- **supabase.ts**: full-featured (workflow_runs, skill_executions, daily_reports, leads, replies, …); used by report-build, slack-notify.
- **supabase-pipeline.ts**: pipeline_runs, service_executions, leads by status; used by apollo, bouncer, instantly.
- **supabase-legacy.ts**: only `createWorkflowRun`, `logApolloSearch`; not referenced by any current skill.

Recommendation:  
- Keep supabase.ts for report/slack and 001 schema.  
- Keep supabase-pipeline.ts for pipeline.  
- Remove or repurpose supabase-legacy.ts if you don’t plan to use it (e.g. merge the helpers into supabase.ts if still needed).

### 3.3 Skill env in openclaw.json

Pipeline skills need **SUPABASE_DB_URL** at runtime. It’s not in `skills.entries.*.env` today. Docs say “source .env” before running; that works if the agent always runs in a shell that has loaded `.env`. If the gateway ever runs skills with only openclaw.json env, DB would be missing.

Recommendation:  
Add `SUPABASE_DB_URL` to the env of apollo, bouncer, and instantly in openclaw.json (or document that gateway must be started with .env loaded so all child processes inherit it).

---

## 4. OpenClaw Best-Practice Alignment

| Aspect | Status | Note |
|--------|--------|------|
| Skills as runnable scripts | OK | Skills are `node workspace/skills/.../index.mjs` with env. |
| State dir consistency | OK | OPENCLAW_STATE_DIR + state.ts resolution. |
| Workflow = agent runs sequence | OK | workflows.md + AGENTS.md describe running full sequence in one turn. |
| Cron → agent message | OK | Cron sends “Run workflow: build-list” etc. |
| Slack as channel | OK | Slack socket, allowlist, commands. |
| Single source of truth for runs | Partial | Two run models (workflow_runs vs pipeline_runs); report uses workflow_run_id from state that pipeline doesn’t set. |
| Report reflects pipeline | No | report-build reads state only; pipeline doesn’t write that state. |

---

## 5. Recommended Action List (Priority)

1. **High – Report uses pipeline data**  
   - Either: have pipeline skills (or a bridge) write the state keys report-build expects, or  
   - Prefer: make report-build read from DB (leads by status, pipeline_runs, service_executions, replies) for the report period.

2. **High – workflow_run_id for daily-report**  
   - When starting build-list (and optionally load-campaign / process-replies), create a `workflow_runs` row and set `workflow_run_id` in state so report-build and slack-notify can attach to it, or  
   - Move report/slack to use pipeline_runs and stop relying on workflow_run_id.

3. **Medium – Workspace path**  
   - Align `openclaw.json` workspace with actual project/deploy path and document where state lives (`OPENCLAW_STATE_DIR`).

4. **Medium – SUPABASE_DB_URL for pipeline skills**  
   - Add to openclaw.json env for apollo, bouncer, instantly (or document that .env is always loaded in the execution environment).

5. **Low – Dead code**  
   - Remove or integrate supabase-legacy.ts.

6. **Low – SOUL.md / USER.md**  
   - AGENTS.md refers to them; add minimal files if you want the agent to follow them, or adjust AGENTS.md so it doesn’t assume they exist.

---

## 6. Summary

- **Strengths:** Clear skill layout, DB-driven pipeline, good docs and cron/Slack setup, single DB URL, sensible state dir handling.
- **Main risks:** Daily report is disconnected from pipeline (state not written by pipeline; workflow_run_id not set), and workspace/path vs state dir can cause confusion.
- **Direction:** Unify “run” and “report” either by bridging state + workflow_run_id for the current report, or by making report (and optionally Slack) read from the same DB model as the pipeline (003) and optionally deprecating workflow_run_id for these flows.
