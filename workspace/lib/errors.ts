/**
 * Custom error classes for OpenClaw pipeline
 *
 * Use these instead of generic Error for better error handling and type safety.
 * AI agents can easily identify error types and handle them appropriately.
 */

/** Base class for all OpenClaw errors */
export class OpenClawError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenClawError';
  }
}

// ── API Errors ─────────────────────────────────────────────────────

/** Base class for external API errors */
export class ApiError extends OpenClawError {
  constructor(
    public readonly service: string,
    public readonly statusCode: number | null,
    message: string
  ) {
    super(`[${service}] ${message}`);
    this.name = 'ApiError';
  }
}

/** Bouncer API errors (submit, poll, download, timeout, 402, etc.) */
export class BouncerApiError extends ApiError {
  constructor(
    public readonly operation: 'submit' | 'poll' | 'download' | 'timeout' | 'unknown',
    statusCode: number | null,
    message: string
  ) {
    super('Bouncer', statusCode, `${operation}: ${message}`);
    this.name = 'BouncerApiError';
  }
}

/** Instantly API errors (add-leads, fetch, reply, etc.) */
export class InstantlyApiError extends ApiError {
  /** IDs of leads successfully processed before the error (for partial recovery) */
  public partialSuccessIds: string[] = [];

  constructor(
    public readonly operation: 'add-leads' | 'fetch' | 'reply' | 'unread-count' | 'unknown',
    statusCode: number | null,
    message: string
  ) {
    super('Instantly', statusCode, `${operation}: ${message}`);
    this.name = 'InstantlyApiError';
  }

  /** Attach IDs of leads that were successfully processed before the error */
  withPartialSuccess(ids: string[]): this {
    this.partialSuccessIds = [...ids];
    return this;
  }
}

/** OpenAI API errors (classification, etc.) */
export class OpenAiApiError extends ApiError {
  constructor(statusCode: number | null, message: string) {
    super('OpenAI', statusCode, message);
    this.name = 'OpenAiApiError';
  }
}

/** Apollo API errors */
export class ApolloApiError extends ApiError {
  constructor(
    public readonly operation: 'search' | 'match' | 'unknown',
    statusCode: number | null,
    message: string
  ) {
    super('Apollo', statusCode, `${operation}: ${message}`);
    this.name = 'ApolloApiError';
  }
}

// ── Pipeline Errors ────────────────────────────────────────────────

/** Pipeline was intentionally aborted (e.g., unexpected Bouncer status) */
export class PipelineAbortError extends OpenClawError {
  constructor(
    public readonly service: string,
    public readonly reason: string
  ) {
    super(`Pipeline aborted in ${service}: ${reason}`);
    this.name = 'PipelineAbortError';
  }
}

/** Bouncer returned unexpected result status (risky, unknown, missing row) */
export class BouncerUnexpectedResultError extends OpenClawError {
  constructor(
    public readonly batchId: string,
    public readonly detail: string
  ) {
    super(`Unexpected Bouncer result: ${detail}`);
    this.name = 'BouncerUnexpectedResultError';
  }
}

// ── Validation Errors ──────────────────────────────────────────────

/** Missing required environment variables */
export class MissingEnvError extends OpenClawError {
  constructor(public readonly missingVars: string[]) {
    super(`Missing required environment variables: ${missingVars.join(', ')}`);
    this.name = 'MissingEnvError';
  }
}

/** Invalid configuration value */
export class ConfigError extends OpenClawError {
  constructor(
    public readonly key: string,
    public readonly reason: string
  ) {
    super(`Invalid config "${key}": ${reason}`);
    this.name = 'ConfigError';
  }
}

// ── Database Errors ────────────────────────────────────────────────

/** Database connection or query error */
export class DatabaseError extends OpenClawError {
  constructor(
    public readonly operation: string,
    message: string
  ) {
    super(`Database ${operation} failed: ${message}`);
    this.name = 'DatabaseError';
  }
}

// ── Type Guards ────────────────────────────────────────────────────

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isBouncerApiError(error: unknown): error is BouncerApiError {
  return error instanceof BouncerApiError;
}

export function isInstantlyApiError(error: unknown): error is InstantlyApiError {
  return error instanceof InstantlyApiError;
}

export function isPipelineAbortError(error: unknown): error is PipelineAbortError {
  return error instanceof PipelineAbortError;
}

/** Extract error message safely from any thrown value */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
