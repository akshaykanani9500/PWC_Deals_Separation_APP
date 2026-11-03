# Deals Separation Hub

The first app on the **PwC Deals Stack**: a tracker for M&A IT separation work, built for the PwC separation team.

- **Login by persona:** 9 roles, each with its own permissions.
- **Executive dashboard:** customisable widgets plus a searchable list of all projects.
- **Project drill-down:** each project opens into **Stages → Activities → Tasks**, shown as browser-style tabs.
- **Edit panels with AI help:** every edit opens a side panel with an AI suggestion button (Suggest stages / activities / tasks / update), which drafts from past deals.
- **Piku, the AI chat bubble:** answers in **English or Hindi**, by text or voice. It only uses data you are allowed to see.
- **Finance workspace (v1.3):** a full-screen finance view per project: time and fees by stage, activity and person, who billed what, one-time separation cost and who pays, sources & uses of funding, the usual M&A funding routes and fictional demo funders. Visibility only: the app never arranges financing.
- **Access governance (v1.3):** extra, time-bound permissions per project with **two-level approval** (level 1 engagement Partner/Manager, level 2 Risk & Quality), revocable at any time and fully audited.
- **Close-out to knowledge hub:** closing a project sends redacted, consent-checked learnings to the knowledge hub. New projects and edits then use that knowledge.
- **Google Sheets database,** designed so it can move to **Oracle** later (version 3).

Built for SPJIMR *Business in Digital Age* (INF501), Case 18. All names, clients and numbers in the demo data are fictional.

---

## 1. Run it on your laptop (5 minutes)

**You need:** [Node.js 20 or newer](https://nodejs.org) (LTS), Git and VS Code.

```bash
git clone https://github.com/akshaykanani9500/pwc_deals_separation_app.git
cd pwc_deals_separation_app
npm install
npm run db:seed        # creates the demo database in ./data (the app also does this by itself on first start)
npm run dev            # starts the API (port 4000) and the web app (port 5173)
```

Open **http://localhost:5173**, pick a person from the dropdown and press **Sign in**.

That is all you need. With no `.env` file, the app runs on the local file database and Piku answers in offline mode.

### Turn on real AI (Gemini)

**Easiest: paste your key in the app** (same as the course simulations).

1. Sign in as anyone and click the **AI: Offline** button in the top bar.
2. Paste your Google AI Studio key ([get one free](https://aistudio.google.com/apikey)) and press **Test key**. You should see which Gemini model answered.
3. Pick a model if you like, then press **Save & use**.

The button turns green (`AI: Gemini · 2.5-flash`), and every AI feature uses the key straight away: Piku, AI suggestions, summaries, email and meeting drafts, and close-out lessons. No restart is needed.

- **Where the key lives:** only in that browser (localStorage). It goes only to this app's own server, in a request header, and the server calls Google for you. It is never written to the database, the Google Sheet, the audit log or the server logs.
- **Each person sets their own:** the key is per browser, so a teammate on another laptop pastes their own key.
- **Removing it:** **Remove key** in the same dialog.

**Alternative: a server key in `.env`** (used for everyone when no key is pasted in the browser).

1. Copy `.env.example` to a new file called `.env` in the project folder.
2. Add `GEMINI_API_KEY=your-key-here`.
3. Stop the app (Ctrl+C) and run `npm run dev` again.

**Which model is used:** you don't need to pick one. On **Test key** the app asks Google which models *your* key may call and uses the best one: `gemini-3.8-flash`, then `3.6-flash`, `3.5-flash`, `3.5-flash-lite`, `3.1-flash-lite` and so on. Retired models (`gemini-1.5-*`, `gemini-2.0-*`) are never called. `gemini-2.5-flash` is skipped automatically when Google limits it to earlier users, as it does for new keys. A model that hits its free-tier limit is skipped for a minute. New Google AI Studio keys start with `AQ.`; that format works.

**What you will see:** Piku's answers to fuller questions (summaries, risks, next steps, anything across areas) say `AI-generated · gemini-3.8-flash` (or whichever model your key can use) instead of `offline`. Quick lookups such as "what is overdue?" are answered by rules on purpose (faster and exact) and show `rules (level 1)`.

If the key is wrong or Google can't be reached, the top-bar button turns red and shows the reason. Gemini pauses for a few minutes and answers come from the offline engine straight away, so the app never hangs.

> `.env` is ignored by Git, so a server key never goes to GitHub. Never paste a key into any other file.
> If a key has been shared in a chat or a screenshot, create a new one in Google AI Studio and delete the old one.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Run API and web app with live reload |
| `npm start` | Build and run the production version on http://localhost:4000 |
| `npm run db:seed` / `npm run db:reset` | Load the demo data / wipe and reload it |
| `npm test` | Unit and API tests (permissions, database, AI) |
| `npx playwright install chromium`, then `npm run test:e2e` | Browser tests for every persona and the main flows (starts its own server on port 4300 with a fresh demo database) |
| `npm run typecheck` | TypeScript check |
| `npm run check:setup` | Tells you what is configured (Node, .env, database, Gemini) |
| `npm run db:export-xlsx` | Whole database as an Excel file (same layout as the Google Sheet) |
| `npm run db:oracle-ddl` / `npm run db:export-oracle` | Oracle `CREATE TABLE` script / Oracle `INSERT` script |

---

## 2. Who can log in (demo personas)

| Persona | Demo person | What they can do |
|---|---|---|
| Deals Leader (EXEC) | Vikram Mehta | Sees every project, the portfolio and finance; creates projects; no day-to-day edits |
| Engagement Partner | Sarah Whitfield, Rajiv Khanna | Full control of own projects; approves stage gates; closes projects |
| Engagement Manager | Ananya Rao, Daniel Brooks, Kavya Iyer | Runs own projects: stages, activities, tasks, team, close-out |
| Workstream Lead | Arjun Nair, Priya Sharma, Rohan Desai | Edits activities and tasks in the stages they own; no finance |
| Analyst | Neha Gupta, Karan Malhotra, Sneha Pillai, Aditya Joshi | Updates status and notes on tasks assigned to them; contacts masked |
| Knowledge Manager | Meera Krishnan | Reviews close-out learnings into the AI knowledge hub |
| Risk & Quality / DPO | Fatima Sheikh | Read-only on all projects; audit log; approves reuse consent; level-2 approver for access requests |
| Client SMO viewer | Lisa Moreno, Kenji Watanabe | Read-only view of their own project; no fees, internal emails or phone numbers |
| Platform Admin | Rahul Verma | Data admin page: database driver, reload, Oracle and Excel export |

The rules live in `shared/permissions.ts`; extra per-project access lives in `shared/access.ts`.

- **Server-side checks:** the server checks every request against these rules, so hiding a button is never the only protection.
- **Same rules for Piku:** Piku and the AI suggestions follow exactly the same rules.
- **Audit:** every denied attempt is written to the audit log.

**Try this demo path:**

1. Sign in as **Ananya Rao (Manager)** and open **Project Phoenix**.
2. Open a stage, press **Edit activities** (at the end of the activity tabs), then **Suggest activities**, and add one.
3. Open a task and ask Piku *"इस activity में क्या pending है?"*.
4. Switch persona to **Neha Gupta (Analyst)** and see what changes.
5. As **Ananya Rao**, close a project.
6. Sign in as **Meera Krishnan (Knowledge Manager)** and approve the learnings.
7. As a manager, create a new project with **Suggest a plan from past deals**. The approved learnings now appear as a source.

### Finance workspace and access approvals (v1.3)

**Finance** on a project page opens `/projects/<id>/finance`, a full-screen workspace with six tabs:

| Tab | What it answers |
|---|---|
| Overview | Budget, invoiced, paid, outstanding, planned effort, separation cost, secured vs unfunded money, and a stage-by-stage table of days, hours, fees invoiced and separation cost |
| Time & fees | Hours and effort value by **person** or **activity** (demo rate card), and who billed what |
| Billing | Every invoice with status (Draft, Sent, Overdue, Paid), who raised it, and "worked, not yet billed" |
| Costs & funding | Sources & uses: one-time cost by category and who pays (seller, buyer, shared), funding sources and their status |
| Funding options | How deal teams usually fund separation cost (SPA seller contribution, buyer cash, bridge/term loans, vendor deferred payment, PE, private credit, escrow, incentives) and fictional demo funders you can add to the plan |
| TSA charges | TSA services, run-rate, exit dates and extension uplift |

Who can do what: Deals Leader and Managers **see** finance; the Engagement Partner **sees and edits** it; Leads, Analysts and clients do not see it unless an access request is approved (clients never).

**Access requests (two-level governance).** Use **Request access** (or **Access & approvals** for Partners/Managers) under the project header, or the **Access** page in the top bar.

1. A Lead / Analyst / Manager asks for a permission on one project for 7, 30 or 90 days with a reason, or a Partner/Manager sponsors it for a junior team member.
2. **Level 1:** a Partner or Manager on that project who holds the permission and is more senior (a sponsor counts as level 1).
3. **Level 2:** Risk & Quality checks need-to-know, clean team and confidentiality, then the access goes live.
4. Access applies only inside that project (never on the dashboard or other deals), expires on its own, can be revoked any time, and every step is in the audit log. Nobody approves their own request, and role-only rights (gate approval, close-out, audit, admin) cannot be requested.

**Try it:** sign in as **Sneha Pillai** and open Project Rioja → Finance (locked; her request is waiting). Sign in as **Fatima Sheikh** → **Access** → approve. Back as Sneha, finance opens read-only. **Rohan Desai** already has approved finance access on Rioja only.

### What's new in v1.4

- **Approvals that fit the risk.** Editing tasks/activities and full contacts need only level 1 (Partner/Manager on the deal). Finance view adds Risk & Quality only on clean-team deals. Finance edit and **acting roles** (e.g. an Analyst acting as Engagement Manager on one project) need a Partner and then Risk & Quality. Pending requests escalate after 3 days and expire after 7. Removing someone from the team withdraws their extra access.
- **See who approves next.** A pop-up after every request names the next approver. The **bell icon** in the top bar lists what waits for you, with Approve/Reject right there, plus updates on your own requests. **How approval works** explains the rules.
- **Finance that helps decide.** Optional finance fields in New project, a **Set up finance** screen, and a **Gap & split** tab: the funding gap, four standard ways to split it between seller and buyer (with the sale-agreement cap), a recommendation with evidence, funding routes, next steps, lessons from past deals and an AI summary.
- **Ask a bank.** Bank 1-4 (fictional) with relationship managers; AI-drafted email (no client contact data), copy / mail / call, and tracking from Draft to Term sheet. Managers draft, Partners send. Nothing is sent from the app.
- **AI suggestions use what you typed** and offer 2-3 plans to choose from (e.g. an SAP carve-out with plants in Germany gets ERP, plant and works-council activities).
- **Meeting, email and call windows** with a demo meeting link, attendees, slots, calendar file, invite email and **Save to project log**.
- **Build your own dashboard widget**, by hand or by describing it to AI. If it can't be built, you can ask the analytics team.
- **Reset demo data** (Platform Admin) on the Data admin page; the audit log is kept.

To go back to an earlier version: `git checkout release/v1.3` (or `release/v1.2`).

---

## 3. Connect the Google Sheets database

The app reads and writes a Google Sheet through a **service account**. A service account is a free "robot" Google login.

You do this setup once, and each teammate uses the same sheet.

> **Why the shared sheet starts empty:** that is on purpose. The app creates the 15 tabs and loads the demo data itself (step 5), so the sheet always matches the current schema. The files in `db/oracle/` are generated SQL scripts for the version 3 move to Oracle; there is no live Oracle database yet.

1. **Create the service account.** Go to [console.cloud.google.com](https://console.cloud.google.com).
   - Create a project (any name).
   - Search for **Google Sheets API** and click **Enable**.
   - Open **IAM & Admin → Service Accounts → Create service account**. Any name works, and no role is needed.
2. **Download its key.** Open the new service account, go to **Keys → Add key → Create new key → JSON**, and download it.
   - Make a folder called `credentials` in the project.
   - Save the key there as `credentials/service-account.json`. This folder is git-ignored.
3. **Share the sheet.** Open the database sheet: [Deals Separation Hub — Database](https://docs.google.com/spreadsheets/d/1jSAoSD63AKOm1JRodby8PXR9tVjGt71APMWqWZwUoac/edit), or any empty Google Sheet you create.
   - Click **Share** and add the service account's email (it ends in `iam.gserviceaccount.com`) as **Editor**.
   - If your college Google account blocks sharing with outside accounts, create the sheet from a personal Gmail account instead.
4. **Point the app at the sheet.** In `.env`, add:
   ```
   DB_DRIVER=sheets
   GOOGLE_SHEET_ID=1jSAoSD63AKOm1JRodby8PXR9tVjGt71APMWqWZwUoac
   GOOGLE_APPLICATION_CREDENTIALS=./credentials/service-account.json
   ```
   The sheet ID is the long part of the sheet URL, between `/d/` and `/edit`.
5. **Fill the sheet, from the app or the terminal.**
   - **In the app:** restart `npm run dev`, sign in as **Rahul Verma (Platform Admin)** and open **Data admin**. The **Google Sheets database** card shows the service-account email to share with (with a copy button) and anything still missing. Press **Test connection**, then **Create tabs + load demo data**. **Copy current data to the sheet** moves whatever you have been working on locally instead.
   - **In the terminal:** `npm run db:init-sheets -- --seed`.
6. **Start the app on the sheet.** Make sure `.env` has `DB_DRIVER=sheets` and restart `npm run dev`. The Data admin page should show the driver as **Google Sheets**.

If the sheet can't be reached, the app does not crash. It prints a warning and uses the local database, so a demo never breaks.

**Rules for editing the sheet by hand**

- **Don't rename tabs or headers.** Row 1 of each tab is the column list.
- **Booleans are `Y` / `N`.**
- **Dates are `YYYY-MM-DD`.**
- **Never delete rows.** Set `is_deleted` to `Y` instead.
- **Refresh after edits.** After editing, press **Reload from source** on the Data admin page.

---

## 4. Moving to Oracle (version 3)

The Google Sheet was designed from day one to drop into Oracle without reshaping:

- **One definition:** `shared/schema.ts` defines every table once. That single definition drives the Sheets tabs, the local JSON files and the Oracle DDL.
- **Oracle-safe names:** no reserved words, everything 30 characters or fewer, `lower_snake_case`.
- **Text keys:** primary keys are text (`PRJ-0001`), so no sequences are needed.
- **Typed columns:** booleans are `Y`/`N`, and long text and JSON go in CLOB.
- **Foreign keys and checks:** foreign keys and allowed values become real constraints.

Steps:

```bash
npm run db:oracle-ddl      # writes db/oracle/schema.sql
npm run db:export-oracle   # writes db/oracle/data.sql from whatever database is active (local or sheets)
```

Then run both files in Oracle (for example Oracle Database Free in Docker). Switching the app over is a new adapter, `server/src/db/adapters/OracleAdapter.ts`. Its skeleton and plan are already in the repo, along with the full guide in [`docs/ORACLE_MIGRATION.md`](docs/ORACLE_MIGRATION.md).

---

## 5. How the code is organised

```
shared/          schema (tables), permissions, types: used by server AND client
server/src/
  db/            Db interface + LocalJson / Google Sheets / (Oracle v3) adapters
  routes/        REST API (docs/API.md)
  services/      access rules, grants (two-level access), finance workspace, roll-up of % complete and RAG, audit
  ai/            Piku router + domain agents, Gemini client with offline fallback,
                 suggestions, summaries, email/meeting drafts, close-out redaction
client/src/
  pages/         login, dashboard, project → stage → activity, finance workspace, access & approvals, knowledge, audit, admin
  features/      piku (chat bubble), ai (suggest button, summary card, actions), access (request panel, request cards)
scripts/         seed, Google Sheets init, Excel export, Oracle DDL/data export
db/              seed snapshot (JSON) and generated Oracle SQL
tests/e2e/       Playwright tests per persona
docs/            API contract, data model, Oracle migration
```

### How Piku works (the agent mesh from the architecture)

1. **Route the question.** A **router** sorts each question by intent (status, overdue, finance, contacts, summary, how-to and more), by level (1 simple, 2 one area, 3 cross-area) and by language.
2. **Fetch permitted facts.** Small **domain agents** (tracker, finance, communications, knowledge, general) each fetch only their own slice of data. That data has already been filtered by your permissions.
3. **Write the answer.**
   - **With Gemini:** Gemini writes the answer **only from those facts**, in your language, and cites its sources.
   - **Without Gemini, or if it fails:** a built-in offline engine answers instead.
4. **Label and log it.** Every answer is labelled AI-generated and shows its mode, and every AI action is logged.

### Working together on this repo

- **Branch for each change.** Create a branch for each change (`git checkout -b feature/my-change`) and open a pull request into `main`.
- **Test before pushing.** Run `npm run typecheck && npm test` before you push.
- **Changing tables.** Change tables only in `shared/schema.ts`, then run `npm run db:oracle-ddl` so the Oracle script stays in sync. Note the change in `docs/DATA_MODEL.md`.
- **Never commit secrets or local data.** That means `.env`, `credentials/` and `data/`; `.gitignore` already blocks them.

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `npm run dev` says the port is in use | Another copy is running. Close it, or set `PORT=4001` (API) and/or `WEB_PORT=5174` (web app) in `.env` |
| Test key says a model is "not available for this key" | Normal for new keys: Google has shut down 1.5/2.0 and limits 2.5 to earlier users. The test already moves on to a model that works and selects it; press **Save & use**. If your `.env` has an old `GEMINI_MODELS=gemini-2.5-flash,gemini-2.0-flash,gemini-1.5-flash` line, delete it (the app ignores retired names anyway) |
| Test key says "free-tier quota reached" | You hit the free per-minute limit. Wait a minute, or the app uses another model meanwhile |
| Piku says "offline" | No key yet: click the AI button in the top bar and paste one (or set `GEMINI_API_KEY` in `.env`). If the button is red, hover it or open it to see why (key rejected, quota, or no internet). Offline answers still work |
| Microphone button does nothing | Voice input needs Chrome or Edge and microphone permission. Firefox has no speech recognition |
| Hindi voice sounds English | Install a Hindi voice in your OS speech settings (Windows: Settings → Time & language → Speech) |
| "Falling back to local database" | Check `GOOGLE_SHEET_ID`, the key path, and that the sheet is shared with the service-account email |
| Want fresh demo data | `npm run db:reset` |
