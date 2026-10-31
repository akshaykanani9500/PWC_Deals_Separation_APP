/** Audit log: every change, AI action, approval and denied access. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ScrollText } from 'lucide-react';
import type { AuditEntry } from '@shared/types';
import { useApi } from '../hooks/useApi';
import { useUsers } from '../hooks/useUsers';
import { Checkbox, EmptyState, Input, Select, Skeleton } from '../components/ui';
import { dateTime } from '../lib/format';
import { humanAction } from './dashboard/widgets';

export default function AuditPage() {
  const [limit, setLimit] = useState(300);
  const { data, loading, error } = useApi<AuditEntry[]>(`/audit?limit=${limit}`, [limit]);
  const users = useUsers();
  const names = useMemo(() => new Map(users.map((u) => [u.user_id, u.full_name])), [users]);
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [aiOnly, setAiOnly] = useState(false);
  const [deniedOnly, setDeniedOnly] = useState(false);

  const entities = useMemo(() => Array.from(new Set((data ?? []).map((a) => a.entity_type).filter(Boolean))) as string[], [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((a) => (!entity || a.entity_type === entity) && (!aiOnly || a.ai_generated === 'Y') && (!deniedOnly || a.action === 'access.denied')
      && (!s || [a.action, a.entity_id, a.project_id, a.persona_code, names.get(a.actor_user_id ?? ''), a.details].some((v) => v?.toLowerCase().includes(s))));
  }, [data, q, entity, aiOnly, deniedOnly, names]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-[26px] font-semibold leading-tight">Audit log</h1>
        <p className="text-[13px] text-ink-soft">Who did what, when. Includes AI actions and refused access attempts, so any decision can be rebuilt.</p>
      </div>
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, action, record" className="w-64 pl-8" aria-label="Search audit log" />
          </div>
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-40" aria-label="Record type"><option value="">All record types</option>{entities.map((e) => <option key={e}>{e}</option>)}</Select>
          <Checkbox checked={aiOnly} onChange={setAiOnly} label="AI actions only" />
          <Checkbox checked={deniedOnly} onChange={setDeniedOnly} label="Denied access only" />
          <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} className="ml-auto w-36" aria-label="How many"><option value="100">Last 100</option><option value="300">Last 300</option><option value="1000">Last 1,000</option></Select>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th><th className="th">Record</th><th className="th">Project</th><th className="th">Details</th></tr></thead>
            <tbody>
              {loading && !data && Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={6} className="td"><Skeleton className="h-5" /></td></tr>)}
              {rows.map((a) => (
                <tr key={a.audit_id} className={a.action === 'access.denied' ? 'bg-rose-soft/40' : undefined}>
                  <td className="td num whitespace-nowrap text-[12px] text-ink-soft">{dateTime(a.created_at)}</td>
                  <td className="td whitespace-nowrap">{names.get(a.actor_user_id ?? '') ?? a.actor_user_id ?? 'System'}<div className="text-[11px] text-ink-muted">{a.persona_code}</div></td>
                  <td className="td">{humanAction(a.action)}{a.ai_generated === 'Y' && <span className="ml-1.5 rounded bg-piku-soft px-1 text-[10.5px] font-medium text-piku">AI</span>}<div className="num text-[11px] text-ink-muted">{a.action}</div></td>
                  <td className="td num text-[12px]">{a.entity_type ? `${a.entity_type} ` : ''}{a.entity_id ?? ''}</td>
                  <td className="td num text-[12px]">{a.project_id ? <Link className="hover:text-brand" to={`/projects/${a.project_id}`}>{a.project_id}</Link> : '–'}</td>
                  <td className="td max-w-[380px] truncate text-[12px] text-ink-muted" title={a.details ?? undefined}>{a.details ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p className="px-4 py-6 text-rose">{error.message}</p>}
          {data && !rows.length && <EmptyState icon={<ScrollText size={26} />} title="No entries match" />}
        </div>
      </section>
    </div>
  );
}
