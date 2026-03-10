// lib/state.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
function getStateDir() {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  for (const levels of [2, 3]) {
    const root = resolve(scriptDir, ...Array(levels).fill(".."));
    const statePath = resolve(root, "state");
    if (existsSync(statePath)) return statePath;
  }
  return resolve(scriptDir, "../../..", "state");
}
var STATE_DIR = getStateDir();
function stateGet(key) {
  try {
    return JSON.parse(readFileSync(resolve(STATE_DIR, `${key}.json`), "utf8"));
  } catch {
    return null;
  }
}

// skills/slack-notify/index.ts
async function main() {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_REPORT_CHANNEL;
  if (!botToken || !channel) {
    console.error("Error: Missing SLACK_BOT_TOKEN or SLACK_REPORT_CHANNEL");
    process.exit(1);
  }
  const text = stateGet("daily_report_text") ?? "";
  if (!text) {
    console.error("Error: No daily_report_text in state \u2014 run report-build first");
    process.exit(1);
  }
  console.log(`Slack Notify \u2013 sending report to channel ${channel}`);
  try {
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text })
    });
    if (!resp.ok) throw new Error(`Slack API ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(`Slack error: ${json.error}`);
    console.log(`  Report sent to channel ${channel}`);
    console.log("Done: report sent to Slack");
  } catch (err) {
    console.error(`Error: Slack send failed: ${err.message}`);
    process.exit(1);
  }
}
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
