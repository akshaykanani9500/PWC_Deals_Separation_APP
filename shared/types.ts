/**
 * Row types (mirror shared/schema.ts) and API payload types.
 * Booleans are 'Y' | 'N', dates are 'YYYY-MM-DD', timestamps ISO strings - same as in the sheet.
 */
import type {
  PERSONA_CODES, PROJECT_STATUS, RAG, WORK_STATUS, PRIORITY, GATE_STATUS, DEAL_TYPES, INDUSTRIES,
  COMM_CHANNELS, CONTACT_SIDES, MEMBER_ROLES, KNOWLEDGE_TYPES, KNOWLEDGE_STATUS, CONSENT_STATUS, SENSITIVITY, LANGUAGES,
  FUNDING_TYPES, FUNDING_STATUS, COST_CATEGORIES, COST_STATUS, COST_PAYERS, INVOICE_STATUS, GRANT_STATUS,
} from './schema';
import type { Action } from './permissions';

export type PersonaCode = (typeof PERSONA_CODES)[number];
export type ProjectStatus = (typeof PROJECT_STATUS)[number];
export type Rag = (typeof RAG)[number];
export type WorkStatus = (typeof WORK_STATUS)[number];
export type Priority = (typeof PRIORITY)[number];
export type GateStatus = (typeof GATE_STATUS)[number];
export type DealType = (typeof DEAL_TYPES)[number];
export type Industry = (typeof INDUSTRIES)[number];
export type CommChannel = (typeof COMM_CHANNELS)[number];
export type ContactSide = (typeof CONTACT_SIDES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUS)[number];
export type ConsentStatus = (typeof CONSENT_STATUS)[number];
export type Sensitivity = (typeof SENSITIVITY)[number];
export type Lang = (typeof LANGUAGES)[number];
export type YN = 'Y' | 'N';

interface AuditCols {
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  is_deleted: YN;
}

export interface Persona {
  persona_id: string; code: PersonaCode; name: string; title?: string; description?: string;
  home_route?: string; accent_color?: string; sort_order?: number;
}

export interface User extends AuditCols {
  user_id: string; persona_id: string; full_name: string; email?: string; phone?: string; location?: string; org?: string;
  preferred_language?: Lang; dashboard_layout?: string | null; is_active: YN;
}

export interface Project extends AuditCols {
  project_id: string; code_name: string; client_alias?: string; deal_type?: DealType; industry?: Industry; description?: string;
  status: ProjectStatus; rag?: Rag; percent_complete?: number; current_stage_id?: string | null;
  partner_user_id?: string | null; manager_user_id?: string | null;
  start_date?: string | null; target_close_date?: string | null; closed_date?: string | null;
  currency?: string; fee_budget?: number | null; fee_billed?: number | null; tsa_monthly_cost?: number | null;
  one_time_cost?: number | null; funding_gap?: number | null;
  apps_in_scope?: number | null; sites_in_scope?: number | null; employees_conveying?: number | null;
  sensitivity?: Sensitivity; data_residency?: string; clean_team_required?: YN; reuse_consent?: ConsentStatus; tags?: string;
}

export interface ProjectMember extends AuditCols {
  member_id: string; project_id: string; user_id: string; member_role?: MemberRole; workstream?: string; clean_team?: YN;
}

export interface Stage extends AuditCols {
  stage_id: string; project_id: string; name: string; description?: string; sort_order: number; status?: WorkStatus;
  percent_complete?: number; owner_user_id?: string | null; start_date?: string | null; end_date?: string | null;
  gate_status?: GateStatus; gate_criteria?: string; gate_approver_id?: string | null;
}

export interface Activity extends AuditCols {
  activity_id: string; project_id: string; stage_id: string; name: string; description?: string; sort_order: number;
  status?: WorkStatus; priority?: Priority; percent_complete?: number; owner_user_id?: string | null;
  start_date?: string | null; due_date?: string | null; summary?: string;
}

export interface Task extends AuditCols {
  task_id: string; project_id: string; stage_id: string; activity_id: string; title: string; description?: string;
  assignee_user_id?: string | null; status: WorkStatus; priority?: Priority; start_date?: string | null; due_date?: string | null;
  completed_date?: string | null; effort_hours?: number | null; percent_complete?: number; day1_critical?: YN;
  dependency_notes?: string; done_notes?: string; pending_notes?: string; sort_order?: number;
}

export interface Contact extends AuditCols {
  contact_id: string; project_id: string; full_name: string; org?: string; role_title?: string; side?: ContactSide;
  email?: string; phone?: string;
}

export interface Communication extends AuditCols {
  comm_id: string; project_id: string; stage_id?: string | null; activity_id?: string | null; task_id?: string | null;
  channel: CommChannel; subject?: string; body?: string; from_name?: string; to_name?: string; contact_id?: string | null;
  occurred_at: string; duration_min?: number | null; ai_summary?: string;
}

export interface QuickNote extends AuditCols {
  note_id: string; project_id: string; stage_id?: string | null; activity_id?: string | null; task_id?: string | null;
  body: string; pinned?: YN;
}

export interface FinanceEntry extends AuditCols {
  finance_id: string; project_id: string; period_month: string; fee_planned?: number; fee_actual?: number;
  tsa_cost?: number; one_time_cost?: number; hours_logged?: number;
}

export interface TsaService extends AuditCols {
  service_id: string; project_id: string; name: string; provider?: string; monthly_fee?: number; start_date?: string;
  planned_exit_date?: string; extension_uplift_pct?: number; status?: 'Active' | 'Exiting' | 'Exited' | 'Extended'; linked_apps?: string;
}

export interface KnowledgeItem extends AuditCols {
  knowledge_id: string; source_project_id?: string | null; source_label?: string; item_type: KnowledgeType;
  deal_type?: DealType; industry?: Industry; stage_name?: string; title: string; body?: string; payload?: string | null;
  tags?: string; consent_status?: ConsentStatus; review_status: KnowledgeStatus; reviewed_by?: string | null;
  reviewed_at?: string | null; times_used?: number;
}

export interface ChatMessage extends AuditCols {
  message_id: string; user_id: string; project_id?: string | null; context_type?: PikuContextType; context_id?: string | null;
  sender: 'user' | 'piku'; body: string; language?: Lang; ai_mode?: string; sources?: string | null;
}

export interface AuditEntry {
  audit_id: string; actor_user_id?: string | null; persona_code?: string; action: string; entity_type?: string;
  entity_id?: string | null; project_id?: string | null; details?: string | null; ai_generated?: YN; created_at: string;
}

export interface FundingSource extends AuditCols {
  funding_id: string; project_id: string; source_type: (typeof FUNDING_TYPES)[number]; provider?: string; amount?: number;
  status: (typeof FUNDING_STATUS)[number]; interest_rate_pct?: number | null; tenor_months?: number | null; purpose?: string;
  expected_date?: string | null; owner_user_id?: string | null; notes?: string;
}

export interface CostItem extends AuditCols {
  cost_id: string; project_id: string; stage_id?: string | null; activity_id?: string | null; category: (typeof COST_CATEGORIES)[number];
  description?: string; amount?: number; status: (typeof COST_STATUS)[number]; payer?: (typeof COST_PAYERS)[number]; vendor?: string;
}

export interface Invoice extends AuditCols {
  invoice_id: string; project_id: string; invoice_no: string; period_month?: string; stage_id?: string | null; description?: string;
  amount?: number; status: (typeof INVOICE_STATUS)[number]; issued_date?: string | null; due_date?: string | null; paid_date?: string | null;
  billed_by_user_id?: string | null; billed_to?: string;
}

export interface AccessGrant extends AuditCols {
  grant_id: string; project_id: string; grantee_user_id: string; permission_code: string; justification: string; duration_days?: number;
  status: (typeof GRANT_STATUS)[number]; requested_by?: string | null;
  l1_approver_id?: string | null; l1_decided_at?: string | null; l1_note?: string | null;
  l2_approver_id?: string | null; l2_decided_at?: string | null; l2_note?: string | null;
  starts_at?: string | null; expires_at?: string | null; revoked_by?: string | null; revoked_at?: string | null; revoke_reason?: string | null;
}

// ---------------- API payloads ----------------

/** Who is signed in. Returned by POST /api/auth/login and GET /api/auth/me */
export interface Session {
  token: string;
  user: User;
  persona: Persona;
  /** Actions this persona may perform (from shared/permissions.ts) */
  actions: Action[];
  scope: 'all' | 'member';
}

/** Per-record permission flags the server attaches so the UI can show/hide buttons precisely. */
export interface RowPermissions { canEdit: boolean; canDelete: boolean; }

export interface ProjectListItem extends Project {
  partner_name?: string; manager_name?: string; current_stage_name?: string;
  open_tasks: number; overdue_tasks: number; blocked_tasks: number; team_size: number;
}

export interface ProjectDetail {
  project: Project & { partner_name?: string; manager_name?: string };
  stages: (Stage & { owner_name?: string; perms: RowPermissions })[];
  members: (ProjectMember & { full_name: string; persona_code: PersonaCode })[];
  /** What the current user may do on this project */
  perms: {
    canEditProject: boolean; /** v1.4: false when project.edit comes only from an acting role */ canChangeStaffing?: boolean; canEditStages: boolean; canClose: boolean; canApproveGate: boolean;
    canViewFinance: boolean; canAddNotes: boolean; canUseAiSuggest: boolean;
    /** v1.3 */
    canEditFinance?: boolean; canRequestAccess?: boolean; canSponsorAccess?: boolean;
  };
  /** Extra permissions this user holds on THIS project through approved, unexpired access grants. */
  grants?: { grant_id: string; permission_code: string; label: string; expires_at?: string | null; acting_role?: PersonaCode | null }[];
  /** v1.4: live extra access of every team member (not sent to client users) */
  memberAccess?: MemberAccessChip[];
}

export interface StageDetail {
  stage: Stage;
  activities: (Activity & { owner_name?: string; task_count: number; done_count: number; perms: RowPermissions })[];
  perms: { canEditActivities: boolean };
}

export interface ActivityDetail {
  activity: Activity & { owner_name?: string };
  tasks: (Task & { assignee_name?: string; perms: RowPermissions })[];
  notes: (QuickNote & { author_name?: string })[];
  communications: Communication[];
  contacts: Contact[];
  stats: { total: number; done: number; inProgress: number; blocked: number; overdue: number; day1Critical: number; hours: number };
  perms: { canEditActivity: boolean; canAddTask: boolean; canAddNote: boolean };
}

export interface TaskDetail {
  task: Task & { assignee_name?: string };
  communications: Communication[];
  notes: (QuickNote & { author_name?: string })[];
  history: AuditEntry[];
  perms: RowPermissions & { editableFields: (keyof Task)[] };
}

export interface DashboardData {
  kpis: {
    activeProjects: number; atRisk: number; avgCompletion: number; openTasks: number; overdueTasks: number;
    blockedTasks: number; day1CriticalOpen: number;
    /** finance KPIs are null when the persona lacks finance.view */
    feeBudget: number | null; feeBilled: number | null; tsaMonthly: number | null; fundingGap: number | null;
  };
  byStatus: { status: ProjectStatus; count: number }[];
  byRag: { rag: Rag; count: number }[];
  byStage: { stage: string; count: number }[];
  byIndustry: { industry: string; count: number }[];
  financeTrend: { period_month: string; fee_planned: number; fee_actual: number; tsa_cost: number }[] | null;
  upcoming: { task_id: string; title: string; project_id: string; code_name: string; due_date: string; status: WorkStatus; assignee_name?: string }[];
  /** Meaningful changes only (no sign-ins, reads or read-only AI calls), newest first, with a readable record name and link. */
  recentActivity: (AuditEntry & { record_label?: string; href?: string; code_name?: string })[];
}

export type PikuContextType = 'global' | 'project' | 'stage' | 'activity' | 'task';

export interface PikuRequest {
  message: string;
  /** 'auto' = detect from the message */
  language: Lang | 'auto';
  context: { type: PikuContextType; projectId?: string; stageId?: string; activityId?: string; taskId?: string };
}

export interface PikuResponse {
  answer: string;
  language: Lang;
  mode: string;                // e.g. "gemini-2.5-flash" or "offline"
  sources: { type: string; id: string; label: string; href?: string }[];
  suggestedActions?: { label: string; href?: string; prompt?: string }[];
}

/** AI "Get suggestion" in edit side panels */
export type SuggestKind = 'project' | 'stages' | 'stage' | 'activities' | 'activity' | 'tasks' | 'task' | 'project_fields';

export interface SuggestRequest {
  kind: SuggestKind;
  projectId?: string; stageId?: string; activityId?: string; taskId?: string;
  /** current form values (draft) */
  current?: Record<string, unknown>;
  /** for new projects: deal type / industry chosen in the form */
  hints?: { deal_type?: string; industry?: string; name?: string; description?: string };
}

export interface SuggestResponse {
  kind: SuggestKind;
  mode: string;
  rationale: string;
  /** knowledge items / past patterns used */
  sources: { id: string; label: string }[];
  /** Draft values. For list kinds: an array of rows to add. For single kinds: field -> value. (v1.4: = the recommended option) */
  draft: Record<string, unknown> | Record<string, unknown>[];
  /** v1.4: 2-3 alternative options (the recommended one is also `draft`). Older clients can ignore it. */
  options?: SuggestOption[];
  recommendedId?: string;
  /** v1.4: what the engine picked up from the typed form values (keywords, industry, residency ...) */
  inputSignals?: { id: string; label: string; matched: string[] }[];
}

export interface SummaryResponse { summary: string; mode: string; highlights: string[]; risks: string[]; nextSteps: string[] }

export interface CloseoutPreview {
  project: Project;
  metrics: Record<string, number | string>;
  proposedItems: Omit<KnowledgeItem, 'knowledge_id' | 'created_at' | 'is_deleted'>[];
  redactions: { field: string; original: string; redacted: string }[];
  lessonsDraft: string;
  mode: string;
}

export interface ApiError { error: string; code?: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'SERVER' }

// ---------------- Finance workspace (v1.3) ----------------
export interface EffortRow { key: string; label: string; hours: number; doneHours: number; value: number; tasks: number; people?: number; start?: string | null; end?: string | null; sub?: string }
export interface FinanceWorkspace {
  project: { project_id: string; code_name: string; currency: string; client_alias?: string; status: string; clean_team_required?: string };
  entries: FinanceEntry[];
  tsaServices: TsaService[];
  totals: Record<string, number>;
  rateCard: { persona: string; label: string; rate: number }[];
  effort: { byStage: EffortRow[]; byActivity: EffortRow[]; byPerson: (EffortRow & { persona?: string; billedBy?: number })[] };
  invoices: (Invoice & { billed_by_name?: string; stage_name?: string })[];
  costItems: (CostItem & { stage_name?: string; activity_name?: string })[];
  fundingSources: (FundingSource & { owner_name?: string })[];
  sourcesUses: {
    uses: { category: string; planned: number; committed: number; spent: number; total: number }[];
    byPayer: { payer: string; total: number }[];
    usesTotal: number; secured: number; pipeline: number; unfunded: number; recordedGap: number;
  };
  billing: { budget: number; invoiced: number; paid: number; outstanding: number; overdue: number; wip: number };
  perms: { canEdit: boolean; editReason?: string; viaGrant: boolean };
}

export interface AccessRequestRow extends AccessGrant {
  state: string; project_code?: string; grantee_name?: string; grantee_persona?: string; requested_by_name?: string;
  l1_name?: string; l2_name?: string; revoked_by_name?: string; label: string; risk_note?: string; clean_team?: boolean;
  can: { approveL1: boolean; approveL2: boolean; reject: boolean; cancel: boolean; revoke: boolean };
  why?: string;
}

// ---- v1.4 B: finance ----
// Interface merging: these add v1.4 columns / fields to the row and payload types declared above.
export interface Project { spa_seller_cap?: number | null; spa_clause_ref?: string | null }
export interface CostItem { buyer_usage_pct?: number | null }

export type FinancingRequestStatus = (typeof import('./schema').FINANCING_REQUEST_STATUS)[number];
export interface FinancingRequest extends AuditCols {
  request_id: string; project_id: string; bank_code: string; rm_name?: string | null; product: (typeof FUNDING_TYPES)[number];
  amount?: number | null; purpose?: string | null; status: FinancingRequestStatus; email_subject?: string | null; email_body?: string | null;
  sent_at?: string | null; last_update_at?: string | null; next_follow_up?: string | null; notes?: string | null;
  owner_user_id?: string | null; funding_id?: string | null;
}
export interface FinancingRequestRow extends FinancingRequest {
  bank_name: string; owner_name?: string; funding_status?: string;
  can: { edit: boolean; markSent: boolean; termSheet: boolean; decline: boolean; withdraw: boolean; reply: boolean };
}
export interface BankCard {
  code: string; name: string; kind: string; products: string[]; terms: string; minTicket: number; maxTicket: number; region: string;
  rm: { name: string; title: string; email: string; phone: string };
}

export type GapState = 'no-data' | 'estimate-only' | 'funded' | 'gap';
export type GapScenarioKey = 'beneficiary' | 'even' | 'usage' | 'avoided';
/** One line of evidence behind a scenario: a cost line (cost_id set) or a rule (credit, SPA cap). */
export interface GapEvidence { cost_id?: string; label: string; payer?: string | null; amount: number; rule: string; seller: number; buyer: number }
export interface GapScenario {
  key: GapScenarioKey; name: string; basis: string;
  /** Seller and buyer share of the whole one-time cost (seller + buyer = uses). */
  sellerShare: number; buyerShare: number;
  /** Seller share before the SPA cap, and how much the cap moved to the buyer. */
  sellerBeforeCap: number; capExcess: number;
  /** How much of the GAP each side must still fund (sellerGap + buyerGap = gap). */
  sellerGap: number; buyerGap: number;
  evidence: GapEvidence[]; notes: string[];
}
export interface GapRoute { type: string; funder: 'Buyer' | 'Seller'; amount: number; why: string; terms: string; watch: string }
export interface GapNextStep { text: string; owner: string; role: 'Partner' | 'Manager' }
export interface GapLesson { title: string; body: string; item_type: string; sources: string[] }
export interface GapAnalysis {
  state: GapState; currency: string;
  uses: number; secured: number; securedSeller: number; securedBuyer: number;
  pipeline: number; pipelineSeller: number; pipelineBuyer: number;
  gap: number; gapAfterPipeline: number; recordedGap: number; oneTimeEstimate: number;
  spa: { cap: number | null; clause: string | null };
  tsaRunRate: number;
  mix: { seller: number; buyer: number; shared: number; untagged: number; taggedPct: number; sharedPct: number };
  scenarios: GapScenario[];
  recommendation: { key: GapScenarioKey; name: string; reasons: string[] } | null;
  routes: GapRoute[]; nextSteps: GapNextStep[]; lessons: GapLesson[]; watch: string[]; assumptions: string[];
  /** Short line used in tiles and the AI summary. */
  headline: string;
}
export interface GapSummary { text: string; mode: string; figures: string[] }

export interface FinanceSetupState {
  /** true when the project has no cost lines, funding lines or invoices yet */
  isEmpty: boolean;
  hasCostLines: boolean; hasFunding: boolean; hasInvoices: boolean;
  feeBudgetSet: boolean; oneTimeEstimateSet: boolean; tsaRunRateSet: boolean; spaCapSet: boolean;
  spa_seller_cap: number | null; spa_clause_ref: string | null;
  missing: string[];
  /** who can set finance up when the viewer cannot */
  setupBy: string;
}
export interface FinanceWorkspace {
  gap: GapAnalysis;
  setup: FinanceSetupState;
  bankRequests: FinancingRequestRow[];
  banks: BankCard[];
  /** Bank outreach: Partners and Managers with finance.view draft; finance.edit marks sent / term sheet / declined. */
  bankPerms: { canDraft: boolean; canSend: boolean; reason?: string };
}

// ---- v1.4 C: AI, comms dialogs, widgets ----

/** One alternative AI suggestion (e.g. "Tailored to your inputs", "Standard playbook", "Lean / fast-track"). */
export interface SuggestOption {
  id: string;
  label: string;
  rationale: string;
  recommended?: boolean;
  draft: Record<string, unknown> | Record<string, unknown>[];
  /** Deduplicated knowledge items / playbook actually used by this option */
  sources: { id: string; label: string }[];
  /** Short phrases saying what came from the user's own inputs, e.g. "SAP S/4: ERP clone / carve-out activities" */
  fromInputs: string[];
  stats?: { stages?: number; activities?: number; tasks?: number; hours?: number; fields?: number };
  /** project_fields kind: why each field is suggested */
  fieldReasons?: Record<string, string>;
}

/** A person the meeting / email / call dialogs may address (already permission-filtered and masked by the server). */
export interface CommsPerson {
  id: string; name: string; kind: 'team' | 'contact'; role?: string; org?: string; side?: string;
  email?: string; phone?: string; emailMasked?: boolean; phoneMasked?: boolean;
}
export interface CommsContext {
  ref: { project_id: string; stage_id?: string | null; activity_id?: string | null; task_id?: string | null; label: string; code_name: string };
  people: CommsPerson[];
  /** May save meetings / emails / calls to the project log (notes.add, project open, not the client view) */
  canSave: boolean;
  canEmail: boolean;
  saveReason?: string;
}
export interface MeetingSuggestion {
  title: string; agenda: string[]; attendees: string[]; attendeeIds?: string[]; suggestedSlots: string[];
  /** v1.4: machine-readable slots (ISO start + label) */
  slots?: { label: string; start: string }[];
  durationMin?: number; mode: string;
}
export interface CommsLogRequest {
  scope: 'project' | 'stage' | 'activity' | 'task'; id: string;
  channel: 'Meeting' | 'Email' | 'Call';
  subject: string; body?: string; to_name?: string; occurred_at?: string; duration_min?: number; contact_id?: string | null;
  /** true when the text started as an AI draft (the audit entry is marked AI-assisted) */
  aiDrafted?: boolean;
}

/** Custom dashboard widgets: a spec validated against the server-side catalogue (never code or SQL). */
export type WidgetMetric =
  | 'task_count' | 'open_tasks' | 'overdue_tasks' | 'blocked_tasks' | 'day1_open' | 'hours_planned' | 'pct_complete_avg'
  | 'projects_count' | 'fee_budget' | 'fee_billed' | 'tsa_run_rate' | 'funding_gap';
export type WidgetGroupBy = 'none' | 'project' | 'stage' | 'status' | 'priority' | 'assignee' | 'stage_owner' | 'industry' | 'deal_type' | 'rag' | 'month';
export type WidgetChart = 'kpi' | 'bar' | 'hbar' | 'pie' | 'line' | 'table';
export interface WidgetSpec {
  title: string;
  metric: WidgetMetric;
  groupBy: WidgetGroupBy;
  chart: WidgetChart;
  filter?: { status?: string; projectId?: string; mine?: boolean; atRisk?: boolean };
}
export interface WidgetData {
  spec: WidgetSpec;
  unit: 'count' | 'money' | 'percent' | 'hours';
  currency?: string;
  total: number;
  rows: { key: string; label: string; value: number }[];
  note?: string;
}
export type WidgetSuggestResponse =
  | { possible: true; spec: WidgetSpec; explanation: string; mode: string }
  | { possible: false; reason: string; closestAlternatives: { spec: WidgetSpec; explanation: string }[]; suggestion: string; mode: string };

// ---- v1.4 A: access governance ----
/** A person who can act on the next step of an access request. */
export interface ApproverRef { user_id: string; name: string; role: string }

/** v1.4 fields on every access-request row (declaration-merged into AccessRequestRow above). */
export interface AccessRequestRow {
  /** "Level 1 only" / "Level 1 + Risk & Quality" for this project */
  policy?: string; needs_l2?: boolean; acting_role?: PersonaCode | null;
  age_days?: number; escalated?: boolean; pending_expires_at?: string | null; expired_pending?: boolean;
  next_level?: 0 | 1 | 2; next_approvers?: ApproverRef[]; blocked_reason?: string | null;
  status_line?: string; last_event_at?: string; last_event_by?: string | null; last_event_kind?: string;
  /** Mutating calls only: plain-words result for the toast */
  notice?: string;
}

/** GET /api/access/feed (top-bar bell) */
export interface AccessFeed { waiting: AccessRequestRow[]; updates: AccessRequestRow[] }

/** GET /api/access/preview */
export interface AccessPreview { policy: string; needsL2: boolean; durations: number[]; sponsored?: boolean; level1: ApproverRef[]; level2: ApproverRef[]; blocked: string | null }

/** Live extra access of one team member (TeamPanel chips). */
export interface MemberAccessChip { user_id: string; grant_id: string; label: string; acting_role?: PersonaCode | null; expires_at?: string | null }
