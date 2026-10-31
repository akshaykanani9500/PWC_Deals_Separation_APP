# Deals Separation Hub

The first app on the **PwC Deals Stack**: a tracker for M&A IT separation work, built for the PwC separation team.

- **Login by persona:** 9 roles, each with its own permissions.
- **Executive dashboard:** customisable widgets plus a searchable list of all projects.
- **Project drill-down:** each project opens into **Stages → Activities → Tasks**, shown as browser-style tabs.
- **Edit panels with AI help:** every edit opens a side panel with an AI suggestion button (Suggest stages / activities / tasks / update), which drafts from past deals.
- **Piku, the AI chat bubble:** answers in **English or Hindi**, by text or voice. It only uses data you are allowed to see.
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

1. Copy `.env.example` to a new file called `.env` in the project folder.
2. Paste your Google AI Studio key into it:
   ```
   GEMINI_API_KEY=your-key-here
   ```
3. Stop the app (Ctrl+C) and run `npm run dev` again.

Piku's answers to fuller questions (summaries, risks, next steps, anything across areas) will then say `AI-generated · gemini-2.5-flash` instead of `offline`. Quick lookups such as "what is overdue?" are answered by rules on purpose (faster and exact) and show `rules (level 1)`.

If the key is wrong or Google can't be reached, Piku pauses Gemini for a few minutes and answers in offline mode straight away, so the app never hangs.

> The `.env` file is ignored by Git, so your key never goes to GitHub. Never paste a key into any other file.
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
| Risk & Quality / DPO | Fatima Sheikh | Read-only on all projects; audit log; approves reuse consent |
| Client SMO viewer | Lisa Moreno, Kenji Watanabe | Read-only view of their own project; no fees, internal emails or phone numbers |
| Platform Admin | Rahul Verma | Data admin page: database driver, reload, Oracle and Excel export |

The rules live in `shared/permissions.ts`.

- **Server-side checks:** the server checks every request against these rules, so hiding a button is never the only protection.
- **Same rules for Piku:** Piku and the AI suggestions follow exactly the same rules.
- **Audit:** every denied attempt is written to the audit log.

**Try this demo path:**

1. Sign in as **Ananya Rao (Manager)** and open **Project Phoenix**.
2. Open a stage, click the pencil tab at the end of the activity tabs, press **Suggest activities** and add one.
3. Open a task and ask Piku *"इस activity में क्या pending है?"*.
4. Switch persona to **Neha Gupta (Analyst)** and see what changes.
5. As **Ananya Rao**, close a project.
6. Sign in as **Meera Krishnan (Knowledge Manager)** and approve the learnings.
7. As a manager, create a new project with **Suggest a plan from past deals**. The approved learnings now appear as a source.

---

## 3. Connect the Google Sheets database

The app reads and writes a Google Sheet through a **service account**. A service account is a free "robot" Google login.

You do this setup once, and each teammate uses the same sheet.

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
5. **Fill the sheet.** Run `npm run db:init-sheets -- --seed`. This creates one tab per table and loads the demo data.
6. **Start the app.** Run `npm run dev`. The **Data admin** page (sign in as Rahul Verma) should show the driver as **Google Sheets**.

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
  services/      access rules, roll-up of % complete and RAG, audit
  ai/            Piku router + domain agents, Gemini client with offline fallback,
                 suggestions, summaries, email/meeting drafts, close-out redaction
client/src/
  pages/         login, dashboard, project → stage → activity, knowledge, audit, admin
  features/      piku (chat bubble) and ai (suggest button, summary card, actions)
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
| Piku says "offline" | No `GEMINI_API_KEY` in `.env`, the key was rejected, or Google is unreachable. Offline answers still work. The Data admin page / `GET /api/ai/status` shows the last Gemini error |
| Microphone button does nothing | Voice input needs Chrome or Edge and microphone permission. Firefox has no speech recognition |
| Hindi voice sounds English | Install a Hindi voice in your OS speech settings (Windows: Settings → Time & language → Speech) |
| "Falling back to local database" | Check `GOOGLE_SHEET_ID`, the key path, and that the sheet is shared with the service-account email |
| Want fresh demo data | `npm run db:reset` |
