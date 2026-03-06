#!/usr/bin/env node
/**
 * Ensures workspace has @openclaw/sdk shim when using global openclaw (npm install -g openclaw).
 * Run from workspace dir (postinstall). Creates node_modules/@openclaw/sdk with types + stub exports.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..');
const sdkDir = join(workspaceRoot, 'node_modules', '@openclaw', 'sdk');

const packageJson = `{
  "name": "@openclaw/sdk",
  "version": "0.0.0-workspace-shim",
  "description": "Shim so workspace skills resolve @openclaw/sdk when using global openclaw CLI",
  "type": "module",
  "main": "index.js",
  "types": "index.d.ts",
  "exports": {
    ".": {
      "types": "./index.d.ts",
      "import": "./index.js",
      "default": "./index.js"
    }
  }
}
`;

const indexDts = `/**
 * Shim types for workspace skills when using global openclaw (npm install -g openclaw).
 * The runtime ctx is provided by the OpenClaw gateway when it runs the skill.
 */
export interface SkillContext {
  state: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  config: Record<string, string | number | boolean | undefined>;
  log(message: string): void;
  channel?: {
    send(message: string, opts?: Record<string, unknown>): Promise<void>;
  };
}

export interface SkillResult {
  success: boolean;
  error?: string;
  message?: string;
  data?: unknown;
}

export interface Skill {
  name: string;
  description: string;
  execute(ctx: SkillContext): Promise<SkillResult>;
}
`;

const indexJs = `/**
 * Runtime shim: types are used only at compile time; export minimal values
 * so "import { Skill, SkillContext, SkillResult } from '@openclaw/sdk'" does not throw.
 */
export const Skill = Object.freeze({ __brand: 'Skill' });
export const SkillContext = Object.freeze({ __brand: 'SkillContext' });
export const SkillResult = Object.freeze({ __brand: 'SkillResult' });
`;

async function main() {
  await mkdir(sdkDir, { recursive: true });
  await writeFile(join(sdkDir, 'package.json'), packageJson, 'utf8');
  await writeFile(join(sdkDir, 'index.d.ts'), indexDts, 'utf8');
  await writeFile(join(sdkDir, 'index.js'), indexJs, 'utf8');
  console.log('[@openclaw/sdk] Shim created at node_modules/@openclaw/sdk (use global openclaw CLI)');
}

main().catch((err) => {
  console.warn('[@openclaw/sdk] Could not create shim:', err.message);
  process.exitCode = 0; // non-fatal
});
