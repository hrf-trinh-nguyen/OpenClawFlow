/**
 * Structured logging for OpenClaw pipeline
 *
 * Provides consistent, parseable log output for debugging and monitoring.
 * All logs are JSON-formatted for easy grep/jq processing.
 *
 * Usage:
 *   import { logger } from '../../lib/logger.js';
 *   logger.info('Processing batch', { batchNum: 1, total: 5 });
 *   logger.error('API failed', { service: 'bouncer', status: 402 });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

/** Check if structured logging is enabled (default: false for human-readable output) */
function isStructuredLoggingEnabled(): boolean {
  return /^(1|true|yes)$/i.test(String(process.env.LOG_JSON || '').trim());
}

function formatLog(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  if (isStructuredLoggingEnabled()) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...meta,
    };
    return JSON.stringify(entry);
  }

  // Human-readable format (default)
  const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
  const prefix = {
    debug: '🔍',
    info: 'ℹ️ ',
    warn: '⚠️ ',
    error: '❌',
  }[level];

  let line = `[${timestamp}] ${prefix} ${msg}`;
  if (meta && Object.keys(meta).length > 0) {
    const metaStr = Object.entries(meta)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    line += ` (${metaStr})`;
  }
  return line;
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(formatLog('debug', msg, meta));
    }
  },

  info(msg: string, meta?: Record<string, unknown>): void {
    console.log(formatLog('info', msg, meta));
  },

  warn(msg: string, meta?: Record<string, unknown>): void {
    console.warn(formatLog('warn', msg, meta));
  },

  error(msg: string, meta?: Record<string, unknown>): void {
    console.error(formatLog('error', msg, meta));
  },

  /** Log success with checkmark (info level) */
  success(msg: string, meta?: Record<string, unknown>): void {
    if (isStructuredLoggingEnabled()) {
      console.log(formatLog('info', msg, { ...meta, success: true }));
    } else {
      const timestamp = new Date().toISOString().slice(11, 19);
      let line = `[${timestamp}] ✅ ${msg}`;
      if (meta && Object.keys(meta).length > 0) {
        const metaStr = Object.entries(meta)
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' ');
        line += ` (${metaStr})`;
      }
      console.log(line);
    }
  },

  /** Log progress (info level with progress indicator) */
  progress(msg: string, current: number, total: number, meta?: Record<string, unknown>): void {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    this.info(msg, { ...meta, progress: `${current}/${total}`, pct: `${pct}%` });
  },
};

export default logger;
