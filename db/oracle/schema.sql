-- Deals Separation Hub - Oracle schema (generated from shared/schema.ts by `npm run db:oracle-ddl`). Do not edit by hand.
-- Tested shape: Oracle Database 19c+ / 23ai Free. Run as the application schema owner.

-- Roles that can sign in. Permissions are defined in shared/permissions.ts by persona code.
CREATE TABLE personas (
  persona_id                   VARCHAR2(40) NOT NULL,
  code                         VARCHAR2(20) NOT NULL,
  name                         VARCHAR2(80) NOT NULL,
  title                        VARCHAR2(120),
  description                  CLOB,
  home_route                   VARCHAR2(80),
  accent_color                 VARCHAR2(20),
  sort_order                   NUMBER(10),
  CONSTRAINT pk_personas PRIMARY KEY (persona_id),
  CONSTRAINT ck_personas_code CHECK (code IN ('EXEC', 'PARTNER', 'MANAGER', 'LEAD', 'ANALYST', 'KM', 'RISK', 'CLIENT', 'ADMIN'))
);

-- Demo people. Login = pick a person from the dropdown; their persona decides what they can see and do.
CREATE TABLE users (
  user_id                      VARCHAR2(40) NOT NULL,
  persona_id                   VARCHAR2(40) NOT NULL,
  full_name                    VARCHAR2(120) NOT NULL,
  email                        VARCHAR2(160),
  phone                        VARCHAR2(40),
  location                     VARCHAR2(80),
  org                          VARCHAR2(80),
  preferred_language           VARCHAR2(5),
  dashboard_layout             CLOB,
  is_active                    CHAR(1) NOT NULL,
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_users PRIMARY KEY (user_id),
  CONSTRAINT ck_users_preferred_language CHECK (preferred_language IN ('en', 'hi')),
  CONSTRAINT ck_users_dashboard_layout CHECK (dashboard_layout IS JSON),
  CONSTRAINT ck_users_is_active CHECK (is_active IN ('Y','N')),
  CONSTRAINT ck_users_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_users_persona_id ON users (persona_id);
CREATE INDEX ix_users_created_by ON users (created_by);
CREATE INDEX ix_users_updated_by ON users (updated_by);

-- One separation engagement (deal).
CREATE TABLE projects (
  project_id                   VARCHAR2(40) NOT NULL,
  code_name                    VARCHAR2(80) NOT NULL,
  client_alias                 VARCHAR2(120),
  deal_type                    VARCHAR2(40),
  industry                     VARCHAR2(60),
  description                  CLOB,
  status                       VARCHAR2(20) NOT NULL,
  rag                          VARCHAR2(10),
  percent_complete             NUMBER,
  current_stage_id             VARCHAR2(40),
  partner_user_id              VARCHAR2(40),
  manager_user_id              VARCHAR2(40),
  start_date                   DATE,
  target_close_date            DATE,
  closed_date                  DATE,
  currency                     VARCHAR2(3),
  fee_budget                   NUMBER(18,2),
  fee_billed                   NUMBER(18,2),
  tsa_monthly_cost             NUMBER(18,2),
  one_time_cost                NUMBER(18,2),
  funding_gap                  NUMBER(18,2),
  apps_in_scope                NUMBER(10),
  sites_in_scope               NUMBER(10),
  employees_conveying          NUMBER(10),
  sensitivity                  VARCHAR2(20),
  data_residency               VARCHAR2(40),
  clean_team_required          CHAR(1),
  reuse_consent                VARCHAR2(20),
  tags                         VARCHAR2(400),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_projects PRIMARY KEY (project_id),
  CONSTRAINT ck_projects_deal_type CHECK (deal_type IN ('Sell-side carve-out', 'Buy-side carve-out', 'Spin-off', 'TSA exit', 'Day-1 readiness', 'Integration')),
  CONSTRAINT ck_projects_industry CHECK (industry IN ('Financial Services & Payments', 'Semiconductors & High-Tech', 'Healthcare & Life Sciences', 'Consumer & Retail', 'Industrial Manufacturing', 'Energy & Utilities', 'Telecom & Media')),
  CONSTRAINT ck_projects_status CHECK (status IN ('Planning', 'Active', 'At Risk', 'On Hold', 'Closing', 'Closed')),
  CONSTRAINT ck_projects_rag CHECK (rag IN ('Green', 'Amber', 'Red')),
  CONSTRAINT ck_projects_sensitivity CHECK (sensitivity IN ('Public', 'Internal', 'Confidential', 'Restricted')),
  CONSTRAINT ck_projects_clean_team_require CHECK (clean_team_required IN ('Y','N')),
  CONSTRAINT ck_projects_reuse_consent CHECK (reuse_consent IN ('Granted', 'Not Granted', 'Pending')),
  CONSTRAINT ck_projects_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_projects_current_stage_id ON projects (current_stage_id);
CREATE INDEX ix_projects_partner_user_id ON projects (partner_user_id);
CREATE INDEX ix_projects_manager_user_id ON projects (manager_user_id);
CREATE INDEX ix_projects_created_by ON projects (created_by);
CREATE INDEX ix_projects_updated_by ON projects (updated_by);

-- Who is staffed on which project. Project visibility for most personas comes from this table.
CREATE TABLE project_members (
  member_id                    VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  user_id                      VARCHAR2(40) NOT NULL,
  member_role                  VARCHAR2(40),
  workstream                   VARCHAR2(80),
  clean_team                   CHAR(1),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_project_members PRIMARY KEY (member_id),
  CONSTRAINT ck_project_members_member_role CHECK (member_role IN ('Partner', 'Manager', 'Workstream Lead', 'Analyst', 'Client Viewer', 'SME')),
  CONSTRAINT ck_project_members_clean_team CHECK (clean_team IN ('Y','N')),
  CONSTRAINT ck_project_members_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_project_members_project_id ON project_members (project_id);
CREATE INDEX ix_project_members_user_id ON project_members (user_id);
CREATE INDEX ix_project_members_created_by ON project_members (created_by);
CREATE INDEX ix_project_members_updated_by ON project_members (updated_by);

-- A stage of a project (shown as browser-style tabs). Default: Diligence, Signing, Day-1 readiness, TSA exit, Close-out.
CREATE TABLE stages (
  stage_id                     VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  name                         VARCHAR2(120) NOT NULL,
  description                  CLOB,
  sort_order                   NUMBER(10) NOT NULL,
  status                       VARCHAR2(20),
  percent_complete             NUMBER,
  owner_user_id                VARCHAR2(40),
  start_date                   DATE,
  end_date                     DATE,
  gate_status                  VARCHAR2(20),
  gate_criteria                CLOB,
  gate_approver_id             VARCHAR2(40),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_stages PRIMARY KEY (stage_id),
  CONSTRAINT ck_stages_status CHECK (status IN ('Not Started', 'In Progress', 'Blocked', 'Done')),
  CONSTRAINT ck_stages_gate_status CHECK (gate_status IN ('Not Ready', 'Pending Approval', 'Approved')),
  CONSTRAINT ck_stages_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_stages_project_id ON stages (project_id);
CREATE INDEX ix_stages_owner_user_id ON stages (owner_user_id);
CREATE INDEX ix_stages_gate_approver_id ON stages (gate_approver_id);
CREATE INDEX ix_stages_created_by ON stages (created_by);
CREATE INDEX ix_stages_updated_by ON stages (updated_by);

-- High-level activity inside a stage (e.g. "415-app migration wave plan"). Shown as sub-tabs.
CREATE TABLE activities (
  activity_id                  VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  stage_id                     VARCHAR2(40) NOT NULL,
  name                         VARCHAR2(160) NOT NULL,
  description                  CLOB,
  sort_order                   NUMBER(10) NOT NULL,
  status                       VARCHAR2(20),
  priority                     VARCHAR2(10),
  percent_complete             NUMBER,
  owner_user_id                VARCHAR2(40),
  start_date                   DATE,
  due_date                     DATE,
  summary                      CLOB,
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_activities PRIMARY KEY (activity_id),
  CONSTRAINT ck_activities_status CHECK (status IN ('Not Started', 'In Progress', 'Blocked', 'Done')),
  CONSTRAINT ck_activities_priority CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
  CONSTRAINT ck_activities_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_activities_project_id ON activities (project_id);
CREATE INDEX ix_activities_stage_id ON activities (stage_id);
CREATE INDEX ix_activities_owner_user_id ON activities (owner_user_id);
CREATE INDEX ix_activities_created_by ON activities (created_by);
CREATE INDEX ix_activities_updated_by ON activities (updated_by);

-- Actionable item inside an activity: one row of the activity table; click opens the side panel.
CREATE TABLE tasks (
  task_id                      VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  stage_id                     VARCHAR2(40) NOT NULL,
  activity_id                  VARCHAR2(40) NOT NULL,
  title                        VARCHAR2(200) NOT NULL,
  description                  CLOB,
  assignee_user_id             VARCHAR2(40),
  status                       VARCHAR2(20) NOT NULL,
  priority                     VARCHAR2(10),
  start_date                   DATE,
  due_date                     DATE,
  completed_date               DATE,
  effort_hours                 NUMBER,
  percent_complete             NUMBER,
  day1_critical                CHAR(1),
  dependency_notes             CLOB,
  done_notes                   CLOB,
  pending_notes                CLOB,
  sort_order                   NUMBER(10),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_tasks PRIMARY KEY (task_id),
  CONSTRAINT ck_tasks_status CHECK (status IN ('Not Started', 'In Progress', 'Blocked', 'Done')),
  CONSTRAINT ck_tasks_priority CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
  CONSTRAINT ck_tasks_day1_critical CHECK (day1_critical IN ('Y','N')),
  CONSTRAINT ck_tasks_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_tasks_project_id ON tasks (project_id);
CREATE INDEX ix_tasks_stage_id ON tasks (stage_id);
CREATE INDEX ix_tasks_activity_id ON tasks (activity_id);
CREATE INDEX ix_tasks_assignee_user_id ON tasks (assignee_user_id);
CREATE INDEX ix_tasks_created_by ON tasks (created_by);
CREATE INDEX ix_tasks_updated_by ON tasks (updated_by);

-- People outside the app (client, seller, vendor) linked to a project. Phone/email masked for some personas.
CREATE TABLE contacts (
  contact_id                   VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  full_name                    VARCHAR2(120) NOT NULL,
  org                          VARCHAR2(120),
  role_title                   VARCHAR2(120),
  side                         VARCHAR2(20),
  email                        VARCHAR2(160),
  phone                        VARCHAR2(40),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_contacts PRIMARY KEY (contact_id),
  CONSTRAINT ck_contacts_side CHECK (side IN ('PwC', 'Buyer', 'Seller', 'Vendor', 'Client')),
  CONSTRAINT ck_contacts_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_contacts_project_id ON contacts (project_id);
CREATE INDEX ix_contacts_created_by ON contacts (created_by);
CREATE INDEX ix_contacts_updated_by ON contacts (updated_by);

-- Automatic chat/email/call/meeting history attached to a project, stage, activity or task.
CREATE TABLE communications (
  comm_id                      VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  stage_id                     VARCHAR2(40),
  activity_id                  VARCHAR2(40),
  task_id                      VARCHAR2(40),
  channel                      VARCHAR2(20) NOT NULL,
  subject                      VARCHAR2(240),
  body                         CLOB,
  from_name                    VARCHAR2(120),
  to_name                      VARCHAR2(240),
  contact_id                   VARCHAR2(40),
  occurred_at                  TIMESTAMP NOT NULL,
  duration_min                 NUMBER(10),
  ai_summary                   CLOB,
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_communications PRIMARY KEY (comm_id),
  CONSTRAINT ck_communications_channel CHECK (channel IN ('Email', 'Call', 'Meeting', 'Chat', 'Note')),
  CONSTRAINT ck_communications_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_communications_project_id ON communications (project_id);
CREATE INDEX ix_communications_stage_id ON communications (stage_id);
CREATE INDEX ix_communications_activity_id ON communications (activity_id);
CREATE INDEX ix_communications_task_id ON communications (task_id);
CREATE INDEX ix_communications_contact_id ON communications (contact_id);
CREATE INDEX ix_communications_created_by ON communications (created_by);
CREATE INDEX ix_communications_updated_by ON communications (updated_by);

-- Quick notes in the right-hand panel of a stage/activity.
CREATE TABLE quick_notes (
  note_id                      VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  stage_id                     VARCHAR2(40),
  activity_id                  VARCHAR2(40),
  task_id                      VARCHAR2(40),
  body                         CLOB NOT NULL,
  pinned                       CHAR(1),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_quick_notes PRIMARY KEY (note_id),
  CONSTRAINT ck_quick_notes_pinned CHECK (pinned IN ('Y','N')),
  CONSTRAINT ck_quick_notes_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_quick_notes_project_id ON quick_notes (project_id);
CREATE INDEX ix_quick_notes_stage_id ON quick_notes (stage_id);
CREATE INDEX ix_quick_notes_activity_id ON quick_notes (activity_id);
CREATE INDEX ix_quick_notes_task_id ON quick_notes (task_id);
CREATE INDEX ix_quick_notes_created_by ON quick_notes (created_by);
CREATE INDEX ix_quick_notes_updated_by ON quick_notes (updated_by);

-- Monthly finance per project (fees, TSA cost, one-time cost) for dashboard charts.
CREATE TABLE finance_entries (
  finance_id                   VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  period_month                 VARCHAR2(7) NOT NULL,
  fee_planned                  NUMBER(18,2),
  fee_actual                   NUMBER(18,2),
  tsa_cost                     NUMBER(18,2),
  one_time_cost                NUMBER(18,2),
  hours_logged                 NUMBER,
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_finance_entries PRIMARY KEY (finance_id),
  CONSTRAINT ck_finance_entries_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_finance_entries_project_id ON finance_entries (project_id);
CREATE INDEX ix_finance_entries_created_by ON finance_entries (created_by);
CREATE INDEX ix_finance_entries_updated_by ON finance_entries (updated_by);

-- Transition services under the TSA, with price and term (feeds TSA cost widgets).
CREATE TABLE tsa_services (
  service_id                   VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40) NOT NULL,
  name                         VARCHAR2(160) NOT NULL,
  provider                     VARCHAR2(120),
  monthly_fee                  NUMBER(18,2),
  start_date                   DATE,
  planned_exit_date            DATE,
  extension_uplift_pct         NUMBER,
  status                       VARCHAR2(20),
  linked_apps                  VARCHAR2(400),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_tsa_services PRIMARY KEY (service_id),
  CONSTRAINT ck_tsa_services_status CHECK (status IN ('Active', 'Exiting', 'Exited', 'Extended')),
  CONSTRAINT ck_tsa_services_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_tsa_services_project_id ON tsa_services (project_id);
CREATE INDEX ix_tsa_services_created_by ON tsa_services (created_by);
CREATE INDEX ix_tsa_services_updated_by ON tsa_services (updated_by);

-- AI knowledge hub: redacted, consent-checked learnings from closed projects. Feeds AI suggestions.
CREATE TABLE knowledge_items (
  knowledge_id                 VARCHAR2(40) NOT NULL,
  source_project_id            VARCHAR2(40),
  source_label                 VARCHAR2(120),
  item_type                    VARCHAR2(30) NOT NULL,
  deal_type                    VARCHAR2(40),
  industry                     VARCHAR2(60),
  stage_name                   VARCHAR2(120),
  title                        VARCHAR2(200) NOT NULL,
  body                         CLOB,
  payload                      CLOB,
  tags                         VARCHAR2(400),
  consent_status               VARCHAR2(20),
  review_status                VARCHAR2(20) NOT NULL,
  reviewed_by                  VARCHAR2(40),
  reviewed_at                  TIMESTAMP,
  times_used                   NUMBER(10),
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_knowledge_items PRIMARY KEY (knowledge_id),
  CONSTRAINT ck_knowledge_items_item_type CHECK (item_type IN ('Stage Template', 'Activity Template', 'Task Template', 'Lesson', 'Metric', 'Risk')),
  CONSTRAINT ck_knowledge_items_deal_type CHECK (deal_type IN ('Sell-side carve-out', 'Buy-side carve-out', 'Spin-off', 'TSA exit', 'Day-1 readiness', 'Integration')),
  CONSTRAINT ck_knowledge_items_industry CHECK (industry IN ('Financial Services & Payments', 'Semiconductors & High-Tech', 'Healthcare & Life Sciences', 'Consumer & Retail', 'Industrial Manufacturing', 'Energy & Utilities', 'Telecom & Media')),
  CONSTRAINT ck_knowledge_items_payload CHECK (payload IS JSON),
  CONSTRAINT ck_knowledge_items_consent_sta CHECK (consent_status IN ('Granted', 'Not Granted', 'Pending')),
  CONSTRAINT ck_knowledge_items_review_stat CHECK (review_status IN ('Pending Review', 'Approved', 'Rejected')),
  CONSTRAINT ck_knowledge_items_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_knowledge_items_source_proj ON knowledge_items (source_project_id);
CREATE INDEX ix_knowledge_items_reviewed_by ON knowledge_items (reviewed_by);
CREATE INDEX ix_knowledge_items_created_by ON knowledge_items (created_by);
CREATE INDEX ix_knowledge_items_updated_by ON knowledge_items (updated_by);

-- Piku conversation history (per user, with the page context it was asked on).
CREATE TABLE chat_messages (
  message_id                   VARCHAR2(40) NOT NULL,
  user_id                      VARCHAR2(40) NOT NULL,
  project_id                   VARCHAR2(40),
  context_type                 VARCHAR2(20),
  context_id                   VARCHAR2(40),
  sender                       VARCHAR2(10) NOT NULL,
  body                         CLOB NOT NULL,
  language                     VARCHAR2(5),
  ai_mode                      VARCHAR2(20),
  sources                      CLOB,
  created_at                   TIMESTAMP NOT NULL,
  created_by                   VARCHAR2(40),
  updated_at                   TIMESTAMP,
  updated_by                   VARCHAR2(40),
  is_deleted                   CHAR(1) DEFAULT 'N' NOT NULL,
  CONSTRAINT pk_chat_messages PRIMARY KEY (message_id),
  CONSTRAINT ck_chat_messages_context_type CHECK (context_type IN ('global', 'project', 'stage', 'activity', 'task')),
  CONSTRAINT ck_chat_messages_sender CHECK (sender IN ('user', 'piku')),
  CONSTRAINT ck_chat_messages_language CHECK (language IN ('en', 'hi')),
  CONSTRAINT ck_chat_messages_sources CHECK (sources IS JSON),
  CONSTRAINT ck_chat_messages_is_deleted CHECK (is_deleted IN ('Y','N'))
);
CREATE INDEX ix_chat_messages_user_id ON chat_messages (user_id);
CREATE INDEX ix_chat_messages_project_id ON chat_messages (project_id);
CREATE INDEX ix_chat_messages_created_by ON chat_messages (created_by);
CREATE INDEX ix_chat_messages_updated_by ON chat_messages (updated_by);

-- Every create/update/delete, AI suggestion, approval and denied access.
CREATE TABLE audit_log (
  audit_id                     VARCHAR2(40) NOT NULL,
  actor_user_id                VARCHAR2(40),
  persona_code                 VARCHAR2(20),
  action                       VARCHAR2(60) NOT NULL,
  entity_type                  VARCHAR2(40),
  entity_id                    VARCHAR2(40),
  project_id                   VARCHAR2(40),
  details                      CLOB,
  ai_generated                 CHAR(1),
  created_at                   TIMESTAMP NOT NULL,
  CONSTRAINT pk_audit_log PRIMARY KEY (audit_id),
  CONSTRAINT ck_audit_log_details CHECK (details IS JSON),
  CONSTRAINT ck_audit_log_ai_generated CHECK (ai_generated IN ('Y','N'))
);
CREATE INDEX ix_audit_log_actor_user_id ON audit_log (actor_user_id);
CREATE INDEX ix_audit_log_project_id ON audit_log (project_id);

-- Foreign keys (added after all tables exist)
ALTER TABLE users ADD CONSTRAINT fk_users_persona_id FOREIGN KEY (persona_id) REFERENCES personas (persona_id);
ALTER TABLE users ADD CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE users ADD CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE projects ADD CONSTRAINT fk_projects_current_stage_id FOREIGN KEY (current_stage_id) REFERENCES stages (stage_id);
ALTER TABLE projects ADD CONSTRAINT fk_projects_partner_user_id FOREIGN KEY (partner_user_id) REFERENCES users (user_id);
ALTER TABLE projects ADD CONSTRAINT fk_projects_manager_user_id FOREIGN KEY (manager_user_id) REFERENCES users (user_id);
ALTER TABLE projects ADD CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE projects ADD CONSTRAINT fk_projects_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE project_members ADD CONSTRAINT fk_project_members_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE project_members ADD CONSTRAINT fk_project_members_user_id FOREIGN KEY (user_id) REFERENCES users (user_id);
ALTER TABLE project_members ADD CONSTRAINT fk_project_members_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE project_members ADD CONSTRAINT fk_project_members_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE stages ADD CONSTRAINT fk_stages_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE stages ADD CONSTRAINT fk_stages_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES users (user_id);
ALTER TABLE stages ADD CONSTRAINT fk_stages_gate_approver_id FOREIGN KEY (gate_approver_id) REFERENCES users (user_id);
ALTER TABLE stages ADD CONSTRAINT fk_stages_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE stages ADD CONSTRAINT fk_stages_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE activities ADD CONSTRAINT fk_activities_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE activities ADD CONSTRAINT fk_activities_stage_id FOREIGN KEY (stage_id) REFERENCES stages (stage_id);
ALTER TABLE activities ADD CONSTRAINT fk_activities_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES users (user_id);
ALTER TABLE activities ADD CONSTRAINT fk_activities_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE activities ADD CONSTRAINT fk_activities_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_stage_id FOREIGN KEY (stage_id) REFERENCES stages (stage_id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_activity_id FOREIGN KEY (activity_id) REFERENCES activities (activity_id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_assignee_user_id FOREIGN KEY (assignee_user_id) REFERENCES users (user_id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE contacts ADD CONSTRAINT fk_contacts_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE contacts ADD CONSTRAINT fk_contacts_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE contacts ADD CONSTRAINT fk_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE communications ADD CONSTRAINT fk_communications_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE communications ADD CONSTRAINT fk_communications_stage_id FOREIGN KEY (stage_id) REFERENCES stages (stage_id);
ALTER TABLE communications ADD CONSTRAINT fk_communications_activity_id FOREIGN KEY (activity_id) REFERENCES activities (activity_id);
ALTER TABLE communications ADD CONSTRAINT fk_communications_task_id FOREIGN KEY (task_id) REFERENCES tasks (task_id);
ALTER TABLE communications ADD CONSTRAINT fk_communications_contact_id FOREIGN KEY (contact_id) REFERENCES contacts (contact_id);
ALTER TABLE communications ADD CONSTRAINT fk_communications_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE communications ADD CONSTRAINT fk_communications_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE quick_notes ADD CONSTRAINT fk_quick_notes_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE quick_notes ADD CONSTRAINT fk_quick_notes_stage_id FOREIGN KEY (stage_id) REFERENCES stages (stage_id);
ALTER TABLE quick_notes ADD CONSTRAINT fk_quick_notes_activity_id FOREIGN KEY (activity_id) REFERENCES activities (activity_id);
ALTER TABLE quick_notes ADD CONSTRAINT fk_quick_notes_task_id FOREIGN KEY (task_id) REFERENCES tasks (task_id);
ALTER TABLE quick_notes ADD CONSTRAINT fk_quick_notes_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE quick_notes ADD CONSTRAINT fk_quick_notes_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE finance_entries ADD CONSTRAINT fk_finance_entries_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE finance_entries ADD CONSTRAINT fk_finance_entries_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE finance_entries ADD CONSTRAINT fk_finance_entries_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE tsa_services ADD CONSTRAINT fk_tsa_services_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE tsa_services ADD CONSTRAINT fk_tsa_services_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE tsa_services ADD CONSTRAINT fk_tsa_services_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE knowledge_items ADD CONSTRAINT fk_knowledge_items_source_proj FOREIGN KEY (source_project_id) REFERENCES projects (project_id);
ALTER TABLE knowledge_items ADD CONSTRAINT fk_knowledge_items_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users (user_id);
ALTER TABLE knowledge_items ADD CONSTRAINT fk_knowledge_items_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE knowledge_items ADD CONSTRAINT fk_knowledge_items_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_user_id FOREIGN KEY (user_id) REFERENCES users (user_id);
ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_created_by FOREIGN KEY (created_by) REFERENCES users (user_id);
ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_updated_by FOREIGN KEY (updated_by) REFERENCES users (user_id);
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_log_actor_user_id FOREIGN KEY (actor_user_id) REFERENCES users (user_id);
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_log_project_id FOREIGN KEY (project_id) REFERENCES projects (project_id);
