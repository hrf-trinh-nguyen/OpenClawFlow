/**
 * Bouncer pause file management
 *
 * On API errors, writes a pause file to prevent subsequent cron runs
 * from wasting credits until the issue is resolved.
 */

import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const PAUSE_FILENAME = 'bouncer-paused';

function getStateDir(): string {
  const root = process.env.OPENCLAW_HOME || process.cwd();
  return join(root, 'state');
}

function getPauseFilePath(): string {
  return join(getStateDir(), PAUSE_FILENAME);
}

/**
 * Write pause file to halt future Bouncer cron runs.
 * Called on API errors (submit/poll/download/timeout/402/etc.).
 */
export function writePauseFile(reason: string): void {
  try {
    const dir = getStateDir();
    mkdirSync(dir, { recursive: true });

    const body = [
      `paused_at=${new Date().toISOString()}`,
      `reason=${reason.replace(/\n/g, ' ')}`,
      '',
      'Auto-cleared after a successful Bouncer run, or delete this file manually.',
    ].join('\n');

    writeFileSync(getPauseFilePath(), body, 'utf8');
    console.error(`   ⏸️  Bouncer paused: wrote ${getPauseFilePath()} — cron will skip until resolved.`);
  } catch (e) {
    console.error('   ⚠️  Could not write pause file:', e);
  }
}

/**
 * Remove pause file after successful run.
 */
export function clearPauseFile(): void {
  try {
    const path = getPauseFilePath();
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`   ✅ Cleared pause file: ${path}`);
    }
  } catch (e) {
    console.error('   ⚠️  Could not clear pause file:', e);
  }
}

/**
 * Check if Bouncer is currently paused.
 */
export function isPaused(): boolean {
  return existsSync(getPauseFilePath());
}
