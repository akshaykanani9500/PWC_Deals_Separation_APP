/**
 * Finance workspace (full screen): /projects/:projectId/finance?tab=overview|gap|effort|billing|funding|options|tsa (&cost=<cost_id> highlights a line)
 * Who sees it: roles with finance.view, or someone with an approved access grant on THIS project. Editing needs finance.edit.
 * Visibility only - the app never applies for, or arranges, financing.
 */
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, KeyRound, Lock, Pencil, ShieldCheck, Eye } from 'lucide-react';
import type { FinanceWorkspace, ProjectDetail } from '@shared/types';
import { useApi } from '../../hooks/useApi';
import { useSession } from '../../lib/session';
import { Breadcrumbs, Button, ButtonLink, EmptyState, Skeleton, onTabListKey } from '../../components/ui';
import { NotFoundPage, ForbiddenPage } from '../StatusPages';
import { date } from '../../lib/format';
import RequestAccessPanel from '../../features/access/RequestAccessPanel';
import RecordPanel, { type FinanceKind } from './RecordPanel';
import { OverviewTab, EffortTab, BillingTab, FundingTab, OptionsTab, TsaTab } from './tabs';
import { GapTab } from './GapTab';
import SetupPanel from './SetupPanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'gap', label: 'Gap & split' },
  { id: 'effort', label: 'Time & fees' },
  { id: 'billing', label: 'Billing' },
  { id: 'funding', label: 'Costs & funding' },
  { id: 'options', label: 'Funding options' },
  { id: 'tsa', label: 'TSA charges' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export interface EditTarget { kind: FinanceKind; row?: Record<string, any> | null; initial?: Record<string, any> }

export default function FinancePage() {
  const { projectId = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const { session } = useSession();
  const detail = useApi<ProjectDetail>(`/projects/${projectId}`, [projectId]);
  const ws = useApi<FinanceWorkspace>(`/projects/${projectId}/finance`, [projectId]);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const tab = (TABS.find((t) => t.id === search.get('tab'))?.id ?? 'overview') as TabId;
  const [setupOpen, setSetupOpen] = useState(false);
  const focusCost = search.get('cost');
  const setTab = (id: TabId, extra?: Record<string, string>) => {
    const next = new URLSearchParams({ tab: id, ...(extra ?? {}) });
    setSearch(next, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const people = useMemo(() => (detail.data?.members ?? [])
    .filter((m) => ['PARTNER', 'MANAGER', 'LEAD', 'ANALYST', 'EXEC'].includes(m.persona_code))
    .map((m) => ({ value: m.user_id, label: m.full_name })), [detail.data]);

  if (detail.error?.status === 404) return <NotFoundPage what="project" />;
  if (detail.error?.status === 403) return <ForbiddenPage reason="You are not staffed on this project, or your role cannot see it." />;
  if (detail.loading && !detail.data) return <div className="space-y-3"><Skeleton className="h-5 w-72" /><Skeleton className="h-24" /><Skeleton className="h-[420px]" /></div>;
  if (!detail.data) return null;
  const d = detail.data;
  const p = d.project;
  const grant = d.grants?.find((g) => g.permission_code.startsWith('finance'));
  const locked = ws.error?.status === 403;
  const w = ws.data;
  const refresh = () => { ws.reload(); detail.reload(); };

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: p.code_name, to: `/projects/${projectId}` }, { label: 'Finance' }]} />
      <section className="mb-3 rounded-xl border border-line bg-surface px-5 py-3.5 shadow-card">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="min-w-[260px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold leading-tight">Finance · {p.code_name}</h1>
              {w && (w.perms.canEdit
                ? <span className="inline-flex items-center gap-1 rounded-md bg-green-soft px-1.5 py-[2px] text-[12px] font-medium text-green"><Pencil size={12} /> You can edit</span>
                : <span className="inline-flex items-center gap-1 rounded-md bg-sunken px-1.5 py-[2px] text-[12px] font-medium text-ink-soft"><Eye size={12} /> View only</span>)}
              {grant && (
                <span className="inline-flex items-center gap-1 rounded-md bg-blue-soft px-1.5 py-[2px] text-[12px] font-medium text-blue" title="Given through an approved access request">
                  <ShieldCheck size={12} /> Access approved until {date(grant.expires_at)}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {[p.client_alias, `figures in ${p.currency || 'USD'}`].filter(Boolean).join(' · ')}. Where the time and money go, who billed what, what the separation costs and how it is funded.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink to={`/projects/${projectId}`} icon={<ArrowLeft size={14} />}>Back to project</ButtonLink>
            {(d.perms.canRequestAccess || d.perms.canSponsorAccess) && <Button icon={<KeyRound size={14} />} onClick={() => setAccessOpen(true)}>Access</Button>}
          </div>
        </div>
        {w?.perms.editReason && !locked && <p className="mt-2 text-[12.5px] text-ink-muted">{w.perms.editReason}</p>}
      </section>

      {locked ? (
        <div className="card">
          <EmptyState icon={<Lock size={22} />} title="Finance is restricted on this project"
            body={`Your role (${session?.persona.name}) cannot see fees, invoices, costs or funding. Engagement Partners, Managers and the Deals Leader can. If you need it for your work, request time-bound access: a Partner or Manager approves first, then Risk & Quality.`}
            action={d.perms.canRequestAccess ? <Button variant="primary" icon={<KeyRound size={14} />} onClick={() => setAccessOpen(true)}>Request finance access</Button> : undefined} />
        </div>
      ) : ws.error ? (
        <div className="card px-4 py-6 text-rose">Could not load finance: {ws.error.message}</div>
      ) : !w ? (
        <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-[380px]" /></div>
      ) : (
        <>
          <div role="tablist" aria-label="Finance sections" onKeyDown={onTabListKey} className="sticky top-[88px] z-20 -mx-5 mb-3 flex gap-1 overflow-x-auto border-b border-line bg-canvas px-5">
            {TABS.map((t) => (
              <button key={t.id} role="tab" id={`fin-tab-${t.id}`} aria-controls="fin-panel" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}
                className={clsx('-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors',
                  tab === t.id ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
                {t.label}
              </button>
            ))}
          </div>
          <div id="fin-panel" role="tabpanel" aria-labelledby={`fin-tab-${tab}`}>
            {tab === 'overview' && <OverviewTab w={w} go={setTab} onSetup={() => setSetupOpen(true)} />}
            {tab === 'gap' && <GapTab w={w} go={setTab} onSetup={() => setSetupOpen(true)} />}
            {tab === 'effort' && <EffortTab w={w} />}
            {tab === 'billing' && <BillingTab w={w} onEdit={setEdit} onChanged={refresh} />}
            {tab === 'funding' && <FundingTab w={w} onEdit={setEdit} focusCost={focusCost} />}
            {tab === 'options' && <OptionsTab w={w} onEdit={setEdit} onChanged={refresh} />}
            {tab === 'tsa' && <TsaTab w={w} />}
          </div>
          {setupOpen && <SetupPanel w={w} onClose={() => setSetupOpen(false)} onSaved={refresh} />}
          {edit && <RecordPanel open kind={edit.kind} row={edit.row} initial={edit.initial} ws={w} people={people} onClose={() => setEdit(null)} onSaved={refresh} />}
        </>
      )}
      <RequestAccessPanel open={accessOpen} onClose={() => setAccessOpen(false)} detail={d} defaultPermission="finance.view" onChanged={refresh} />
    </div>
  );
}
