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

## Kiểm tra skill / sub-agent đang chạy (apollo, bouncer, v.v.)

Khi bot báo "skill đang được xử lý trong phiên phụ (sub-agent)" và sẽ gửi kết quả sau, bạn có thể tự kiểm tra:

### 1. Trong Slack (nhanh nhất)

Gõ trong cùng kênh/DM với bot:

- **`/subagents list`** — xem danh sách sub-agent đang chạy (và đã xong). Mỗi dòng có run id, trạng thái.
- **`/subagents info <runId>`** — thay `<runId>` bằng id từ list; xem chi tiết: status, thời gian, session id, transcript path.
- **`/subagents log [limit]`** — xem log gần đây của sub-agent (ví dụ `/subagents log 50`).

Khi skill xong, sub-agent sẽ "announce" kết quả về kênh — bạn sẽ thấy tin nhắn mới từ bot với kết quả/nghiệm thu. Nếu không thấy sau vài phút, dùng `/subagents list` xem run đó `completed` hay còn `running` / `failed`.

### 2. Terminal (gateway đang chạy)

- Mở terminal đang chạy `openclaw gateway`, xem log: khi skill chạy sẽ có dòng kiểu `[agent/embedded]` hoặc skill name; khi xong có thể có `delivered reply to user:...`.
- **`openclaw status`** — tổng quan gateway, channels, sessions (nếu có).
- **`openclaw status --deep`** — probe sâu hơn (Slack, channels).

### 3. Nếu mãi không thấy kết quả

- Chạy **`/subagents list`** trong Slack: nếu run vẫn `running` có thể đang chờ API (Apollo, Bouncer…) hoặc bị treo; nếu `failed` thì xem `/subagents log` hoặc log gateway để biết lỗi.
- Nhắn bot: "chưa thấy kết quả apollo, kiểm tra giúp" — agent có thể gọi `/subagents list` hoặc `/subagents log` giúp bạn và báo lại.
- Chạy lại skill: "chạy lại apollo" hoặc "run apollo again".

## Delivery recovery: not_in_channel

**Log:** `[delivery-recovery] Retry failed for delivery ... An API error occurred: not_in_channel`

**Meaning:** OpenClaw cố gửi tin vào một **channel** Slack nhưng bot **chưa được mời vào channel đó** (hoặc channel ID sai).

**Cách xử lý:** Vào Slack → mở channel đích → mời app/bot vào channel. Delivery đã fail sẽ báo "1 failed"; chỉ ảnh hưởng tin đó.

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

**Meaning:** Agent đọc mô tả skill từ `workspace/skills/<name>/SKILL.md` nhưng file không tồn tại.

**Cách xử lý:** (1) Mỗi skill cần có file **SKILL.md** trong thư mục skill (repo có 5 skill: apollo, bouncer, instantly, report-build, slack-notify). (2) Đảm bảo `agents.defaults.workspace` trỏ tới thư mục workspace chứa các file đó (vd symlink `~/.openclaw/workspace` → repo `workspace/`). (3) Restart gateway sau khi sửa.

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
