/**
 * File-based state for standalone skill scripts.
 * State files live at <project_root>/state/<key>.json
 *
 * STATE_DIR is resolved from the script location so all skills share the same
 * state regardless of cwd or HOME (fixes "No person_ids in state" when running
 * workflows from Slack).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

function getStateDir(): string {
  if (process.env.OPENCLAW_STATE_DIR) return process.env.OPENCLAW_STATE_DIR;
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  // workspace/lib/state.ts -> 2 levels up = project root. workspace/skills/x/index.mjs -> 3 levels up.
  for (const levels of [2, 3]) {
    const root = resolve(scriptDir, ...Array(levels).fill('..'));
    const statePath = resolve(root, 'state');
    if (existsSync(statePath)) return statePath;
  }
  return resolve(scriptDir, '../../..', 'state');
}

export const STATE_DIR = getStateDir();

export function stateGet<T = unknown>(key: string): T | null {
  try {
    return JSON.parse(readFileSync(resolve(STATE_DIR, `${key}.json`), 'utf8')) as T;
  } catch {
    return null;
  }
}

export function stateSet(key: string, value: unknown): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(resolve(STATE_DIR, `${key}.json`), JSON.stringify(value, null, 2), 'utf8');
}
