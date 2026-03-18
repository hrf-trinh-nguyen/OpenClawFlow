/**
 * Supabase Pipeline Operations
 *
 * This file re-exports all database operations from the db/ submodules
 * for backward compatibility. New code should import directly from
 * './db/index.js' or specific submodules.
 *
 * @deprecated Import from './db/index.js' instead for new code.
 */

// Re-export everything from the db module
export * from './db/index.js';
