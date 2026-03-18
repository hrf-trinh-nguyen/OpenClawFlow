/**
 * Database module barrel export
 *
 * Re-exports all database operations from submodules for convenient imports.
 */

// Connection
export { getDb, getSupabaseClient, getSupabaseEnv, type DbClient } from './connection.js';

// Pipeline runs and service executions
export {
  createPipelineRun,
  updatePipelineRun,
  createServiceExecution,
  updateServiceExecution,
  type PipelineRun,
  type ServiceExecution,
} from './pipeline-runs.js';

// Leads
export {
  getExistingEmails,
  insertNewLeads,
  upsertLeads,
  getLeadsByStatus,
  getLeadsReadyForCampaign,
  updateLeadStatus,
  batchUpdateLeadStatus,
  getPipelineStats,
  type Lead,
  type InsertLeadsResult,
} from './leads.js';

// Reports
export {
  getMetricsForReport,
  upsertDailyReport,
  upsertCampaignDailyAnalytics,
  getDailyReportsByMonth,
  type ReportMetrics,
} from './reports.js';
