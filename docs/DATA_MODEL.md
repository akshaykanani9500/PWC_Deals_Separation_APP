# Data model

The database has **15 tables**. One definition in [`shared/schema.ts`](../shared/schema.ts) drives all three storage options:

| Storage | When | How a table is stored |
|---|---|---|
| Local JSON (`DB_DRIVER=local`, default) | Clone-and-run, offline demos, tests | `data/<table>.json` (array of rows) |
| Google Sheets (`DB_DRIVER=sheets`) | Shared team database for v1/v2 | One **tab** per table; row 1 = column names in schema order |
| Oracle (`DB_DRIVER=oracle`, planned v3) | Local enterprise DB | One table; DDL in `db/oracle/schema.sql` |

Everything in the app talks to the `Db` interface (`server/src/db/Db.ts`), never to a storage driver, so switching storage is a config change.

## How the tables link

```
personas 1─* users
users ─< project_members >─ projects            (who is staffed where = what they can see)
projects 1─* stages 1─* activities 1─* tasks      (the tracker: tabs, sub-tabs, table rows)
projects 1─* contacts, communications, quick_notes, finance_entries, tsa_services
communications / quick_notes may point at a stage, activity or task
projects ─(close-out)─> knowledge_items           (AI knowledge hub; source project hidden)
users 1─* chat_messages (Piku history)            audit_log records every write and denial
```

## Rules that keep Google Sheets easy to move to Oracle

1. **Names**: lower_snake_case, at most 30 characters, never an Oracle reserved word (`order`, `comment`, `date`, `level`, `user`, `type`, `size`, `mode`, `access`, `session`, `number`). A unit test enforces this.
2. **Keys**: every table has a text primary key `<entity>_id` such as `PRJ-0001`. No sequences or auto-increment needed, and ids never change when data moves.
3. **Booleans** are `Y` / `N` text (Oracle `CHAR(1)` with a CHECK).
4. **Dates** are `YYYY-MM-DD`; **timestamps** are ISO-8601 UTC (`2026-10-31T09:15:00.000Z`).
5. **Long text** columns are `text` (Oracle `CLOB`); **JSON** payloads are text holding JSON (Oracle `CLOB CHECK (col IS JSON)`).
6. **Enumerations** (status, priority, RAG...) are fixed lists in `shared/schema.ts` and become CHECK constraints in Oracle.
7. **No hard deletes**: rows get `is_deleted = 'Y'`. History and the audit trail stay complete.
8. **Foreign keys** are declared in the schema (`ref`) and become FK constraints plus indexes in Oracle.
9. **Computed values** (`percent_complete`, `rag`, derived `status` of activities and stages) are stored so dashboards and Oracle reports read them directly; the server recalculates them after every write (see the roll-up rule in `docs/API.md`).

### Editing the Google Sheet by hand
- Do not rename or reorder the header row. New columns added to the schema are appended automatically on start-up.
- Keep ids unique; leave `is_deleted` as `N` (or `Y` to hide a row).
- After hand edits, press **Reload from source** on the Data admin page (or restart the server). The app reads the sheet into memory and writes changes back row by row.

### Changing the schema
1. Edit `shared/schema.ts` (and `shared/types.ts`), bump `SCHEMA_VERSION`.
2. Run `npm run db:oracle-ddl` to regenerate `db/oracle/schema.sql`.
3. Write a one-line migration note below.

Migration notes: _none yet (schema version 1)._

## Tables
### `personas` (id prefix `PER`)

Roles that can sign in. Permissions are defined in shared/permissions.ts by persona code.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| persona_id | id | yes |  | primary key |
| code | string(20) | yes | EXEC, PARTNER, MANAGER, LEAD, ANALYST, KM, RISK, CLIENT, ADMIN |  |
| name | string(80) | yes |  |  |
| title | string(120) |  |  |  |
| description | text |  |  |  |
| home_route | string(80) |  |  |  |
| accent_color | string(20) |  |  |  |
| sort_order | int |  |  |  |

### `users` (id prefix `USR`)

Demo people. Login = pick a person from the dropdown; their persona decides what they can see and do.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| user_id | id | yes |  | primary key |
| persona_id | id | yes | personas.persona_id |  |
| full_name | string(120) | yes |  |  |
| email | string(160) |  |  |  |
| phone | string(40) |  |  |  |
| location | string(80) |  |  |  |
| org | string(80) |  |  |  |
| preferred_language | string(5) |  | en, hi |  |
| dashboard_layout | json |  |  | Saved widget layout for the dashboard |
| is_active | bool | yes |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `projects` (id prefix `PRJ`)

One separation engagement (deal).

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| project_id | id | yes |  | primary key |
| code_name | string(80) | yes |  | Deal code name, e.g. Project Phoenix |
| client_alias | string(120) |  |  | Client described without its real name |
| deal_type | string(40) |  | Sell-side carve-out, Buy-side carve-out, Spin-off, TSA exit, Day-1 readiness, Integration |  |
| industry | string(60) |  | Financial Services & Payments, Semiconductors & High-Tech, Healthcare & Life Sciences, Consumer & Retail, Industrial Manufacturing, Energy & Utilities, Telecom & Media |  |
| description | text |  |  |  |
| status | string(20) | yes | Planning, Active, At Risk, On Hold, Closing, Closed |  |
| rag | string(10) |  | Green, Amber, Red |  |
| percent_complete | number |  |  | Rolled up from activities; never typed by hand |
| current_stage_id | id |  | stages.stage_id |  |
| partner_user_id | id |  | users.user_id |  |
| manager_user_id | id |  | users.user_id |  |
| start_date | date |  |  |  |
| target_close_date | date |  |  |  |
| closed_date | date |  |  |  |
| currency | string(3) |  |  |  |
| fee_budget | money |  |  | PwC fee budget |
| fee_billed | money |  |  |  |
| tsa_monthly_cost | money |  |  | Client's current TSA run-rate per month |
| one_time_cost | money |  |  | Estimated one-time separation cost |
| funding_gap | money |  |  | Unresolved buyer/seller funding gap |
| apps_in_scope | int |  |  |  |
| sites_in_scope | int |  |  |  |
| employees_conveying | int |  |  |  |
| sensitivity | string(20) |  | Public, Internal, Confidential, Restricted |  |
| data_residency | string(40) |  |  |  |
| clean_team_required | bool |  |  |  |
| reuse_consent | string(20) |  | Granted, Not Granted, Pending |  |
| tags | string(400) |  |  | Comma-separated tags |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `project_members` (id prefix `MEM`)

Who is staffed on which project. Project visibility for most personas comes from this table.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| member_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| user_id | id | yes | users.user_id |  |
| member_role | string(40) |  | Partner, Manager, Workstream Lead, Analyst, Client Viewer, SME |  |
| workstream | string(80) |  |  | For leads: the stage(s)/workstream they lead |
| clean_team | bool |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `stages` (id prefix `STG`)

A stage of a project (shown as browser-style tabs). Default: Diligence, Signing, Day-1 readiness, TSA exit, Close-out.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| stage_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| name | string(120) | yes |  |  |
| description | text |  |  |  |
| sort_order | int | yes |  |  |
| status | string(20) |  | Not Started, In Progress, Blocked, Done |  |
| percent_complete | number |  |  |  |
| owner_user_id | id |  | users.user_id |  |
| start_date | date |  |  |  |
| end_date | date |  |  |  |
| gate_status | string(20) |  | Not Ready, Pending Approval, Approved |  |
| gate_criteria | text |  |  |  |
| gate_approver_id | id |  | users.user_id |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `activities` (id prefix `ACT`)

High-level activity inside a stage (e.g. "415-app migration wave plan"). Shown as sub-tabs.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| activity_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| stage_id | id | yes | stages.stage_id |  |
| name | string(160) | yes |  |  |
| description | text |  |  |  |
| sort_order | int | yes |  |  |
| status | string(20) |  | Not Started, In Progress, Blocked, Done |  |
| priority | string(10) |  | Low, Medium, High, Critical |  |
| percent_complete | number |  |  |  |
| owner_user_id | id |  | users.user_id |  |
| start_date | date |  |  |  |
| due_date | date |  |  |  |
| summary | text |  |  | Latest summary shown in the right-hand panel |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `tasks` (id prefix `TSK`)

Actionable item inside an activity: one row of the activity table; click opens the side panel.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| task_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| stage_id | id | yes | stages.stage_id |  |
| activity_id | id | yes | activities.activity_id |  |
| title | string(200) | yes |  |  |
| description | text |  |  |  |
| assignee_user_id | id |  | users.user_id |  |
| status | string(20) | yes | Not Started, In Progress, Blocked, Done |  |
| priority | string(10) |  | Low, Medium, High, Critical |  |
| start_date | date |  |  |  |
| due_date | date |  |  |  |
| completed_date | date |  |  |  |
| effort_hours | number |  |  |  |
| percent_complete | number |  |  |  |
| day1_critical | bool |  |  |  |
| dependency_notes | text |  |  | What this item is waiting on |
| done_notes | text |  |  | What has already happened |
| pending_notes | text |  |  | What is still pending |
| sort_order | int |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `contacts` (id prefix `CON`)

People outside the app (client, seller, vendor) linked to a project. Phone/email masked for some personas.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| contact_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| full_name | string(120) | yes |  |  |
| org | string(120) |  |  |  |
| role_title | string(120) |  |  |  |
| side | string(20) |  | PwC, Buyer, Seller, Vendor, Client |  |
| email | string(160) |  |  |  |
| phone | string(40) |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `communications` (id prefix `COM`)

Automatic chat/email/call/meeting history attached to a project, stage, activity or task.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| comm_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| stage_id | id |  | stages.stage_id |  |
| activity_id | id |  | activities.activity_id |  |
| task_id | id |  | tasks.task_id |  |
| channel | string(20) | yes | Email, Call, Meeting, Chat, Note |  |
| subject | string(240) |  |  |  |
| body | text |  |  |  |
| from_name | string(120) |  |  |  |
| to_name | string(240) |  |  |  |
| contact_id | id |  | contacts.contact_id |  |
| occurred_at | datetime | yes |  |  |
| duration_min | int |  |  | Calls and meetings |
| ai_summary | text |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `quick_notes` (id prefix `NOT`)

Quick notes in the right-hand panel of a stage/activity.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| note_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| stage_id | id |  | stages.stage_id |  |
| activity_id | id |  | activities.activity_id |  |
| task_id | id |  | tasks.task_id |  |
| body | text | yes |  |  |
| pinned | bool |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `finance_entries` (id prefix `FIN`)

Monthly finance per project (fees, TSA cost, one-time cost) for dashboard charts.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| finance_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| period_month | string(7) | yes |  | YYYY-MM |
| fee_planned | money |  |  |  |
| fee_actual | money |  |  |  |
| tsa_cost | money |  |  |  |
| one_time_cost | money |  |  |  |
| hours_logged | number |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `tsa_services` (id prefix `TSA`)

Transition services under the TSA, with price and term (feeds TSA cost widgets).

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| service_id | id | yes |  | primary key |
| project_id | id | yes | projects.project_id |  |
| name | string(160) | yes |  |  |
| provider | string(120) |  |  |  |
| monthly_fee | money |  |  |  |
| start_date | date |  |  |  |
| planned_exit_date | date |  |  |  |
| extension_uplift_pct | number |  |  |  |
| status | string(20) |  | Active, Exiting, Exited, Extended |  |
| linked_apps | string(400) |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `knowledge_items` (id prefix `KNW`)

AI knowledge hub: redacted, consent-checked learnings from closed projects. Feeds AI suggestions.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| knowledge_id | id | yes |  | primary key |
| source_project_id | id |  | projects.project_id | Kept for audit only; never shown to AI or users |
| source_label | string(120) |  |  | Anonymised label, e.g. "Payments TSA exit, 2025" |
| item_type | string(30) | yes | Stage Template, Activity Template, Task Template, Lesson, Metric, Risk |  |
| deal_type | string(40) |  | Sell-side carve-out, Buy-side carve-out, Spin-off, TSA exit, Day-1 readiness, Integration |  |
| industry | string(60) |  | Financial Services & Payments, Semiconductors & High-Tech, Healthcare & Life Sciences, Consumer & Retail, Industrial Manufacturing, Energy & Utilities, Telecom & Media |  |
| stage_name | string(120) |  |  |  |
| title | string(200) | yes |  |  |
| body | text |  |  | Redacted text |
| payload | json |  |  | Structured data, e.g. activities + tasks for a template |
| tags | string(400) |  |  |  |
| consent_status | string(20) |  | Granted, Not Granted, Pending |  |
| review_status | string(20) | yes | Pending Review, Approved, Rejected |  |
| reviewed_by | id |  | users.user_id |  |
| reviewed_at | datetime |  |  |  |
| times_used | int |  |  |  |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `chat_messages` (id prefix `MSG`)

Piku conversation history (per user, with the page context it was asked on).

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| message_id | id | yes |  | primary key |
| user_id | id | yes | users.user_id |  |
| project_id | id |  | projects.project_id |  |
| context_type | string(20) |  | global, project, stage, activity, task |  |
| context_id | id |  |  |  |
| sender | string(10) | yes | user, piku |  |
| body | text | yes |  |  |
| language | string(5) |  | en, hi |  |
| ai_mode | string(20) |  |  | gemini model name or "offline" |
| sources | json |  |  | Records the answer was built from |
| created_at | datetime | yes |  |  |
| created_by | id |  | users.user_id |  |
| updated_at | datetime |  |  |  |
| updated_by | id |  | users.user_id |  |
| is_deleted | bool | yes |  | 'Y' when soft-deleted |

### `audit_log` (id prefix `AUD`)

Every create/update/delete, AI suggestion, approval and denied access.

| Column | Type | Required | Links to / allowed values | Notes |
|---|---|---|---|---|
| audit_id | id | yes |  | primary key |
| actor_user_id | id |  | users.user_id |  |
| persona_code | string(20) |  |  |  |
| action | string(60) | yes |  |  |
| entity_type | string(40) |  |  |  |
| entity_id | id |  |  |  |
| project_id | id |  | projects.project_id |  |
| details | json |  |  |  |
| ai_generated | bool |  |  |  |
| created_at | datetime | yes |  |  |

