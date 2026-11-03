# API contract (v1)

All endpoints are under `/api`. JSON in, JSON out. Types live in `shared/types.ts`.
Authenticated endpoints need `Authorization: Bearer <token>` (token from `POST /api/auth/login`).
Errors: `{ "error": "message", "code": "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "SERVER" }` with HTTP 401/403/404/400/500.

**Permission rule for every route:** the server checks the persona's action (`shared/permissions.ts`) AND that the project
is visible to the user (`services/access.ts`). A denied request is written to `audit_log` with action `access.denied`.
Finance fields are stripped for personas without `finance.view`; contacts are masked without `contacts.view.full`.
Every successful write is written to `audit_log`.

Owner of each block in brackets: **[A1]** = Agent 1 (data/API), **[A3]** = Agent 3 (AI).

## Auth and meta [A1]
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/auth/personas` (public) | – | `{ personas: Persona[], users: (User & { persona_code, persona_name, persona_title, summary })[] }` for the login dropdown |
| POST | `/auth/login` (public) | `{ userId }` | `Session` |
| GET | `/auth/me` | – | `Session` |
| POST | `/auth/logout` | – | `{ ok: true }` |
| GET | `/meta` (public) | – | `{ enums: {...all enum arrays from schema.ts}, dbDriver, aiMode: 'gemini' \| 'offline', schemaVersion, appVersion }` |
| GET | `/users` | – | `{ user_id, full_name, persona_code, email }[]` (for assignee pickers) |
| PUT | `/users/me/preferences` | `{ dashboard_layout?, preferred_language? }` | `User` |

## Dashboard [A1]
| GET | `/dashboard` | – | `DashboardData` (only visible projects; finance null without `finance.view`; `recentActivity` = meaningful changes only (creates, edits, removals, gates, close-outs, approvals; no sign-ins, reads or read-only AI calls), each with `record_label`, `href`, `code_name`; CLIENT gets task/stage/activity progress only, without details or AI-assisted entries) |

## Projects [A1]
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/projects` | `?q=&status=&industry=&rag=&includeClosed=1` | `ProjectListItem[]` |
| POST | `/projects` | `Partial<Project>` + optional `stages: [{ name, description?, activities?: [{ name, description?, priority?, tasks?: [{ title, priority?, day1_critical? }] }] }]` + optional `members: [{ user_id, member_role }]` | `ProjectDetail`. Needs `project.create`. Creator becomes a member. If `stages` omitted, the 5 default stages are created. |
| GET | `/projects/:id` | – | `ProjectDetail` |
| PATCH | `/projects/:id` | `Partial<Project>` | `ProjectDetail` (`project.edit`) |
| DELETE | `/projects/:id` | – | `{ ok }` soft delete (`project.edit`, PARTNER/MANAGER only) |
| GET | `/projects/:id/finance` | – | `FinanceWorkspace` (`finance.view`, from the role or an active access grant on this project): `entries`, `tsaServices`, `totals` (v1.2 keys kept), `rateCard`, `effort.{byStage,byActivity,byPerson}`, `invoices`, `costItems`, `fundingSources`, `sourcesUses`, `billing`, `perms.{canEdit,viaGrant}` |
| POST | `/projects/:id/finance/{funding\|costs\|invoices}` | row fields | created row (`finance.edit`, project open; stage/activity must belong to the project) |
| PATCH | `/projects/:id/finance/{funding\|costs\|invoices}/:rowId` | partial row | updated row (`finance.edit`) |
| DELETE | `/projects/:id/finance/{funding\|costs\|invoices}/:rowId` | – | `{ ok }` soft delete (`finance.edit`) |
| GET | `/projects/:id/members` | – | members with names |
| POST | `/projects/:id/members` | `{ user_id, member_role, workstream? }` | member (`project.edit`) |
| DELETE | `/projects/:id/members/:memberId` | – | `{ ok }` |
| GET | `/projects/:id/contacts` | – | `Contact[]` (masked as needed; CLIENT gets []) |
| GET | `/projects/:id/communications` | `?stageId=&activityId=&taskId=` | `Communication[]` newest first (filtered by `filterCommunications`) |
| POST | `/projects/:id/communications` | `{ channel, subject, body, stage_id?, activity_id?, task_id?, to_name? }` | `Communication` (`notes.add`) |
| POST | `/projects/:id/stages` | `{ name, description?, gate_criteria?, owner_user_id? }` | `Stage` (`stage.edit`) |
| POST | `/projects/:id/stages/bulk` | `{ stages: [...same shape as POST /projects stages] }` | `Stage[]` (applies an AI suggestion) |
| POST | `/projects/:id/stages/reorder` | `{ stageIds: string[] }` | `Stage[]` |

## Stages [A1]
| GET | `/stages/:id` | – | `StageDetail` |
| PATCH | `/stages/:id` | `Partial<Stage>` | `Stage` (`stage.edit`) |
| DELETE | `/stages/:id` | – | `{ ok }` soft delete incl. its activities/tasks (`stage.edit`) |
| POST | `/stages/:id/gate` | `{ action: 'request' \| 'approve' \| 'reopen' }` | `Stage` (approve needs `stage.gate.approve`; sets project.current_stage_id to next stage) |
| POST | `/stages/:id/activities` | `Partial<Activity>` | `Activity` (`activity.edit` + row rule) |
| POST | `/stages/:id/activities/bulk` | `{ activities: [{ name, description?, priority?, owner_user_id?, due_date?, tasks?: [...] }] }` | `Activity[]` |
| POST | `/stages/:id/activities/reorder` | `{ activityIds }` | `Activity[]` |

## Activities and tasks [A1]
| GET | `/activities/:id` | – | `ActivityDetail` |
| PATCH | `/activities/:id` | `Partial<Activity>` | `Activity` |
| DELETE | `/activities/:id` | – | `{ ok }` |
| POST | `/activities/:id/tasks` | `Partial<Task>` | `Task` (`task.edit`) |
| POST | `/activities/:id/tasks/bulk` | `{ tasks: Partial<Task>[] }` | `Task[]` |
| GET | `/tasks/:id` | – | `TaskDetail` |
| PATCH | `/tasks/:id` | `Partial<Task>` | `Task`. With only `task.edit.own`, only `status, percent_complete, done_notes, pending_notes, dependency_notes` on own tasks; other fields -> 403 |
| DELETE | `/tasks/:id` | – | `{ ok }` (`task.edit`) |

**Roll-up rule (server, after every task/activity write):** task done => 100%; activity % = average of its tasks' %; stage % = average of its activities; project % = average of stages weighted by activity count. Status of an activity/stage is derived: all Done => Done; any Blocked => Blocked; any progress => In Progress; else Not Started. Project RAG: Red if any Critical/Day-1 task overdue or >2 blocked, Amber if any overdue, else Green.

## Notes [A1]
| POST | `/notes` | `{ project_id, stage_id?, activity_id?, task_id?, body }` | `QuickNote` (`notes.add`) |
| DELETE | `/notes/:id` | – | `{ ok }` (author only) |

## Close-out and knowledge hub [A1 routes, A3 AI parts]
| GET | `/projects/:id/closeout/preview` | – | `CloseoutPreview` (`project.close`) - built by `ai/contract.buildCloseoutPreview` |
| POST | `/projects/:id/closeout` | `{ consent: ConsentStatus, lessons: string, items: proposedItems[] }` | `{ project, knowledgeItems }`. Sets project Closed + closed_date; writes knowledge_items with review_status 'Pending Review' (or archive-only when consent != Granted: no items, audit note). |
| GET | `/knowledge` | `?status=&type=&q=&industry=&deal_type=` | `KnowledgeItem[]` (`knowledge.view`; source_project_id stripped) |
| PATCH | `/knowledge/:id` | `{ review_status?, title?, body?, tags? }` | `KnowledgeItem` (`knowledge.edit` or `closeout.approve`) |

## Audit and admin [A1]
| GET | `/audit` | `?projectId=&limit=200` | `AuditEntry[]` (`audit.view`) |
| GET | `/admin/db` | – | `{ driver, sheetId?, schemaVersion, tables: { name, rows }[] }` (`admin.data`) |
| POST | `/admin/db/reload` | – | `{ ok }` |
| GET | `/admin/sheets/status` | `?test=1` to also open the sheet | `{ driver, sheetId, sheetUrl, keyFileFound, serviceAccountEmail, ready, missing[], steps[], connection? }` |
| POST | `/admin/sheets/init` | `{ seed: boolean, source?: 'demo' \| 'current' }` | `{ ok, seeded, source, counts, message, restartNeeded }` - creates tabs (+ header rows, `_meta`) and optionally loads demo data or copies the current database |
| GET | `/admin/export/oracle` | – | `text/plain` SQL: DDL + INSERTs |
| GET | `/admin/export/xlsx` | – | xlsx workbook, one sheet per table (same layout as the Google Sheet) |

## Access governance (v1.3) - `server/src/routes/access.ts`, rules in `shared/access.ts`
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/access/catalog` | – | `{ grantable, durations: [7,30,90], rules: string[] }` |
| GET | `/access/summary` | – | `{ inbox, mine, activeForMe }` (top-bar badge) |
| GET | `/access/requests` | `?view=mine\|inbox\|all&projectId=` | `AccessRequestRow[]`: own requests; for L1 approvers their projects; Risk & Quality and the Deals Leader see all. Each row carries `state` (adds `Expired`) and `can.{approveL1,approveL2,reject,cancel,revoke}` |
| POST | `/access/requests` | `{ project_id, permission_code, justification (>=15 chars), duration_days, grantee_user_id? }` | row. Self-request needs `access.request` -> `Pending L1`. Sponsoring someone needs `access.approve` + level-1 rule -> `Pending L2` with L1 filled. 400 for non-grantable / ineligible / not staffed, 409 for duplicates |
| POST | `/access/requests/:id/decision` | `{ decision: 'approve'\|'reject', note }` | row. L1: Partner/Manager on the project (or EXEC) holding the permission, senior to the grantee, not the requester. L2: `access.review` (Risk), not requester / grantee / L1. Approve at L2 -> `Active` with `expires_at`. Reject needs a note |
| POST | `/access/requests/:id/revoke` | `{ reason }` | row (`Revoked`): grantee, L1-eligible approver or Risk |
| POST | `/access/requests/:id/cancel` | – | row (`Cancelled`): requester, while pending |

**How grants apply:** `assertProjectAccess` (and the AI scope resolver) merge the user's active, unexpired grants for that ONE project into
`auth.actions` for the request (`services/grants.ts`). Portfolio screens (dashboard, project list) never use grants, and the activity feed
never shows finance or access events. `GET /projects/:id` returns `grants[]` and `perms.{canEditFinance,canRequestAccess,canSponsorAccess}`.

## AI [A3] (mounted at `/api/ai` by `server/src/routes/ai.ts`, export `createAiRouter(db: Db): Router`)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/ai/status` | – | `{ gemini, source: 'browser' \| 'server' \| 'none', serverKeyPresent, models, lastModelUsed?, lastError?, pausedUntil? }` (state is per key) |
| POST | `/ai/test-key` | `{ key?, model? }` (falls back to the header key, then the server key) | `{ ok, model?, latencyMs, error? }` - one tiny Gemini call |
| GET | `/ai/models` | – (uses the header/server key) | `{ models: { name, displayName }[], source: 'google' \| 'default' }` |
| POST | `/ai/models` | `{ key? }` (for a typed, unsaved key) | same as GET |
| POST | `/ai/piku` | `PikuRequest` | `PikuResponse` (`piku.use`). Answers only from data the user can see. Saves both messages in `chat_messages`. |
| GET | `/ai/piku/history` | `?contextType=&contextId=&limit=50` | `ChatMessage[]` (own messages only) |
| POST | `/ai/suggest` | `SuggestRequest` | `SuggestResponse` (`ai.suggest`; `project` kind also allowed with `project.create`) |
| POST | `/ai/summary` | `{ scope: 'project' \| 'stage' \| 'activity' \| 'task', id }` | `SummaryResponse` |
| POST | `/ai/draft-email` | `{ scope, id, intent?: string, language?: 'en' \| 'hi' }` | `{ to: string, subject: string, body: string, mode: string }` |
| POST | `/ai/meeting` | `{ scope, id }` | `{ title, agenda: string[], attendees: string[], suggestedSlots: string[], mode }` |

**Browser AI key (v1.1).** Every request may carry `x-ai-key` and `x-ai-model` headers (set by the in-app AI settings
dialog, stored in the browser's localStorage). `server/src/ai/requestAi.ts` puts them in AsyncLocalStorage; all AI
features use them first, then `GEMINI_API_KEY` from `.env`, then offline. A malformed key is a 400 on `/ai/*` and ignored
elsewhere. Keys are never logged, echoed, stored or audited (audit rows record only `key_source`).

Every AI response carries `mode` ("gemini-2.5-flash" etc. or "offline") and is labelled "AI-generated" in the UI.
Every AI call is written to `audit_log` with `ai_generated='Y'`.

## Finance v1.4 (B) - funding need analysis, finance set-up, bank outreach (`server/src/routes/finance.ts`)
Services: `services/financeGap.ts` (`analyseGap`, deterministic), `services/financeBank.ts` (drafts, request permissions).
`GET /projects/:id/finance` now also returns `gap: GapAnalysis`, `setup: FinanceSetupState`, `bankRequests: FinancingRequestRow[]`,
`banks: BankCard[]` (DEMO_BANKS, fictional) and `bankPerms: { canDraft, canSend, reason? }`. `totals.tsa_run_rate` = active TSA services when
itemised, else the project field. `billing.wip` is 0 for closed projects.

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| GET | `/projects/:id/finance/gap` | finance.view | – | `GapAnalysis` (`state`: `no-data` \| `estimate-only` \| `funded` \| `gap`) |
| POST | `/projects/:id/finance/gap/summary` | finance.view | – | `{ text, mode, figures }`; Gemini when a key is set, rejected unless every amount matches a computed figure; else offline template. Audited `ai.finance_gap_summary` |
| POST | `/projects/:id/finance/setup` | finance.edit, open | `{ currency?, fee_budget?, one_time_cost?, tsa_monthly_cost?, spa_seller_cap?, spa_clause_ref?, seller_committed?, buyer_committed?, cost_lines?: [{ category, amount, payer?, buyer_usage_pct?, description?, stage_id? }] }` | full workspace. Audited `finance.setup` |
| POST | `/projects/:id/finance/bank-requests/draft-email` | Partner/Manager + finance.view | `{ bank_code, product, amount, purpose? }` | `{ subject, body, mode, notes[] }` (code name + aggregated figures only; no client name/contacts) |
| POST | `/projects/:id/finance/bank-requests` | Partner/Manager + finance.view | above + `email_subject?, email_body?, next_follow_up?, notes?` | `FinancingRequestRow` (status `Draft`). Audited `finance.bankreq.create` |
| PATCH | `/projects/:id/finance/bank-requests/:rid` | Partner/Manager + finance.view | content fields (Draft only, else 409), `next_follow_up`, `notes` | row |
| POST | `/projects/:id/finance/bank-requests/:rid/status` | see below | `{ status, note?, next_follow_up?, term?: { amount?, interest_rate_pct?, tenor_months?, expected_date? } }` | row. Audited `finance.bankreq.status` |

Status rules: `Sent`, `Term sheet`, `Declined` need finance.edit (403 otherwise); `RM replied` needs draft rights; `Withdrawn` by finance.edit or the
owner of a Draft. `Sent` stamps `sent_at`, sets a 7-day follow-up and logs a `communications` row (channel Email, no figures). `Term sheet` creates
(or updates) a `funding_sources` row with status `Term sheet`, provider = bank, and links it in `funding_id`. Declined/Withdrawn mark a linked,
uncommitted funding line Declined. Nothing is ever sent from the app. Generic cost/funding CRUD and setup keep `projects.funding_gap` equal to the
computed gap once cost lines exist (`syncFundingGap`). `POST/PATCH /projects` accept `spa_seller_cap`, `spa_clause_ref` (finance fields, stripped
without finance.view/edit like the others). Cost lines accept `buyer_usage_pct` (0-100).

## v1.4 (C): AI options, comms dialogs, custom widgets

**`POST /api/ai/suggest`** (unchanged shape, extended)
- New kind `project_fields` (needs `project.edit`, `projectId`): field suggestions for Edit project
  (`description`, `tags`, `sensitivity`, `data_residency`, `clean_team_required`, `apps_in_scope`, `sites_in_scope`, `employees_conveying`, `risks[]`).
- `current` should carry ALL form values. The server merges saved project values < `hints` < `current` (typed values win, empty values do not erase).
  For `stages` / `activities`, `current.stages` / `current.activities` (names or `{name,...}` rows) are the list diffed against (unsaved rows), not the DB.
  For `task`, the typed fields override the saved task.
- Offline keyword engine (`server/src/ai/signals.ts`): SAP/S4/ERP, plants/OT/MES, Germany/EU/GDPR/works council, healthcare/GxP/FDA,
  payments/PCI, cloud/AWS/Azure, mailboxes/M365, India/DPDP, export control, clean team. Industry overlays exist for all 7 industries and are never cut by the activity limit.
- Response adds `options[]` (2-3 for list kinds: `tailored` (recommended), `standard`, `lean` or `risk`; 1-2 for single kinds), `recommendedId`, `inputSignals[]`.
  Each option: `{ id, label, rationale, recommended?, draft, sources (deduplicated; only knowledge actually used, sharing deal type or industry), fromInputs[], stats, fieldReasons? }`.
  `draft` / `rationale` / `sources` = the recommended option (backward compatible). Gemini refines the options (prompt contains the redacted typed values, no finance); invalid output falls back offline.

**`POST /api/ai/meeting`** adds `attendeeIds[]`, `slots[{label,start ISO}]`, `durationMin`; `mode` is the real mode (Gemini title/agenda when configured). Attendees include next-step owners. The client viewer gets no internal people.

**`POST /api/ai/comms/context`** `{scope, id}` → `CommsContext { ref, people[] (team + contacts, masked without contacts.view.full; none internal for CLIENT), canSave, canEmail, saveReason }`.

**`POST /api/ai/comms/log`** `{scope, id, channel: 'Meeting'|'Email'|'Call', subject, body?, to_name?, occurred_at?, duration_min?, contact_id?, aiDrafted?}` → 201 Communication,
linked to the scope's stage/activity/task. 403 for CLIENT, roles without `notes.add`, closed projects; 404 outside scope. Audit `communication.create` (ai_generated='Y' when `aiDrafted`).

**Custom dashboard widgets** (catalogue: `shared/widgetCatalog.ts`; specs only, never code/SQL)
- `POST /api/dashboard/widget-data` `{spec}` (or `GET ?spec=<json>`) → `WidgetData { spec, unit, currency?, total, rows[{key,label,value}], note? }`.
  Same project scope as the dashboard. 400 invalid spec; 403 finance metric without `finance.view`, people grouping for CLIENT.
- `POST /api/dashboard/widgets/suggest` `{text}` → `{possible:true, spec, explanation, mode}` or `{possible:false, reason, closestAlternatives[{spec,explanation}], suggestion:'Ask the analytics team', mode}`. Audit `ai.widget_suggest`.
- `POST /api/dashboard/widgets/request` `{text}` → 201; audit entry `dashboard.widget_request` with the text (demo; nobody is e-mailed).
- Specs persist per user inside `users.dashboard_layout`: `{version:1, items:[{i,x,y,w,h}], custom:{"cw-…": WidgetSpec}}` (old layouts without `custom` still load).
