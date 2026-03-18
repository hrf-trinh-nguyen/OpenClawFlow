/**
 * Lead management operations
 */
import type { DbClient } from './connection.js';

// ── Lead Interface ──────────────────────────────────────────────────

export interface Lead {
  id?: string;
  apollo_person_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company_name?: string;
  title?: string;
  linkedin_url?: string;
  email_status?: string;
  processing_status?: string;
  processing_error?: string;
  batch_id?: string;
  priority?: number;
}

// ── Email Queries ───────────────────────────────────────────────────

export async function getExistingEmails(
  client: DbClient,
  emails: string[]
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const valid = emails
    .filter((e) => e && typeof e === 'string')
    .map((e) => e.trim().toLowerCase());
  if (valid.length === 0) return new Set();
  const result = await client.query(
    `SELECT LOWER(TRIM(email)) as email FROM leads WHERE LOWER(TRIM(email)) = ANY($1::text[])`,
    [valid]
  );
  return new Set(result.rows.map((r) => r.email));
}

// ── Lead Insertion ──────────────────────────────────────────────────

export interface InsertLeadsResult {
  inserted: number;
  skippedExisting: number;
  skippedDuplicate: number;
}

export async function insertNewLeads(
  client: DbClient,
  leads: Lead[],
  options?: { batchId?: string; priority?: number }
): Promise<InsertLeadsResult> {
  if (leads.length === 0) return { inserted: 0, skippedExisting: 0, skippedDuplicate: 0 };

  const emails = leads.map((l) => l.email).filter((e) => e && typeof e === 'string');
  const existing = await getExistingEmails(client, emails);

  const blacklistRes = await client.query(
    `SELECT LOWER(TRIM(email)) as email FROM leads WHERE blacklisted = true AND email IS NOT NULL`
  );
  const blacklisted = new Set(blacklistRes.rows.map((r) => r.email));

  const newLeads = leads.filter(
    (l) =>
      l.email &&
      !existing.has(l.email.trim().toLowerCase()) &&
      !blacklisted.has(l.email.trim().toLowerCase())
  );
  const skippedExisting = leads.length - newLeads.length;

  if (newLeads.length === 0) {
    return { inserted: 0, skippedExisting, skippedDuplicate: 0 };
  }

  const batchId = options?.batchId ?? null;
  const priority = options?.priority ?? 0;
  let inserted = 0;

  for (const lead of newLeads) {
    const res = await client.query(
      `INSERT INTO leads 
       (apollo_person_id, first_name, last_name, email, company_name, title, 
        linkedin_url, email_status, processing_status, processing_error, 
        batch_id, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        lead.apollo_person_id || null,
        lead.first_name || null,
        lead.last_name || null,
        lead.email || null,
        lead.company_name || null,
        lead.title || null,
        lead.linkedin_url || null,
        lead.email_status || null,
        lead.processing_status || 'apollo_matched',
        lead.processing_error || null,
        batchId,
        priority,
      ]
    );
    if (res.rowCount && res.rowCount > 0) inserted++;
  }

  return { inserted, skippedExisting, skippedDuplicate: 0 };
}

/** @deprecated Use insertNewLeads for Apollo. Kept for backward compatibility. */
export async function upsertLeads(client: DbClient, leads: Lead[]): Promise<number> {
  const { inserted } = await insertNewLeads(client, leads);
  return inserted;
}

// ── Lead Queries ────────────────────────────────────────────────────

export async function getLeadsByStatus(
  client: DbClient,
  status: string,
  limit: number = 100
): Promise<Lead[]> {
  const result = await client.query(
    `SELECT id, apollo_person_id, first_name, last_name, email, company_name, 
            title, linkedin_url, email_status, processing_status, 
            processing_error, batch_id, priority
     FROM leads
     WHERE processing_status = $1
     ORDER BY priority DESC, created_at ASC
     LIMIT $2`,
    [status, limit]
  );
  return result.rows;
}

export async function getLeadsReadyForCampaign(
  client: DbClient,
  limit: number = 10000
): Promise<Lead[]> {
  const result = await client.query(
    `SELECT id, apollo_person_id, first_name, last_name, email, company_name,
            title, linkedin_url, email_status, processing_status,
            processing_error, batch_id, priority
     FROM leads
     WHERE processing_status = 'bouncer_verified'
       AND (blacklisted = false OR blacklisted IS NULL)
     ORDER BY priority DESC, created_at ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ── Lead Updates ────────────────────────────────────────────────────

export async function updateLeadStatus(
  client: DbClient,
  leadId: string,
  newStatus: string,
  errorMessage?: string
): Promise<void> {
  await client.query(
    `UPDATE leads 
     SET processing_status = $1, processing_error = $2, updated_at = NOW()
     WHERE id = $3`,
    [newStatus, errorMessage || null, leadId]
  );
}

export async function batchUpdateLeadStatus(
  client: DbClient,
  leadIds: string[],
  newStatus: string,
  errorMessage?: string
): Promise<number> {
  if (leadIds.length === 0) return 0;

  const result = await client.query(
    `UPDATE leads 
     SET processing_status = $1, processing_error = $2, updated_at = NOW()
     WHERE id = ANY($3::uuid[])`,
    [newStatus, errorMessage || null, leadIds]
  );
  return result.rowCount || 0;
}

// ── Pipeline Stats ──────────────────────────────────────────────────

export async function getPipelineStats(client: DbClient): Promise<any[]> {
  const result = await client.query(
    `SELECT processing_status, COUNT(*) as count, 
            MIN(created_at) as oldest_created_at, 
            MAX(created_at) as newest_created_at
     FROM leads
     GROUP BY processing_status
     ORDER BY processing_status`
  );
  return result.rows;
}
