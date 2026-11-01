/** Data admin: which database is in use, row counts, reload from Google Sheets, exports for Oracle (v3). */
import { useState } from 'react';
import { Database, Download, RefreshCw, FileSpreadsheet, Sparkles } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { post, getToken } from '../lib/api';
import { Button, Pill, Skeleton } from '../components/ui';
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
    </div>
  );
}
