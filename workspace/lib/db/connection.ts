/**
 * Database connection management
 */
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb(): Pool | null {
  if (!process.env.SUPABASE_DB_URL) {
    console.warn('⚠️  SUPABASE_DB_URL not found in env');
    return null;
  }

  if (!pool) {
    const connString = process.env.SUPABASE_DB_URL.trim().replace(/^['"]|['"]$/g, '');
    pool = new Pool({ connectionString: connString });
    console.log('✅ PostgreSQL connection pool created');
  }

  return pool;
}

export type DbClient = Pool;

export function getSupabaseClient(): Pool | null {
  return getDb();
}

export function getSupabaseEnv() {
  return { url: process.env.SUPABASE_DB_URL || '', key: '' };
}
