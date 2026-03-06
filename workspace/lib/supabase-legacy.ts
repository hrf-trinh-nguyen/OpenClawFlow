import { Pool } from 'pg';

export type DbClient = Pool | any;

export async function createWorkflowRun(
  client: DbClient,
  workflowName: string
): Promise<string> {
  const result = await client.query(
    `INSERT INTO workflow_runs (workflow_name, started_at, status) 
     VALUES ($1, NOW(), 'running') 
     RETURNING id`,
    [workflowName]
  );
  return result.rows[0].id;
}

export async function logApolloSearch(
  client: DbClient,
  searchData: any
): Promise<void> {
  await client.query(
    `INSERT INTO apollo_search_log 
     (person_count, api_credits_used, search_params, executed_at)
     VALUES ($1, $2, $3, NOW())`,
    [
      searchData.person_count || 0,
      searchData.api_credits_used || 0,
      searchData.search_params ? JSON.stringify(searchData.search_params) : '{}'
    ]
  );
}
