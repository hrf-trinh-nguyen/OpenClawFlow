/**
 * slack-notify — standalone skill script
 * Run from ~/.openclaw: node workspace/skills/slack-notify/index.mjs
 *
 * Reads:  state/daily_report_text.json, process.env.SLACK_BOT_TOKEN, SLACK_REPORT_CHANNEL
 * Sends:  Slack message to SLACK_REPORT_CHANNEL
 */
import { stateGet } from '../../lib/state.js';
import {
  getSupabaseEnv,
  getSupabaseClient,
  createSkillExecution,
  completeSkillExecution,
  completeWorkflowRun,
} from '../../lib/supabase.js';

async function main() {
  const startTime   = Date.now();
  const botToken    = process.env.SLACK_BOT_TOKEN;
  const channel     = process.env.SLACK_REPORT_CHANNEL;

  if (!botToken || !channel) {
    console.error('Error: Missing SLACK_BOT_TOKEN or SLACK_REPORT_CHANNEL');
    process.exit(1);
  }

  const text: string = stateGet<string>('daily_report_text') ?? '';
  if (!text) {
    console.error('Error: No daily_report_text in state — run report-build first');
    process.exit(1);
  }

  // Supabase (optional)
  let supabase: any = null;
  let skillExecutionId: string | null = null;
  const workflowRunId: string | null = stateGet<string>('workflow_run_id');
  try {
    const env = getSupabaseEnv({});
    if (env && workflowRunId) {
      supabase = getSupabaseClient(env.url, env.key);
      skillExecutionId = await createSkillExecution(supabase, workflowRunId, 'slack-notify', { channel });
    }
  } catch (dbErr: any) { console.log(`  [Supabase] Warning: ${dbErr.message}`); }

  console.log(`Slack Notify – sending report to channel ${channel}`);

  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text }),
    });
    if (!resp.ok) throw new Error(`Slack API ${resp.status}: ${await resp.text()}`);
    const json = (await resp.json()) as any;
    if (!json.ok) throw new Error(`Slack error: ${json.error}`);

    console.log(`  Report sent to channel ${channel}`);

    if (supabase) {
      try {
        if (skillExecutionId) await completeSkillExecution(supabase, skillExecutionId, 'completed', { channel, sent: true }, Date.now() - startTime);
        if (workflowRunId)    await completeWorkflowRun(supabase, workflowRunId, 'completed');
        console.log('  [Supabase] Workflow run completed.');
      } catch (dbErr: any) { console.log(`  [Supabase] Warning: ${dbErr.message}`); }
    }

    console.log('Done: report sent to Slack');
  } catch (err: any) {
    if (supabase) {
      try {
        if (skillExecutionId) await completeSkillExecution(supabase, skillExecutionId, 'failed', undefined, Date.now() - startTime, err.message);
        if (workflowRunId)    await completeWorkflowRun(supabase, workflowRunId, 'failed', err.message);
      } catch {}
    }
    console.error(`Error: Slack send failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
