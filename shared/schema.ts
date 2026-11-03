/**
 * SINGLE SOURCE OF TRUTH for the database.
 *
 * The same definition drives:
 *   - the Google Sheets tabs (one tab per table, row 1 = column names)
 *   - the local JSON database (data/<table>.json)
 *   - the Oracle DDL (npm run db:oracle-ddl -> db/oracle/schema.sql)
 *
 * Rules that keep the move to Oracle easy (version 3):
 *   1. Table and column names are lower_snake_case, <= 30 chars, and never Oracle reserved words
 *      (no `order`, `comment`, `date`, `level`, `user`, `size`, `type`, `number`, `access`, `mode`, `session`).
 *   2. Every table has a string primary key `<entity>_id` (e.g. PRJ-0001) - no auto-increment needed.
 *   3. Booleans are stored as 'Y' / 'N'.
 *   4. Dates are 'YYYY-MM-DD' strings, timestamps are ISO-8601 strings (UTC).
 *   5. Free text that can be long is `text` (CLOB in Oracle); JSON payloads are `json` (CLOB IS JSON).
 *   6. Rows are never hard-deleted by the app: `is_deleted` = 'Y' (soft delete keeps history for audit).
 *   7. Foreign keys are declared here (`ref`) and become FK constraints in Oracle.
 *
 * Do not rename a column without adding a migration note in docs/DATA_MODEL.md.
 */

export type ColumnType = 'id' | 'string' | 'text' | 'int' | 'number' | 'money' | 'bool' | 'date' | 'datetime' | 'json';

export interface ColumnDef {
  name: string;
  type: ColumnType;
  /** max length for string columns (VARCHAR2 size) */
  length?: number;
  required?: boolean;
  /** foreign key: "table.column" */
  ref?: string;
  /** allowed values (becomes a CHECK constraint in Oracle) */
  enumValues?: readonly string[];
  description?: string;
}

export interface TableDef {
  name: string;
  /** id prefix used when generating new ids, e.g. PRJ -> PRJ-0001 */
  idPrefix: string;
  primaryKey: string;
  description: string;
  columns: ColumnDef[];
}

// ---------- Enumerations (shared with UI and permissions) ----------
export const PERSONA_CODES = ['EXEC', 'PARTNER', 'MANAGER', 'LEAD', 'ANALYST', 'KM', 'RISK', 'CLIENT', 'ADMIN'] as const;
export const PROJECT_STATUS = ['Planning', 'Active', 'At Risk', 'On Hold', 'Closing', 'Closed'] as const;
export const RAG = ['Green', 'Amber', 'Red'] as const;
export const WORK_STATUS = ['Not Started', 'In Progress', 'Blocked', 'Done'] as const;
export const PRIORITY = ['Low', 'Medium', 'High', 'Critical'] as const;
export const GATE_STATUS = ['Not Ready', 'Pending Approval', 'Approved'] as const;
export const DEAL_TYPES = ['Sell-side carve-out', 'Buy-side carve-out', 'Spin-off', 'TSA exit', 'Day-1 readiness', 'Integration'] as const;
export const INDUSTRIES = ['Financial Services & Payments', 'Semiconductors & High-Tech', 'Healthcare & Life Sciences', 'Consumer & Retail', 'Industrial Manufacturing', 'Energy & Utilities', 'Telecom & Media'] as const;
export const COMM_CHANNELS = ['Email', 'Call', 'Meeting', 'Chat', 'Note'] as const;
export const CONTACT_SIDES = ['PwC', 'Buyer', 'Seller', 'Vendor', 'Client'] as const;
export const MEMBER_ROLES = ['Partner', 'Manager', 'Workstream Lead', 'Analyst', 'Client Viewer', 'SME'] as const;
export const KNOWLEDGE_TYPES = ['Stage Template', 'Activity Template', 'Task Template', 'Lesson', 'Metric', 'Risk'] as const;
export const KNOWLEDGE_STATUS = ['Pending Review', 'Approved', 'Rejected'] as const;
export const CONSENT_STATUS = ['Granted', 'Not Granted', 'Pending'] as const;
export const SENSITIVITY = ['Public', 'Internal', 'Confidential', 'Restricted'] as const;
export const LANGUAGES = ['en', 'hi'] as const;
// Finance workspace (v1.3)
export const FUNDING_TYPES = ['Seller contribution (SPA)', 'Buyer balance-sheet cash', 'Bridge loan', 'Term loan', 'Revolving credit facility',
  'Vendor / deferred payment', 'Private equity equity', 'Venture / private credit', 'Escrow / holdback release', 'Government incentive'] as const;
export const FUNDING_STATUS = ['Identified', 'In discussion', 'Term sheet', 'Committed', 'Drawn', 'Declined'] as const;
export const COST_CATEGORIES = ['IT infrastructure', 'Applications and licences', 'Data migration', 'Network and sites', 'People and retention',
  'Third-party advisors', 'TSA and extensions', 'Contingency'] as const;
export const COST_STATUS = ['Planned', 'Committed', 'Spent'] as const;
export const COST_PAYERS = ['Seller', 'Buyer', 'Shared'] as const;
export const INVOICE_STATUS = ['Draft', 'Sent', 'Paid', 'Overdue'] as const;
// Bank outreach (v1.4)
export const FINANCING_REQUEST_STATUS = ['Draft', 'Sent', 'RM replied', 'Term sheet', 'Declined', 'Withdrawn'] as const;
// Access governance (v1.3)
export const GRANT_STATUS = ['Pending L1', 'Pending L2', 'Active', 'Rejected', 'Revoked', 'Cancelled'] as const;

const audit: ColumnDef[] = [
  { name: 'created_at', type: 'datetime', required: true },
  { name: 'created_by', type: 'id', ref: 'users.user_id' },
  { name: 'updated_at', type: 'datetime' },
  { name: 'updated_by', type: 'id', ref: 'users.user_id' },
  { name: 'is_deleted', type: 'bool', required: true, description: "'Y' when soft-deleted" },
];

export const TABLES: TableDef[] = [
  {
    name: 'personas',
    idPrefix: 'PER',
    primaryKey: 'persona_id',
    description: 'Roles that can sign in. Permissions are defined in shared/permissions.ts by persona code.',
    columns: [
      { name: 'persona_id', type: 'id', required: true },
      { name: 'code', type: 'string', length: 20, required: true, enumValues: PERSONA_CODES },
      { name: 'name', type: 'string', length: 80, required: true },
      { name: 'title', type: 'string', length: 120 },
      { name: 'description', type: 'text' },
      { name: 'home_route', type: 'string', length: 80 },
      { name: 'accent_color', type: 'string', length: 20 },
      { name: 'sort_order', type: 'int' },
    ],
  },
  {
    name: 'users',
    idPrefix: 'USR',
    primaryKey: 'user_id',
    description: 'Demo people. Login = pick a person from the dropdown; their persona decides what they can see and do.',
    columns: [
      { name: 'user_id', type: 'id', required: true },
      { name: 'persona_id', type: 'id', required: true, ref: 'personas.persona_id' },
      { name: 'full_name', type: 'string', length: 120, required: true },
      { name: 'email', type: 'string', length: 160 },
      { name: 'phone', type: 'string', length: 40 },
      { name: 'location', type: 'string', length: 80 },
      { name: 'org', type: 'string', length: 80 },
      { name: 'preferred_language', type: 'string', length: 5, enumValues: LANGUAGES },
      { name: 'dashboard_layout', type: 'json', description: 'Saved widget layout for the dashboard' },
      { name: 'is_active', type: 'bool', required: true },
      ...audit,
    ],
  },
  {
    name: 'projects',
    idPrefix: 'PRJ',
    primaryKey: 'project_id',
    description: 'One separation engagement (deal).',
    columns: [
      { name: 'project_id', type: 'id', required: true },
      { name: 'code_name', type: 'string', length: 80, required: true, description: 'Deal code name, e.g. Project Phoenix' },
      { name: 'client_alias', type: 'string', length: 120, description: 'Client described without its real name' },
      { name: 'deal_type', type: 'string', length: 40, enumValues: DEAL_TYPES },
      { name: 'industry', type: 'string', length: 60, enumValues: INDUSTRIES },
      { name: 'description', type: 'text' },
      { name: 'status', type: 'string', length: 20, required: true, enumValues: PROJECT_STATUS },
      { name: 'rag', type: 'string', length: 10, enumValues: RAG },
      { name: 'percent_complete', type: 'number', description: 'Rolled up from activities; never typed by hand' },
      { name: 'current_stage_id', type: 'id', ref: 'stages.stage_id' },
      { name: 'partner_user_id', type: 'id', ref: 'users.user_id' },
      { name: 'manager_user_id', type: 'id', ref: 'users.user_id' },
      { name: 'start_date', type: 'date' },
      { name: 'target_close_date', type: 'date' },
      { name: 'closed_date', type: 'date' },
      { name: 'currency', type: 'string', length: 3 },
      { name: 'fee_budget', type: 'money', description: 'PwC fee budget' },
      { name: 'fee_billed', type: 'money' },
      { name: 'tsa_monthly_cost', type: 'money', description: "Client's current TSA run-rate per month" },
      { name: 'one_time_cost', type: 'money', description: 'Estimated one-time separation cost' },
      { name: 'funding_gap', type: 'money', description: 'Unresolved buyer/seller funding gap' },
      { name: 'apps_in_scope', type: 'int' },
      { name: 'sites_in_scope', type: 'int' },
      { name: 'employees_conveying', type: 'int' },
      { name: 'sensitivity', type: 'string', length: 20, enumValues: SENSITIVITY },
      { name: 'data_residency', type: 'string', length: 40 },
      { name: 'clean_team_required', type: 'bool' },
      { name: 'reuse_consent', type: 'string', length: 20, enumValues: CONSENT_STATUS },
      { name: 'tags', type: 'string', length: 400, description: 'Comma-separated tags' },
      { name: 'spa_seller_cap', type: 'money', description: 'v1.4: most the seller pays towards separation cost under the sale agreement (SPA)' },
      { name: 'spa_clause_ref', type: 'string', length: 80, description: 'v1.4: SPA clause that sets the seller cap, e.g. "SPA cl. 7.4"' },
      ...audit,
    ],
  },
  {
    name: 'project_members',
    idPrefix: 'MEM',
    primaryKey: 'member_id',
    description: 'Who is staffed on which project. Project visibility for most personas comes from this table.',
    columns: [
      { name: 'member_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'user_id', type: 'id', required: true, ref: 'users.user_id' },
      { name: 'member_role', type: 'string', length: 40, enumValues: MEMBER_ROLES },
      { name: 'workstream', type: 'string', length: 80, description: 'For leads: the stage(s)/workstream they lead' },
      { name: 'clean_team', type: 'bool' },
      ...audit,
    ],
  },
  {
    name: 'stages',
    idPrefix: 'STG',
    primaryKey: 'stage_id',
    description: 'A stage of a project (shown as browser-style tabs). Default: Diligence, Signing, Day-1 readiness, TSA exit, Close-out.',
    columns: [
      { name: 'stage_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'name', type: 'string', length: 120, required: true },
      { name: 'description', type: 'text' },
      { name: 'sort_order', type: 'int', required: true },
      { name: 'status', type: 'string', length: 20, enumValues: WORK_STATUS },
      { name: 'percent_complete', type: 'number' },
      { name: 'owner_user_id', type: 'id', ref: 'users.user_id' },
      { name: 'start_date', type: 'date' },
      { name: 'end_date', type: 'date' },
      { name: 'gate_status', type: 'string', length: 20, enumValues: GATE_STATUS },
      { name: 'gate_criteria', type: 'text' },
      { name: 'gate_approver_id', type: 'id', ref: 'users.user_id' },
      ...audit,
    ],
  },
  {
    name: 'activities',
    idPrefix: 'ACT',
    primaryKey: 'activity_id',
    description: 'High-level activity inside a stage (e.g. "415-app migration wave plan"). Shown as sub-tabs.',
    columns: [
      { name: 'activity_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'stage_id', type: 'id', required: true, ref: 'stages.stage_id' },
      { name: 'name', type: 'string', length: 160, required: true },
      { name: 'description', type: 'text' },
      { name: 'sort_order', type: 'int', required: true },
      { name: 'status', type: 'string', length: 20, enumValues: WORK_STATUS },
      { name: 'priority', type: 'string', length: 10, enumValues: PRIORITY },
      { name: 'percent_complete', type: 'number' },
      { name: 'owner_user_id', type: 'id', ref: 'users.user_id' },
      { name: 'start_date', type: 'date' },
      { name: 'due_date', type: 'date' },
      { name: 'summary', type: 'text', description: 'Latest summary shown in the right-hand panel' },
      ...audit,
    ],
  },
  {
    name: 'tasks',
    idPrefix: 'TSK',
    primaryKey: 'task_id',
    description: 'Actionable item inside an activity: one row of the activity table; click opens the side panel.',
    columns: [
      { name: 'task_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'stage_id', type: 'id', required: true, ref: 'stages.stage_id' },
      { name: 'activity_id', type: 'id', required: true, ref: 'activities.activity_id' },
      { name: 'title', type: 'string', length: 200, required: true },
      { name: 'description', type: 'text' },
      { name: 'assignee_user_id', type: 'id', ref: 'users.user_id' },
      { name: 'status', type: 'string', length: 20, required: true, enumValues: WORK_STATUS },
      { name: 'priority', type: 'string', length: 10, enumValues: PRIORITY },
      { name: 'start_date', type: 'date' },
      { name: 'due_date', type: 'date' },
      { name: 'completed_date', type: 'date' },
      { name: 'effort_hours', type: 'number' },
      { name: 'percent_complete', type: 'number' },
      { name: 'day1_critical', type: 'bool' },
      { name: 'dependency_notes', type: 'text', description: 'What this item is waiting on' },
      { name: 'done_notes', type: 'text', description: 'What has already happened' },
      { name: 'pending_notes', type: 'text', description: 'What is still pending' },
      { name: 'sort_order', type: 'int' },
      ...audit,
    ],
  },
  {
    name: 'contacts',
    idPrefix: 'CON',
    primaryKey: 'contact_id',
    description: 'People outside the app (client, seller, vendor) linked to a project. Phone/email masked for some personas.',
    columns: [
      { name: 'contact_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'full_name', type: 'string', length: 120, required: true },
      { name: 'org', type: 'string', length: 120 },
      { name: 'role_title', type: 'string', length: 120 },
      { name: 'side', type: 'string', length: 20, enumValues: CONTACT_SIDES },
      { name: 'email', type: 'string', length: 160 },
      { name: 'phone', type: 'string', length: 40 },
      ...audit,
    ],
  },
  {
    name: 'communications',
    idPrefix: 'COM',
    primaryKey: 'comm_id',
    description: 'Automatic chat/email/call/meeting history attached to a project, stage, activity or task.',
    columns: [
      { name: 'comm_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'stage_id', type: 'id', ref: 'stages.stage_id' },
      { name: 'activity_id', type: 'id', ref: 'activities.activity_id' },
      { name: 'task_id', type: 'id', ref: 'tasks.task_id' },
      { name: 'channel', type: 'string', length: 20, required: true, enumValues: COMM_CHANNELS },
      { name: 'subject', type: 'string', length: 240 },
      { name: 'body', type: 'text' },
      { name: 'from_name', type: 'string', length: 120 },
      { name: 'to_name', type: 'string', length: 240 },
      { name: 'contact_id', type: 'id', ref: 'contacts.contact_id' },
      { name: 'occurred_at', type: 'datetime', required: true },
      { name: 'duration_min', type: 'int', description: 'Calls and meetings' },
      { name: 'ai_summary', type: 'text' },
      ...audit,
    ],
  },
  {
    name: 'quick_notes',
    idPrefix: 'NOT',
    primaryKey: 'note_id',
    description: 'Quick notes in the right-hand panel of a stage/activity.',
    columns: [
      { name: 'note_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'stage_id', type: 'id', ref: 'stages.stage_id' },
      { name: 'activity_id', type: 'id', ref: 'activities.activity_id' },
      { name: 'task_id', type: 'id', ref: 'tasks.task_id' },
      { name: 'body', type: 'text', required: true },
      { name: 'pinned', type: 'bool' },
      ...audit,
    ],
  },
  {
    name: 'finance_entries',
    idPrefix: 'FIN',
    primaryKey: 'finance_id',
    description: 'Monthly finance per project (fees, TSA cost, one-time cost) for dashboard charts.',
    columns: [
      { name: 'finance_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'period_month', type: 'string', length: 7, required: true, description: 'YYYY-MM' },
      { name: 'fee_planned', type: 'money' },
      { name: 'fee_actual', type: 'money' },
      { name: 'tsa_cost', type: 'money' },
      { name: 'one_time_cost', type: 'money' },
      { name: 'hours_logged', type: 'number' },
      ...audit,
    ],
  },
  {
    name: 'tsa_services',
    idPrefix: 'TSA',
    primaryKey: 'service_id',
    description: 'Transition services under the TSA, with price and term (feeds TSA cost widgets).',
    columns: [
      { name: 'service_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'name', type: 'string', length: 160, required: true },
      { name: 'provider', type: 'string', length: 120 },
      { name: 'monthly_fee', type: 'money' },
      { name: 'start_date', type: 'date' },
      { name: 'planned_exit_date', type: 'date' },
      { name: 'extension_uplift_pct', type: 'number' },
      { name: 'status', type: 'string', length: 20, enumValues: ['Active', 'Exiting', 'Exited', 'Extended'] },
      { name: 'linked_apps', type: 'string', length: 400 },
      ...audit,
    ],
  },
  {
    name: 'knowledge_items',
    idPrefix: 'KNW',
    primaryKey: 'knowledge_id',
    description: 'AI knowledge hub: redacted, consent-checked learnings from closed projects. Feeds AI suggestions.',
    columns: [
      { name: 'knowledge_id', type: 'id', required: true },
      { name: 'source_project_id', type: 'id', ref: 'projects.project_id', description: 'Kept for audit only; never shown to AI or users' },
      { name: 'source_label', type: 'string', length: 120, description: 'Anonymised label, e.g. "Payments TSA exit, 2025"' },
      { name: 'item_type', type: 'string', length: 30, required: true, enumValues: KNOWLEDGE_TYPES },
      { name: 'deal_type', type: 'string', length: 40, enumValues: DEAL_TYPES },
      { name: 'industry', type: 'string', length: 60, enumValues: INDUSTRIES },
      { name: 'stage_name', type: 'string', length: 120 },
      { name: 'title', type: 'string', length: 200, required: true },
      { name: 'body', type: 'text', description: 'Redacted text' },
      { name: 'payload', type: 'json', description: 'Structured data, e.g. activities + tasks for a template' },
      { name: 'tags', type: 'string', length: 400 },
      { name: 'consent_status', type: 'string', length: 20, enumValues: CONSENT_STATUS },
      { name: 'review_status', type: 'string', length: 20, required: true, enumValues: KNOWLEDGE_STATUS },
      { name: 'reviewed_by', type: 'id', ref: 'users.user_id' },
      { name: 'reviewed_at', type: 'datetime' },
      { name: 'times_used', type: 'int' },
      ...audit,
    ],
  },
  {
    name: 'chat_messages',
    idPrefix: 'MSG',
    primaryKey: 'message_id',
    description: 'Piku conversation history (per user, with the page context it was asked on).',
    columns: [
      { name: 'message_id', type: 'id', required: true },
      { name: 'user_id', type: 'id', required: true, ref: 'users.user_id' },
      { name: 'project_id', type: 'id', ref: 'projects.project_id' },
      { name: 'context_type', type: 'string', length: 20, enumValues: ['global', 'project', 'stage', 'activity', 'task'] },
      { name: 'context_id', type: 'id' },
      { name: 'sender', type: 'string', length: 10, required: true, enumValues: ['user', 'piku'] },
      { name: 'body', type: 'text', required: true },
      { name: 'language', type: 'string', length: 5, enumValues: LANGUAGES },
      { name: 'ai_mode', type: 'string', length: 20, description: 'gemini model name or "offline"' },
      { name: 'sources', type: 'json', description: 'Records the answer was built from' },
      ...audit,
    ],
  },
  {
    name: 'funding_sources',
    idPrefix: 'FND',
    primaryKey: 'funding_id',
    description: 'Finance workspace: where the money for one-time separation costs comes from (sources side of sources & uses). Visibility only; the app never arranges financing.',
    columns: [
      { name: 'funding_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'source_type', type: 'string', length: 40, required: true, enumValues: FUNDING_TYPES },
      { name: 'provider', type: 'string', length: 120, description: 'Lender / investor / party (demo names are fictional)' },
      { name: 'amount', type: 'money' },
      { name: 'status', type: 'string', length: 20, required: true, enumValues: FUNDING_STATUS },
      { name: 'interest_rate_pct', type: 'number' },
      { name: 'tenor_months', type: 'int' },
      { name: 'purpose', type: 'text' },
      { name: 'expected_date', type: 'date' },
      { name: 'owner_user_id', type: 'id', ref: 'users.user_id', description: 'PwC person tracking this source' },
      { name: 'notes', type: 'text' },
      ...audit,
    ],
  },
  {
    name: 'cost_items',
    idPrefix: 'CST',
    primaryKey: 'cost_id',
    description: 'Finance workspace: one-time separation cost lines (uses side), by stage, category and who pays.',
    columns: [
      { name: 'cost_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'stage_id', type: 'id', ref: 'stages.stage_id' },
      { name: 'activity_id', type: 'id', ref: 'activities.activity_id' },
      { name: 'category', type: 'string', length: 40, required: true, enumValues: COST_CATEGORIES },
      { name: 'description', type: 'string', length: 240 },
      { name: 'amount', type: 'money' },
      { name: 'status', type: 'string', length: 20, required: true, enumValues: COST_STATUS },
      { name: 'payer', type: 'string', length: 20, enumValues: COST_PAYERS },
      { name: 'vendor', type: 'string', length: 120 },
      { name: 'buyer_usage_pct', type: 'number', description: 'v1.4: buyer share of use (0-100) for Shared lines; drives the usage-based split' },
      ...audit,
    ],
  },
  {
    name: 'invoices',
    idPrefix: 'INV',
    primaryKey: 'invoice_id',
    description: 'Finance workspace: PwC fee invoices to the client (who billed what, when, and whether it is paid).',
    columns: [
      { name: 'invoice_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'invoice_no', type: 'string', length: 40, required: true },
      { name: 'period_month', type: 'string', length: 7, description: 'YYYY-MM' },
      { name: 'stage_id', type: 'id', ref: 'stages.stage_id' },
      { name: 'description', type: 'string', length: 240 },
      { name: 'amount', type: 'money' },
      { name: 'status', type: 'string', length: 20, required: true, enumValues: INVOICE_STATUS },
      { name: 'issued_date', type: 'date' },
      { name: 'due_date', type: 'date' },
      { name: 'paid_date', type: 'date' },
      { name: 'billed_by_user_id', type: 'id', ref: 'users.user_id', description: 'Partner or manager who raised the bill' },
      { name: 'billed_to', type: 'string', length: 120 },
      ...audit,
    ],
  },
  {
    name: 'financing_requests',
    idPrefix: 'FRQ',
    primaryKey: 'request_id',
    description: 'v1.4 bank outreach: a request for financing drafted for a demo bank relationship manager, and its tracking. Nothing is sent from the app.',
    columns: [
      { name: 'request_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'bank_code', type: 'string', length: 20, required: true, description: 'Key into DEMO_BANKS (shared/finance.ts)' },
      { name: 'rm_name', type: 'string', length: 120, description: 'Relationship manager at the bank (fictional)' },
      { name: 'product', type: 'string', length: 40, required: true, enumValues: FUNDING_TYPES },
      { name: 'amount', type: 'money' },
      { name: 'purpose', type: 'text' },
      { name: 'status', type: 'string', length: 20, required: true, enumValues: FINANCING_REQUEST_STATUS },
      { name: 'email_subject', type: 'string', length: 240 },
      { name: 'email_body', type: 'text' },
      { name: 'sent_at', type: 'datetime', description: 'When a finance editor marked it as sent (sent outside the app)' },
      { name: 'last_update_at', type: 'datetime' },
      { name: 'next_follow_up', type: 'date' },
      { name: 'notes', type: 'text' },
      { name: 'owner_user_id', type: 'id', ref: 'users.user_id', description: 'PwC person who drafted / tracks it' },
      { name: 'funding_id', type: 'id', ref: 'funding_sources.funding_id', description: 'Funding line created when a term sheet arrives' },
      ...audit,
    ],
  },
  {
    name: 'access_grants',
    idPrefix: 'GRT',
    primaryKey: 'grant_id',
    description: 'Extra, time-bound permission for one person on one project. Two-level governance: L1 engagement approval, L2 Risk & Quality.',
    columns: [
      { name: 'grant_id', type: 'id', required: true },
      { name: 'project_id', type: 'id', required: true, ref: 'projects.project_id' },
      { name: 'grantee_user_id', type: 'id', required: true, ref: 'users.user_id' },
      { name: 'permission_code', type: 'string', length: 40, required: true },
      { name: 'justification', type: 'text', required: true },
      { name: 'duration_days', type: 'int' },
      { name: 'status', type: 'string', length: 20, required: true, enumValues: GRANT_STATUS },
      { name: 'requested_by', type: 'id', ref: 'users.user_id' },
      { name: 'l1_approver_id', type: 'id', ref: 'users.user_id' },
      { name: 'l1_decided_at', type: 'datetime' },
      { name: 'l1_note', type: 'text' },
      { name: 'l2_approver_id', type: 'id', ref: 'users.user_id' },
      { name: 'l2_decided_at', type: 'datetime' },
      { name: 'l2_note', type: 'text' },
      { name: 'starts_at', type: 'datetime' },
      { name: 'expires_at', type: 'datetime' },
      { name: 'revoked_by', type: 'id', ref: 'users.user_id' },
      { name: 'revoked_at', type: 'datetime' },
      { name: 'revoke_reason', type: 'text' },
      ...audit,
    ],
  },
  {
    name: 'audit_log',
    idPrefix: 'AUD',
    primaryKey: 'audit_id',
    description: 'Every create/update/delete, AI suggestion, approval and denied access.',
    columns: [
      { name: 'audit_id', type: 'id', required: true },
      { name: 'actor_user_id', type: 'id', ref: 'users.user_id' },
      { name: 'persona_code', type: 'string', length: 20 },
      { name: 'action', type: 'string', length: 60, required: true },
      { name: 'entity_type', type: 'string', length: 40 },
      { name: 'entity_id', type: 'id' },
      { name: 'project_id', type: 'id', ref: 'projects.project_id' },
      { name: 'details', type: 'json' },
      { name: 'ai_generated', type: 'bool' },
      { name: 'created_at', type: 'datetime', required: true },
    ],
  },
];

export const TABLE_NAMES = TABLES.map((t) => t.name);
export type TableName =
  | 'personas' | 'users' | 'projects' | 'project_members' | 'stages' | 'activities' | 'tasks'
  | 'contacts' | 'communications' | 'quick_notes' | 'finance_entries' | 'tsa_services'
  | 'knowledge_items' | 'chat_messages' | 'audit_log'
  | 'funding_sources' | 'cost_items' | 'invoices' | 'access_grants'
  | 'financing_requests';

export function getTable(name: string): TableDef {
  const t = TABLES.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown table: ${name}`);
  return t;
}

/** Bump when columns change; stored in the `_meta` sheet tab so the app can warn about an old sheet. */
export const SCHEMA_VERSION = 2;
