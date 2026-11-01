/**
 * Google Sheets setup card for the Data admin page (v1.1, admin.data only).
 * Shows what is configured (sheet, service-account email), what is missing, and lets the admin
 * test the connection and create the tabs / load demo data without the command line.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Database, ExternalLink, Loader2, PlugZap, Sheet, Upload, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { get, post } from '../../lib/api';

interface SheetsStatus {
  driver: string; sheetId: string; sheetUrl: string | null; keyFile: string; keyFileFound: boolean;
  serviceAccountEmail: string | null; ready: boolean; missing: string[]; steps: string[];
  connection?: { ok: boolean; title?: string; tabs?: string[]; missingTabs?: string[]; error?: string };
}
interface InitResult { ok: true; seeded: boolean; source: string; counts: Record<string, number>; message: string; restartNeeded: boolean }

type Busy = null | 'status' | 'test' | 'tabs' | 'demo' | 'current';

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export default function SheetsSetupCard() {
  const [st, setSt] = useState<SheetsStatus | null>(null);
  const [busy, setBusy] = useState<Busy>('status');
  const [error, setError] = useState('');
  const [done, setDone] = useState<InitResult | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (test = false) => {
    setBusy(test ? 'test' : 'status'); setError('');
    try { setSt(await get<SheetsStatus>(`/admin/sheets/status${test ? '?test=1' : ''}`)); }
    catch (e: any) { setError(e?.message ?? 'Could not load the Sheets status'); }
    finally { setBusy(null); }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  async function init(kind: 'tabs' | 'demo' | 'current') {
    const warn = kind === 'tabs'
      ? 'Create any missing tabs and header rows in the Google Sheet? Existing rows are kept.'
      : kind === 'demo'
        ? 'This REPLACES everything in the Google Sheet with fresh demo data. Continue?'
        : 'This REPLACES everything in the Google Sheet with a copy of the data the app is using now. Continue?';
    if (!window.confirm(warn)) return;
    setBusy(kind); setError(''); setDone(null);
    try {
      const r = await post<InitResult>('/admin/sheets/init', kind === 'tabs' ? { seed: false } : { seed: true, source: kind });
      setDone(r);
      await load(true);
    } catch (e: any) { setError(e?.message ?? 'Setup failed'); }
    finally { setBusy(null); }
  }

  async function copyEmail() {
    if (!st?.serviceAccountEmail) return;
    try { await navigator.clipboard.writeText(st.serviceAccountEmail); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  const conn = st?.connection;
  return (
    <section aria-labelledby="sheets-setup-title" data-testid="sheets-setup-card" className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-soft text-green"><Sheet size={18} aria-hidden /></span>
          <div>
            <h2 id="sheets-setup-title" className="text-[15px] font-semibold text-ink">Google Sheets database</h2>
            <p className="text-[12.5px] text-ink-muted">One tab per table. Fill the sheet from here instead of the command line.</p>
          </div>
        </div>
        <span className={clsx('rounded-full px-2.5 py-1 text-[12px] font-medium', st?.driver === 'sheets' ? 'bg-green-soft text-green' : 'bg-sunken text-ink-soft')}>
          App is using: {st?.driver === 'sheets' ? 'Google Sheets' : st?.driver === 'local' ? 'Local files' : st?.driver ?? '…'}
        </span>
      </div>

      {busy === 'status' && !st && <p className="flex items-center gap-2 text-[13px] text-ink-muted"><Loader2 size={14} className="animate-spin" /> Checking setup…</p>}

      {st && (
        <dl className="mb-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-[11.5px] text-ink-muted">Sheet</dt>
            <dd className="truncate">
              {st.sheetUrl
                ? <a href={st.sheetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue underline underline-offset-2 hover:text-blue/80">{conn?.title ?? st.sheetId.slice(0, 18) + '…'} <ExternalLink size={12} aria-hidden /></a>
                : <span className="text-rose">Not set (GOOGLE_SHEET_ID)</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-muted">Service account (share the sheet with this as Editor)</dt>
            <dd className="flex items-center gap-1.5">
              {st.serviceAccountEmail
                ? <>
                  <span className="truncate font-mono text-[12px]">{st.serviceAccountEmail}</span>
                  <button type="button" onClick={copyEmail} className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="Copy service-account email"><Copy size={13} /></button>
                  {copied && <span className="text-[11.5px] text-green">Copied</span>}
                </>
                : <span className="text-rose">{st.keyFileFound ? 'Key file has no client_email' : `No key file at ${st.keyFile}`}</span>}
            </dd>
          </div>
        </dl>
      )}

      {st && !st.ready && (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber-soft px-3.5 py-3 text-[13px] text-ink" role="note">
          <p className="mb-1.5 flex items-center gap-1.5 font-semibold"><AlertTriangle size={15} className="text-amber" aria-hidden /> Not connected yet: {st.missing.join('; ')}</p>
          <ol className="ml-5 list-decimal space-y-1 text-ink-soft">{st.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="mt-2 text-[12px] text-ink-muted">Until then the app keeps working on the local file database.</p>
        </div>
      )}

      {st?.ready && (
        <>
          <ol className="mb-4 ml-5 list-decimal space-y-1 text-[13px] text-ink-soft">{st.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {conn && (
            <div role="status" data-testid="sheets-connection" className={clsx('mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]', conn.ok ? 'border-green/30 bg-green-soft text-green' : 'border-rose/30 bg-rose-soft text-rose')}>
              {conn.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}
              <span>
                {conn.ok
                  ? <>Connected to <b>{conn.title}</b>. {conn.missingTabs?.length ? `${conn.missingTabs.length} of 15 tabs still to create.` : 'All tabs are present.'}</>
                  : conn.error}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={clsx(btn, 'border border-line text-ink hover:bg-sunken')} disabled={!!busy} onClick={() => load(true)}>
              {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} aria-hidden />} Test connection
            </button>
            <button type="button" className={clsx(btn, 'border border-line text-ink hover:bg-sunken')} disabled={!!busy} onClick={() => init('tabs')}>
              {busy === 'tabs' ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} aria-hidden />} Create tabs
            </button>
            <button type="button" className={clsx(btn, 'bg-brand text-white hover:bg-brand-dark')} disabled={!!busy} onClick={() => init('demo')} data-testid="sheets-seed-demo">
              {busy === 'demo' ? <Loader2 size={14} className="animate-spin" /> : <Sheet size={14} aria-hidden />} Create tabs + load demo data
            </button>
            {st.driver !== 'sheets' && (
              <button type="button" className={clsx(btn, 'border border-line text-ink hover:bg-sunken')} disabled={!!busy} onClick={() => init('current')}>
                {busy === 'current' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} aria-hidden />} Copy current data to the sheet
              </button>
            )}
          </div>
        </>
      )}

      {done && <p role="status" className="mt-3 rounded-lg bg-green-soft px-3 py-2 text-[13px] text-green" data-testid="sheets-init-result">{done.message}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-soft px-3 py-2 text-[13px] text-rose">{error}</p>}
    </section>
  );
}
