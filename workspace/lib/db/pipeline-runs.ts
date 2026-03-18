/**
 * Pipeline runs and service executions management
 */
import type { DbClient } from './connection.js';

// ── Pipeline Runs ──────────────────────────────────────────────────

export interface PipelineRun {
  id?: string;
  run_type: string;
  target_count?: number;
  started_at?: Date;
  completed_at?: Date;
  status?: string;
  leads_processed?: number;
  leads_succeeded?: number;
  leads_failed?: number;
  triggered_by?: string;
  icp_filters?: any;
  error_message?: string;
}

export async function createPipelineRun(
  client: DbClient,
  run: PipelineRun
): Promise<string> {
  const result = await client.query(
    `INSERT INTO pipeline_runs 
     (run_type, target_count, status, triggered_by, icp_filters)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      run.run_type,
      run.target_count || null,
      run.status || 'running',
      run.triggered_by || 'manual',
      run.icp_filters ? JSON.stringify(run.icp_filters) : null,
    ]
  );
  return result.rows[0].id;
}

export async function updatePipelineRun(
  client: DbClient,
  runId: string,
  updates: Partial<PipelineRun>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== undefined) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.leads_processed !== undefined) {
    fields.push(`leads_processed = $${idx++}`);
    values.push(updates.leads_processed);
  }
  if (updates.leads_succeeded !== undefined) {
    fields.push(`leads_succeeded = $${idx++}`);
    values.push(updates.leads_succeeded);
  }
  if (updates.leads_failed !== undefined) {
    fields.push(`leads_failed = $${idx++}`);
    values.push(updates.leads_failed);
  }
  if (updates.error_message) {
    fields.push(`error_message = $${idx++}`);
    values.push(updates.error_message);
  }

  fields.push(`updated_at = NOW()`);
  values.push(runId);

  await client.query(
    `UPDATE pipeline_runs SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );
}

// ── Service Executions ─────────────────────────────────────────────

export interface ServiceExecution {
  id?: string;
  pipeline_run_id?: string;
  service_name: string;
  started_at?: Date;
  completed_at?: Date;
  status?: string;
  input_count?: number;
  output_count?: number;
  failed_count?: number;
  api_calls_made?: number;
  api_errors?: number;
  rate_limit_hits?: number;
  batch_size?: number;
  error_message?: string;
  execution_metadata?: any;
}

export async function createServiceExecution(
  client: DbClient,
  exec: ServiceExecution
): Promise<string> {
  const result = await client.query(
    `INSERT INTO service_executions 
     (pipeline_run_id, service_name, status, input_count, batch_size)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      exec.pipeline_run_id || null,
      exec.service_name,
      exec.status || 'running',
      exec.input_count || 0,
      exec.batch_size || null,
    ]
  );
  return result.rows[0].id;
}

export async function updateServiceExecution(
  client: DbClient,
  execId: string,
  updates: Partial<ServiceExecution>
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.status) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.completed_at !== undefined) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completed_at);
  }
  if (updates.output_count !== undefined) {
    fields.push(`output_count = $${idx++}`);
    values.push(updates.output_count);
  }
  if (updates.failed_count !== undefined) {
    fields.push(`failed_count = $${idx++}`);
    values.push(updates.failed_count);
  }
  if (updates.api_calls_made !== undefined) {
    fields.push(`api_calls_made = $${idx++}`);
    values.push(updates.api_calls_made);
  }
  if (updates.api_errors !== undefined) {
    fields.push(`api_errors = $${idx++}`);
    values.push(updates.api_errors);
  }
  if (updates.rate_limit_hits !== undefined) {
    fields.push(`rate_limit_hits = $${idx++}`);
    values.push(updates.rate_limit_hits);
  }
  if (updates.error_message) {
    fields.push(`error_message = $${idx++}`);
    values.push(updates.error_message);
  }
  if (updates.execution_metadata) {
    fields.push(`execution_metadata = $${idx++}`);
    values.push(JSON.stringify(updates.execution_metadata));
  }

  values.push(execId);

  await client.query(
    `UPDATE service_executions SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );
}
