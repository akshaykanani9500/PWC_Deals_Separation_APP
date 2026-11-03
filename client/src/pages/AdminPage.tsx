/** Data admin: which database is in use, row counts, reload from Google Sheets, exports for Oracle (v3). */
import { useEffect, useState } from 'react';
import { Database, Download, RefreshCw, FileSpreadsheet, Sparkles, RotateCcw, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { clearUsersCache } from '../hooks/useUsers';
import { ACCESS_CHANGED_EVENT } from '../features/access/useAccessSummary';
import { useApi } from '../hooks/useApi';
import { post, getToken } from '../lib/api';
import { Button, Input, Pill, Skeleton } from '../components/ui';
import { useToast } from '../components/toast';
import SheetsSetupCard from '../features/admin/SheetsSetupCard';

interface AiStatus { gemini: boolean; models: string[]; lastModelUsed?: string; lastError?: string; pausedUntil?: string }
interface DbInfo { driver: string; sheetId?: string | null; schemaVersion: number; tables: { name: string; rows: number }[] }

async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<DbInfo>('/admin/db');
  const ai = useApi<AiStatus>('/ai/status');
  const [busy, setBusy] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  async function run(kind: string, fn: () => Promise<unknown>, done: string) {
    setBusy(kind);
    try { await fn(); toast.success(done); } catch (e) { toast.error(e); } finally { setBusy(null); }
  }
  const total = data?.tables.reduce((s, t) => s + t.rows, 0) ?? 0;

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <h1 className="text-[24px] font-semibold leading-tight">Data admin</h1>
        <p className="text-[13.5px] text-ink-soft">The app keeps every table in one place: a local file database or a Google Sheet (one tab per table). The same layout exports to Oracle.</p>
      </div>
      <div className="mb-4"><SheetsSetupCard /></div>
      {error && <div className="card mb-4 px-4 py-3 text-rose">{error.message}</div>}
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card p-4 md:col-span-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold"><Database size={15} /> Database in use</div>
          {loading && !data ? <Skeleton className="mt-3 h-16" /> : data && (
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between"><dt className="text-ink-muted">Driver</dt><dd><Pill tone="bg-brand-soft text-brand-dark">{data.driver === 'sheets' ? 'Google Sheets' : data.driver === 'local' ? 'Local files' : data.driver}</Pill></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-muted">Sheet</dt><dd className="num truncate text-[12px]" title={data.sheetId ?? ''}>{data.sheetId ? <a className="hover:text-brand" href={`https://docs.google.com/spreadsheets/d/${data.sheetId}`} target="_blank" rel="noreferrer">{data.sheetId.slice(0, 18)}…</a> : 'Not connected'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Schema version</dt><dd className="num">{data.schemaVersion}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Total rows</dt><dd className="num">{total.toLocaleString()}</dd></div>
            </dl>
          )}
          <div className="mt-4 grid gap-2">
            <Button icon={<RefreshCw size={14} />} loading={busy === 'reload'} onClick={() => run('reload', async () => { await post('/admin/db/reload'); reload(); }, 'Data reloaded from the source')}>Reload from source</Button>
            <Button icon={<Download size={14} />} loading={busy === 'oracle'} onClick={() => run('oracle', () => download('/admin/export/oracle', 'deals_separation_oracle.sql'), 'Oracle SQL downloaded')}>Download Oracle SQL</Button>
            <Button icon={<FileSpreadsheet size={14} />} loading={busy === 'xlsx'} onClick={() => run('xlsx', () => download('/admin/export/xlsx', 'deals_separation_data.xlsx'), 'Workbook downloaded')}>Download workbook (.xlsx)</Button>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles size={15} className="text-piku" /> AI (Piku)</div>
            {ai.data && (
              <dl className="mt-2 space-y-1.5 text-[12.5px]">
                <div className="flex justify-between"><dt className="text-ink-muted">Mode</dt><dd><Pill tone={ai.data.gemini && !ai.data.pausedUntil ? 'bg-piku-soft text-piku' : 'bg-sunken text-ink-soft'}>{!ai.data.gemini ? 'Offline (no key)' : ai.data.pausedUntil ? 'Gemini paused' : 'Gemini'}</Pill></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-ink-muted">Models</dt><dd className="num truncate text-[11.5px]" title={ai.data.models.join(', ')}>{ai.data.models[0]}{ai.data.models.length > 1 ? ` +${ai.data.models.length - 1}` : ''}</dd></div>
                {ai.data.lastModelUsed && <div className="flex justify-between"><dt className="text-ink-muted">Last used</dt><dd className="num text-[11.5px]">{ai.data.lastModelUsed}</dd></div>}
                {ai.data.lastError && <div className="rounded-md bg-amber-soft px-2 py-1.5 text-[11.5px] text-ink-soft">Last Gemini error: {ai.data.lastError}{ai.data.pausedUntil ? '. Using offline answers for a few minutes.' : ''}</div>}
              </dl>
            )}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">The Oracle file holds CREATE TABLE statements with keys and checks, followed by INSERTs for every row. See docs/ORACLE_MIGRATION.md.</p>
        </section>
        <section className="card overflow-hidden md:col-span-2">
          <div className="border-b border-line px-4 py-3 text-[13px] font-semibold">Tables</div>
          <table className="w-full text-[13px]">
            <thead><tr><th className="th">Table (sheet tab)</th><th className="th text-right">Rows</th><th className="th w-1/2">Share of data</th></tr></thead>
            <tbody>
              {loading && !data && Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={3} className="td"><Skeleton className="h-5" /></td></tr>)}
              {data?.tables.map((t) => (
                <tr key={t.name}>
                  <td className="td num">{t.name}</td>
                  <td className="td num text-right">{t.rows.toLocaleString()}</td>
                  <td className="td"><div className="h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full bg-ink-soft" style={{ width: `${total ? Math.max(1, (t.rows / total) * 100) : 0}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card mt-4 border-rose/40 p-4" aria-labelledby="danger-h">
        <h2 id="danger-h" className="flex items-center gap-2 text-[14px] font-semibold text-rose"><AlertTriangle size={15} aria-hidden /> Danger zone</h2>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[70ch] text-[13px] text-ink-soft">
            <b>Reset demo data</b> replaces every table{data ? ` in the ${data.driver === 'sheets' ? 'Google Sheet' : 'local database'}` : ''} and loads the demo again, exactly like a fresh start
            (projects, plans, finance, access requests). Everything people changed is lost; the audit log is kept and the reset is recorded in it. People stay signed in.
          </p>
          <Button variant="danger" icon={<RotateCcw size={14} />} onClick={() => setResetOpen(true)}>Reset demo data</Button>
        </div>
      </section>
      <ResetDialog open={resetOpen} onCancel={() => setResetOpen(false)} onDone={() => { setResetOpen(false); reload(); }} />
    </div>
  );
}

function ResetDialog({ open, onCancel, onDone }: { open: boolean; onCancel: () => void; onDone: () => void }) {
  const toast = useToast();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) { setWord(''); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  async function go() {
    setBusy(true);
    try {
      const r = await post<{ rows: number; driver: string }>('/admin/db/reset', { confirm: word });
      clearUsersCache();
      window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
      toast.success(`Demo data restored (${r.rows.toLocaleString()} rows). Other open tabs show it after a refresh.`);
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/30 p-4" onClick={() => !busy && onCancel()}>
      <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-pop" role="alertdialog" aria-modal="true" aria-labelledby="reset-h" onClick={(e) => e.stopPropagation()}>
        <h3 id="reset-h" className="text-[15px] font-semibold">Reset all data to the demo?</h3>
        <p className="mt-2 text-[13px] text-ink-soft">This replaces every table with the demo data, except the audit log, which is kept (the reset is added to it). It cannot be undone. Download the workbook first if you want a copy.</p>
        <label className="mt-3 block">
          <span className="label">Type RESET to confirm</span>
          <Input value={word} onChange={(e) => setWord(e.target.value)} autoFocus autoComplete="off" onKeyDown={(e) => { if (e.key === 'Enter' && word === 'RESET') go(); }} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon={<RotateCcw size={14} />} loading={busy} disabled={word !== 'RESET'} disabledReason="Type RESET first" onClick={go}>Reset demo data</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
