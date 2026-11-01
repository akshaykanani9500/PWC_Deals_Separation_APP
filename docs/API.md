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
| GET | `/dashboard` | – | `DashboardData` (only visible projects; finance null without `finance.view`) |

## Projects [A1]
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/projects` | `?q=&status=&industry=&rag=&includeClosed=1` | `ProjectListItem[]` |
| POST | `/projects` | `Partial<Project>` + optional `stages: [{ name, description?, activities?: [{ name, description?, priority?, tasks?: [{ title, priority?, day1_critical? }] }] }]` + optional `members: [{ user_id, member_role }]` | `ProjectDetail`. Needs `project.create`. Creator becomes a member. If `stages` omitted, the 5 default stages are created. |
| GET | `/projects/:id` | – | `ProjectDetail` |
| PATCH | `/projects/:id` | `Partial<Project>` | `ProjectDetail` (`project.edit`) |
| DELETE | `/projects/:id` | – | `{ ok }` soft delete (`project.edit`, PARTNER/MANAGER only) |
| GET | `/projects/:id/finance` | – | `{ entries: FinanceEntry[], tsaServices: TsaService[], totals: {...} }` (`finance.view`) |
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
