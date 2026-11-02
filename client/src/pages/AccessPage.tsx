/** Access & approvals: my requests, my approval inbox (level 1 or level 2) and everything I oversee. */
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Inbox, KeyRound, ListChecks, ShieldCheck } from 'lucide-react';
import type { AccessRequestRow } from '@shared/types';
import { GRANTABLE } from '@shared/access';
import { useApi } from '../hooks/useApi';
import { useSession } from '../lib/session';
import { Breadcrumbs, EmptyState, Input, Select, Skeleton, onTabListKey } from '../components/ui';
import RequestCard from '../features/access/RequestCard';
import { ACCESS_CHANGED_EVENT } from '../features/access/useAccessSummary';

type View = 'inbox' | 'mine' | 'all';

export default function AccessPage() {
  const { session, can } = useSession();
  const approver = can('access.approve') || can('access.review');
  const [view, setView] = useState<View>(approver ? 'inbox' : 'mine');
  const { data, loading, error, reload } = useApi<AccessRequestRow[]>('/access/requests', []);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const me = session?.user.user_id;

  const rows = useMemo(() => {
    let r = data ?? [];
    if (view === 'inbox') r = r.filter((g) => g.can.approveL1 || g.can.approveL2);
    if (view === 'mine') r = r.filter((g) => g.grantee_user_id === me || g.requested_by === me);
    if (state) r = r.filter((g) => g.state === state);
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter((g) => [g.grantee_name, g.project_code, g.label, g.justification, g.grant_id].some((v) => v?.toLowerCase().includes(s)));
    }
    return r;
  }, [data, view, me, q, state]);
  const counts = {
    inbox: (data ?? []).filter((g) => g.can.approveL1 || g.can.approveL2).length,
    mine: (data ?? []).filter((g) => g.grantee_user_id === me || g.requested_by === me).length,
    all: (data ?? []).length,
  };
  const changed = () => { reload(); window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT)); };

  const tabs: { id: View; label: string; icon: JSX.Element; show: boolean }[] = [
    { id: 'inbox', label: 'Waiting for my approval', icon: <Inbox size={15} />, show: approver },
    { id: 'mine', label: 'My requests', icon: <KeyRound size={15} />, show: true },
    { id: 'all', label: approver ? 'Everything I oversee' : 'All I can see', icon: <ListChecks size={15} />, show: true },
  ];

  return (
    <div className="mx-auto max-w-[1180px]">
      <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: 'Access & approvals' }]} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold">Access &amp; approvals</h1>
          <p className="mt-0.5 max-w-[80ch] text-[13.5px] text-ink-soft">
            Extra permissions are given per project, for a limited time, after two approvals: <b>level 1</b> by the engagement (Partner / Manager) and
            <b> level 2</b> by Risk &amp; Quality. Request access from the <b>Access</b> button on a project page.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div role="tablist" aria-label="Access views" onKeyDown={onTabListKey} className="mb-3 flex flex-wrap gap-1 border-b border-line">
            {tabs.filter((t) => t.show).map((t) => (
              <button key={t.id} role="tab" aria-selected={view === t.id} tabIndex={view === t.id ? 0 : -1} onClick={() => setView(t.id)}
                className={clsx('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium',
                  view === t.id ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
                {t.icon}{t.label}
                <span className={clsx('num rounded-full px-1.5 text-[11.5px]', t.id === 'inbox' && counts.inbox ? 'bg-amber text-white' : 'bg-sunken text-ink-soft')}>{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder="Search person, project, permission" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests" />
            <Select className="w-44" value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {['Pending L1', 'Pending L2', 'Active', 'Expired', 'Rejected', 'Revoked', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </div>
          {error && <p className="text-rose">{error.message}</p>}
          {loading && !data ? <div className="space-y-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : rows.length ? (
            <div className="space-y-3">{rows.map((g) => <RequestCard key={g.grant_id} g={g} onChanged={changed} />)}</div>
          ) : (
            <div className="card"><EmptyState icon={<ShieldCheck size={22} />} title={view === 'inbox' ? 'Nothing waiting for you' : 'No requests here'}
              body={view === 'inbox' ? 'New requests that need your approval will appear here.' : 'Open a project and use the Access button to ask for extra, time-bound access.'} /></div>
          )}
        </div>

        <aside className="space-y-3">
          <section className="card px-4 py-3.5 text-[12.5px] text-ink-soft">
            <h2 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink"><ShieldCheck size={15} className="text-blue" /> Rules</h2>
            <ul className="list-disc space-y-1 pl-4">
              <li>One person, one project, 7 / 30 / 90 days.</li>
              <li>Level 1 holds the permission and is senior to the person getting it. A sponsoring Partner / Manager counts as level 1.</li>
              <li>Level 2 is Risk &amp; Quality, never the requester or the level-1 approver.</li>
              <li>Nobody approves their own request. Role-only rights (gate approval, close-out, audit, admin) never move between people.</li>
              <li>Clients and control roles keep fixed access.</li>
            </ul>
          </section>
          <section className="card px-4 py-3.5">
            <h2 className="mb-2 text-[13.5px] font-semibold">What can be requested</h2>
            <ul className="space-y-2">
              {GRANTABLE.map((g) => (
                <li key={g.code} className="text-[12.5px]">
                  <div className="font-medium text-ink">{g.label}</div>
                  <div className="text-ink-muted">{g.description}</div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
