// lib/supabase-legacy.ts
async function createWorkflowRun(client, workflowName) {
  const result = await client.query(
    `INSERT INTO workflow_runs (workflow_name, started_at, status) 
     VALUES ($1, NOW(), 'running') 
     RETURNING id`,
    [workflowName]
  );
  return result.rows[0].id;
}
async function logApolloSearch(client, searchData) {
  await client.query(
    `INSERT INTO apollo_search_log 
     (person_count, api_credits_used, search_params, executed_at)
     VALUES ($1, $2, $3, NOW())`,
    [
      searchData.person_count || 0,
      searchData.api_credits_used || 0,
      searchData.search_params ? JSON.stringify(searchData.search_params) : "{}"
    ]
  );
}
export {
  createWorkflowRun,
  logApolloSearch
};
