/**
 * Google Sheets setup from inside the app (Data admin page, v1.1).
 * Same logic as `npm run db:init-sheets [-- --seed]`, plus a status check that tells the admin exactly
 * what is missing. Never returns or logs the service-account private key - only its email.
 */
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { TABLES, type TableName } from '../../../shared/schema';
import type { Db } from '../db/Db';
import { SheetsAdapter } from '../db/adapters/SheetsAdapter';
import { config } from '../config';
import { HttpError } from '../errors';

/** Read at call time so tests (and a restarted dev server) see the current environment. */
export function sheetsConfig() {
  return {
    sheetId: (process.env.GOOGLE_SHEET_ID ?? config.googleSheetId ?? '').trim(),
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? config.googleCredentials,
  };
}

export function serviceAccountEmail(keyFile: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    return typeof j?.client_email === 'string' ? j.client_email : null;
  } catch { return null; }
}

export interface SheetsStatus {
  driver: string;
  sheetId: string;
  sheetUrl: string | null;
  keyFile: string;
  keyFileFound: boolean;
  serviceAccountEmail: string | null;
  ready: boolean;                 // sheet id + readable key file
  missing: string[];              // human-readable list of what to fix
  steps: string[];                // what to do next
  connection?: { ok: boolean; title?: string; tabs?: string[]; missingTabs?: string[]; error?: string };
}

export async function sheetsStatus(db: Db, opts: { test?: boolean } = {}): Promise<SheetsStatus> {
  const { sheetId, keyFile } = sheetsConfig();
  const keyFileFound = !!keyFile && fs.existsSync(keyFile);
  const email = keyFileFound ? serviceAccountEmail(keyFile) : null;
  const missing: string[] = [];
  if (!sheetId) missing.push('GOOGLE_SHEET_ID is empty in .env');
  if (!keyFileFound) missing.push(`Service-account key file not found at ${path.normalize(keyFile)}`);
  else if (!email) missing.push('The key file is not a valid service-account JSON (no client_email)');
  const ready = missing.length === 0;

  const steps = ready
    ? [
      `Share the Google Sheet with ${email} as Editor (Share button in the sheet).`,
      'Press "Test connection", then "Create tabs + load demo data" (or "Create tabs" to start empty).',
      db.driver === 'sheets' ? 'The app is already running on Google Sheets.' : 'Then set DB_DRIVER=sheets in .env and restart `npm run dev`.',
    ]
    : [
      'In Google Cloud Console: create a project, enable "Google Sheets API".',
      'IAM & Admin > Service Accounts > Create service account (no role needed) > Keys > Add key > JSON.',
      'Save the downloaded file as credentials/service-account.json in the project folder (git-ignored).',
      'Copy the sheet id from the sheet URL (docs.google.com/spreadsheets/d/<ID>/edit) into GOOGLE_SHEET_ID in .env.',
      'Restart `npm run dev`, then come back to this page.',
    ];

  const status: SheetsStatus = {
    driver: db.driver, sheetId, sheetUrl: sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null,
    keyFile: path.normalize(keyFile), keyFileFound, serviceAccountEmail: email, ready, missing, steps,
  };

  if (opts.test && ready) {
    try {
      const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
      const sheets = google.sheets({ version: 'v4', auth });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title,sheets.properties.title' }, { timeout: 15_000 });
      const tabs = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean);
      status.connection = { ok: true, title: meta.data.properties?.title ?? undefined, tabs, missingTabs: TABLES.map((t) => t.name).filter((n) => !tabs.includes(n)) };
    } catch (e: any) {
      status.connection = { ok: false, error: explainGoogleError(e, email) };
    }
  }
  return status;
}

export function explainGoogleError(e: any, email: string | null): string {
  const code = Number(e?.code ?? e?.response?.status);
  const msg = String(e?.message ?? e).slice(0, 200);
  if (code === 403 || /permission|PERMISSION_DENIED/i.test(msg)) return `No access to the sheet. Share it with ${email ?? 'the service-account email'} as Editor. If your college/work Google account blocks sharing outside the organisation, create the sheet in a personal Gmail account instead.`;
  if (code === 404 || /not found/i.test(msg)) return 'Sheet not found. Check GOOGLE_SHEET_ID (the long id between /d/ and /edit in the sheet URL).';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|getaddrinfo/i.test(msg)) return 'Could not reach Google. Check your internet connection or proxy.';
  if (/invalid_grant|private key|PEM/i.test(msg)) return 'The service-account key file was rejected. Download a fresh JSON key.';
  return msg;
}

export interface InitResult { ok: true; seeded: boolean; source: 'demo' | 'current' | 'none'; tabs: string[]; counts: Record<string, number>; message: string; restartNeeded: boolean }

/**
 * Create every tab (+ header row and _meta) and optionally load data.
 *   source 'demo'    -> fresh demo data (same as npm run db:init-sheets -- --seed)
 *   source 'current' -> copy whatever the app is running on now (e.g. your local data) into the sheet
 * When the app already runs on the Sheets driver the live adapter is used, so the in-memory cache stays in sync.
 */
export async function initSheets(db: Db, opts: { seed: boolean; source?: 'demo' | 'current' }): Promise<InitResult> {
  const st = await sheetsStatus(db);
  if (!st.ready) throw new HttpError(400, `Google Sheets is not configured yet: ${st.missing.join('; ')}.`, 'VALIDATION');
  const { sheetId, keyFile } = sheetsConfig();
  const source: InitResult['source'] = opts.seed ? (opts.source ?? 'demo') : 'none';

  // Snapshot the current data BEFORE touching anything (when copying from the running database).
  let rows: Record<string, any[]> | null = null;
  if (source === 'current') {
    rows = {};
    for (const t of TABLES) rows[t.name] = await db.all(t.name as TableName, { includeDeleted: true });
  } else if (source === 'demo') {
    const { buildSeed } = await import('../../../scripts/seed');
    rows = await buildSeed();
  }

  const live = db.driver === 'sheets' && db instanceof SheetsAdapter;
  const target: SheetsAdapter = live ? (db as SheetsAdapter) : new SheetsAdapter(sheetId, keyFile);
  try {
    if (live) await target.ensureTabs(); else await target.init();
    if (rows) {
      for (const t of TABLES) await target.replaceTable(t.name as TableName, rows[t.name] ?? []);
      await target.markSeeded();
      await target.reload();
    }
  } catch (e: any) {
    throw new HttpError(502, explainGoogleError(e, st.serviceAccountEmail), 'SERVER');
  }
  const counts = await target.counts();
  const restartNeeded = db.driver !== 'sheets';
  const what = source === 'demo' ? 'Tabs created and demo data loaded' : source === 'current' ? 'Tabs created and current data copied' : 'Tabs created (empty)';
  return {
    ok: true, seeded: !!rows, source, tabs: [...TABLES.map((t) => t.name), '_meta'], counts,
    message: restartNeeded ? `${what}. The app is still on the ${db.driver} database: set DB_DRIVER=sheets in .env and restart to use the sheet.` : `${what}. The app is reading from the sheet now.`,
    restartNeeded,
  };
}
