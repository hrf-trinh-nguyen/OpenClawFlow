# Creating Slash Commands in Slack (for OpenClaw)

To use `/skill`, `/subagents`, `/agentstatus`, etc. in Slack, you must **create each slash command** in your Slack app. Slack does not auto-generate commands from OpenClaw.

## Step 1: Open Slack App

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and sign in.
2. Select **your app** (the app used with OpenClaw, with Bot Token `xoxb-...`).

## Step 2: Go to Slash Commands

1. In the left menu, select **Slash Commands** (under **Features**).
2. Click **Create New Command**.

## Step 3: Fill in details for each command

For **each** command you want to use, create one. Fill in:

| Field | Value |
|-------|-------|
| **Command** | Command name (do not type `/`). E.g.: `skill`, `subagents`, `agentstatus`. |
| **Request URL** | With **Socket Mode** (what you're using), Slack sends payload via WebSocket so this URL is typically not called. Use a **placeholder**: `https://socket-mode.slack.com` (or any valid HTTPS URL). If you later switch to HTTP mode, change this to your real gateway URL (e.g. `https://your-domain.com/slack/events`). |
| **Short Description** | Brief description for users. E.g.: "Run a workspace skill (e.g. apollo, build-list)". |
| **Usage Hint** | (Optional) Parameter hint. E.g.: "apollo" or "list" for subagents. |

Then click **Save**.

## Commands to create

Create **at least** these commands:

| Command (in Slack) | Form "Command" field | Short Description |
|--------------------|----------------------|--------------------|
| `/skill` | `skill` | Run a workspace skill (e.g. apollo, build-list) |
| `/subagents` | `subagents` | List or inspect sub-agent runs (list, info, log, kill) |
| `/agentstatus` | `agentstatus` | Show bot status (Slack reserves `/status`, so use this name) |
| `/help` | `help` | Show help (if using native) |
| `/commands` | `commands` | List commands (if using native) |

**Note:** Slack **reserves** `/status`, so it cannot be registered; OpenClaw uses **`/agentstatus`** for status functionality.

## Step 4: Reinstall app into workspace (if needed)

- If the app is already installed in the workspace, new slash commands appear within a few seconds.
- If not installed: **Install to Workspace** (or **Reinstall**) under **Settings** → **Install App**.

## Verify

1. Open Slack (DM with bot or channel with bot).
2. Type `/` → the list will show commands you created (e.g. `/skill`, `/subagents`, `/agentstatus`).
3. Try: `/skill apollo` or `/subagents list`.

## Socket Mode vs Request URL

- You are using **Socket Mode** (`channels.slack.mode: "socket"`). Slack **does not** send slash commands via HTTP to the Request URL; it sends them over the WebSocket connection. The Request URL in the Slack form is only to "register" the command; many users use a placeholder like `https://socket-mode.slack.com`.
- If you later switch to **HTTP mode**, change the Request URL to your real gateway URL (e.g. `https://your-server.com/slack/events`) and configure Event Subscriptions / Interactivity to point to that same URL.

## References

- [Slack: Slash commands](https://api.slack.com/interactivity/slash-commands)
- [OpenClaw: Slash commands](https://docs.openclaw.ai/tools/slash-commands)
- [OpenClaw: Slack channel](https://docs.openclaw.ai/channels/slack)
