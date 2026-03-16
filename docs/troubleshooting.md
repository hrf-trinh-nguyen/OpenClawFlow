# Troubleshooting

## API rate limit reached (LLM)

**Log:** `[agent/embedded] embedded run agent end: ... isError=true error=⚠️ API rate limit reached. Please try again later.`

**Meaning:** The LLM provider (e.g. OpenAI for `openai/gpt-4o`) is rejecting requests because you exceeded its rate limit (requests per minute or per day).

**Causes:**
- Several Slack messages or retries in a short time
- Multiple concurrent agent runs (e.g. cron + Slack at once)
- Tier limits (free or low-tier keys have lower RPM)

**What to do:**
1. **Wait a few minutes** and try again; limits usually reset per minute.
2. **Check usage:** [OpenAI Usage](https://platform.openai.com/usage) (or your provider’s dashboard) for limits and current usage.
3. **Reduce concurrency:** `cron.maxConcurrentRuns: 1` (you already have this) avoids overlapping cron jobs; avoid triggering many Slack conversations at once.
4. **Upgrade tier** if you need higher RPM (e.g. OpenAI paid tier).
5. **Backoff:** OpenClaw may retry; if you see “deferred (backoff)” in delivery-recovery, that’s normal.

The agent can still complete and deliver a reply after some retries; the log just shows failed attempts before success.

## Slack: config reload / channel restart

**Log:** `[reload] config change detected; evaluating reload (channels.slack.commands)` then `[gateway/channels] restarting slack channel`.

**Meaning:** You changed `openclaw.json` (e.g. `channels.slack.commands`) and the gateway applied a hot reload and restarted the Slack connection.

**What to do:** Nothing. This is expected. Socket reconnects (`[slack] socket mode connected`) and the new config is active.

## Gateway receives SIGTERM and shuts down immediately

**Log:** `[gateway] signal SIGTERM received` then `[gateway] received SIGTERM; shutting down` — gateway exits within 1–2 seconds of startup. Slack may show `WebSocket was closed before the connection was established`.

**Meaning:** Something is sending SIGTERM to the OpenClaw process. The Slack WebSocket error is a *consequence* of shutdown, not the cause.

**Possible causes:**
1. **Health monitor** — OpenClaw’s health monitor may kill the gateway if it considers Slack connection unhealthy. Try disabling it.
2. **Another process** — e.g. `pkill openclaw`, a different terminal, or a conflicting systemd service.
3. **Duplicate run** — An old gateway instance or wrapper that detects a second start and kills it.

**What to do:**
1. **Disable health monitor** — In `openclaw.json` under `gateway`, add: `"channelHealthCheckMinutes": 0`. Then fully restart (stop process, start again; hot-reload does not apply).
2. **Check for other OpenClaw processes:** `pgrep -af "openclaw"` — ensure no duplicates.
3. **Check systemd:** `systemctl status openclaw` — if a service exists, stop/disable it before running manually: `sudo systemctl stop openclaw`.
4. **Run in foreground** — Use `./scripts/start-openclaw.sh` and keep the terminal open; avoid closing it right after start.

## Checking skill / sub-agent status (apollo, bouncer, etc.)

When the bot says "skill is being processed in a sub-agent session" and will send results later, you can check progress yourself:

### 1. In Slack (fastest)

Type in the same channel/DM with the bot:

- **`/subagents list`** — See the list of sub-agents currently running (and completed). Each row shows run id and status.
- **`/subagents info <runId>`** — Replace `<runId>` with the id from the list; view details: status, timing, session id, transcript path.
- **`/subagents log [limit]`** — View recent sub-agent logs (e.g. `/subagents log 50`).

When the skill finishes, the sub-agent will "announce" the result to the channel — you'll see a new message from the bot with the result. If you don't see it after a few minutes, use `/subagents list` to check if the run is `completed` or still `running` / `failed`.

### 2. Terminal (gateway running)

- Open the terminal running `openclaw gateway`, watch the log: when a skill runs you'll see lines like `[agent/embedded]` or the skill name; when done you may see `delivered reply to user:...`.
- **`openclaw status`** — Overview of gateway, channels, sessions (if any).
- **`openclaw status --deep`** — Deeper probe (Slack, channels).

### 3. If you still don't see results

- Run **`/subagents list`** in Slack: if the run is still `running`, it may be waiting on APIs (Apollo, Bouncer…) or stuck; if `failed`, check `/subagents log` or gateway logs for the error.
- Message the bot: "still no apollo result, please check" — the agent can run `/subagents list` or `/subagents log` for you and report back.
- Re-run the skill: "run apollo again" or "run apollo again".

## Delivery recovery: not_in_channel

**Log:** `[delivery-recovery] Retry failed for delivery ... An API error occurred: not_in_channel`

**Meaning:** OpenClaw tried to send a message to a Slack **channel** but the bot **has not been invited to that channel** (or the channel ID is wrong).

**Fix:** In Slack → open the target channel → invite the app/bot to the channel. Failed delivery will report "1 failed"; only that message is affected.

## MODULE_NOT_FOUND: apollo-search (build-list fails)

**Error:** `cannot find module workspace/skills/apollo-search/index.mjs under ~/.openclaw (MODULE_NOT_FOUND)`

**Cause:** Agent or gateway is using a stale skills cache that still references old skill names (`apollo-search`, `apollo-match`, `bouncer-verify`). Those were consolidated into `apollo` and `bouncer`.

**Fix:**
1. **Restart the gateway** so it rescans `workspace/skills/` and drops the stale cache: stop `openclaw gateway` (Ctrl+C), then run it again.
2. (Optional) Clear session state before restart: `rm -f ~/.openclaw/state/agents/main/sessions/sessions.json` — gateway will recreate it with correct skills.
3. Ensure `workspace/AGENTS.md` and `rules/workflows.md` reference only `apollo`, `bouncer`, `instantly`, `report-build`, `slack-notify`.

## MODULE_NOT_FOUND: apollo-search (build-list fails)

**Error:** `cannot find module workspace/skills/apollo-search/index.mjs under ~/.openclaw (MODULE_NOT_FOUND)`

**Cause:** Agent or gateway is using a stale skills cache that still references old skill names (`apollo-search`, `apollo-match`, `bouncer-verify`). Those skills were consolidated into `apollo` and `bouncer`.

**Fix:**
1. **Restart the gateway** so it rescans `workspace/skills/` and drops the stale cache.
2. (Optional) Remove cached sessions before restart: `rm -f ~/.openclaw/state/agents/main/sessions/sessions.json`
3. Ensure agent guidance uses only current skills: `apollo`, `bouncer`, `instantly`, `report-build`, `slack-notify`. See `workspace/AGENTS.md` and `rules/workflows.md`.

## SKILL.md not found (ENOENT)

**Log:** `[tools] read failed: ENOENT: ... access '.../workspace/skills/apollo/SKILL.md'`

**Meaning:** The agent reads skill descriptions from `workspace/skills/<name>/SKILL.md` but the file does not exist.

**Fix:** (1) Each skill must have a **SKILL.md** file in its folder (repo has 5 skills: apollo, bouncer, instantly, report-build, slack-notify). (2) Ensure `agents.defaults.workspace` points to the workspace directory containing those files (e.g. symlink `~/.openclaw/workspace` → repo `workspace/`). (3) Restart the gateway after changes.

## Cannot find module '@openclaw/sdk'

**Log:** Skill run fails with `Cannot find module '@openclaw/sdk'` (or similar).

**Meaning:** Skills import `Skill`, `SkillContext`, `SkillResult` from `@openclaw/sdk`. When OpenClaw is installed globally (`npm install -g openclaw`), that package does not live in the workspace, so Node cannot resolve it when the gateway runs skills from the workspace directory.

**Fix (already applied in this repo):**

1. **Do not** add `@openclaw/sdk` to `workspace/package.json` (it is not on the public npm registry).
2. A **shim** is used instead: `workspace/node_modules/@openclaw/sdk` is created by the `postinstall` script (`scripts/ensure-openclaw-sdk-shim.mjs`). It exports the types and minimal runtime values so that:
   - The module resolves when the gateway runs the skill.
   - TypeScript types (`Skill`, `SkillContext`, `SkillResult`) match what the skills use.
3. Run **`npm install`** in the workspace once (e.g. after clone). This runs `postinstall` and creates the shim.
4. Start the gateway as usual: **`openclaw gateway`** (no `NODE_PATH` needed).

If you removed `node_modules` or the shim, run again: `cd workspace && npm install`.

---

## No person_ids in state / No leads in state (workflow from Slack)

**Symptom:** When you run "Run workflow: build-list" from Slack, apollo succeeds but bouncer fails with "No leads in state" (or similar).

**Cause:** All workflow steps must use the **same** state directory. If `OPENCLAW_STATE_DIR` is not set, each step may use a different path.

**Fix:** (1) Add `OPENCLAW_STATE_DIR=/home/os/openclaw-mvp/state` to your `.env` (absolute path to your project's `state` folder). (2) Restart the gateway. (3) Each skill in `openclaw.json` already has `OPENCLAW_STATE_DIR` in env. Then run "Run workflow: build-list" again.

---

## Other issues

- **Slack “Sending messages to this app has been turned off”** → In Slack app: App Home → Messages Tab: allow users to send messages.
- **Bot says it doesn’t have workspace skills** → Ensure `workspace/AGENTS.md` includes the “Workspace skills (this project)” section and the workspace path in `agents.defaults.workspace` points to that workspace.
- **Channel not found / not_in_channel** → Add the channel under `channels.slack.channels` and invite the bot to the channel.
