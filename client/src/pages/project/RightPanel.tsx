/**
 * Right-hand context panel shown on every stage and activity view (collapsible, remembered per browser).
 * It leads with what is relevant to the current screen (stage overview or the selected activity);
 * the Project snapshot sits at the bottom as a compact, collapsible section (collapsed by default, remembered).
 */
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Ban, CalendarClock, ChevronDown, ChevronRight, ListChecks, Mail, PanelRightClose, PanelRightOpen, Phone, ShieldAlert } from 'lucide-react';
import type { Contact, ProjectDetail, ProjectListItem } from '@shared/types';
import { get } from '../../lib/api';
import { Avatar, Pill, ProgressRing, RagDot, TextLink } from '../../components/ui';
import { date, money } from '../../lib/format';

const KEY = 'dsh.rightpanel';

export function useRightPanel() {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(KEY) !== 'closed'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem(KEY, open ? 'open' : 'closed'); } catch { /* ignore */ } }, [open]);
  return { open, setOpen };
}

/** Two-column layout: main content + collapsible aside. */
export function WithRightPanel({ main, panel, label }: { main: ReactNode; panel: ReactNode; label: string }) {
  const { open, setOpen } = useRightPanel();
  return (
    <div className={clsx('rp-grid grid grid-cols-1', open ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'xl:grid-cols-[minmax(0,1fr)_44px]')}>
      <div className="min-w-0">{main}</div>
      {open ? (
        <aside className="border-line bg-canvas/60 xl:border-l" aria-label={label}>
          {/* Sticky + own scroll on wide screens so the snapshot stays in view while the task list scrolls.
              Extra bottom padding keeps the last section clear of the Piku bubble. */}
          <div className="rp-sticky xl:sticky xl:top-[218px] xl:max-h-[calc(100vh-218px)] xl:overflow-y-auto xl:overscroll-contain">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-canvas px-4 py-2">
            <span className="text-[12.5px] font-medium text-ink-muted">{label}</span>
            <button onClick={() => setOpen(false)} className="hidden h-8 items-center gap-1 rounded-md px-2 text-[12.5px] text-ink-soft hover:bg-sunken hover:text-ink xl:inline-flex"
              aria-label="Hide side panel"><PanelRightClose size={15} /> Hide</button>
          </div>
          <div className="space-y-3 p-4 pb-24">{panel}</div>
          </div>
        </aside>
      ) : (
        <div className="rp-collapsed hidden border-l border-line bg-canvas/60 xl:block">
          <button onClick={() => setOpen(true)} className="sticky top-[226px] mt-3 flex h-9 w-9 items-center justify-center rounded-md text-ink-soft hover:bg-sunken hover:text-ink"
            aria-label="Show side panel" title="Show project snapshot, summary and notes"><PanelRightOpen size={16} /></button>
        </div>
      )}
    </div>
  );
}

/** Small panel section card. */
export function PanelSection({ title, icon, children, right }: { title: string; icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[13.5px] font-semibold">{icon && <span className="text-ink-muted">{icon}</span>}{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

let countsCache: { at: number; rows: ProjectListItem[] } | null = null;
function useProjectCounts(projectId: string, version: number) {
  const [row, setRow] = useState<ProjectListItem | null>(() => countsCache?.rows.find((r) => r.project_id === projectId) ?? null);
  useEffect(() => {
    let live = true;
    const fresh = countsCache && Date.now() - countsCache.at < 5000 && !version;
    const p = fresh ? Promise.resolve(countsCache!.rows) : get<ProjectListItem[]>('/projects?includeClosed=1').then((rows) => { countsCache = { at: Date.now(), rows }; return rows; });
    p.then((rows) => { if (live) setRow(rows.find((r) => r.project_id === projectId) ?? null); }).catch(() => { /* snapshot still renders */ });
    return () => { live = false; };
  }, [projectId, version]);
  return row;
}

const SNAP_KEY = 'dsh.snapshot.open';

/**
 * Project summary at the bottom of every stage and activity panel. Collapsed by default (the header above already
 * shows the essentials); the user's choice is remembered.
 */
export function ProjectSnapshot({ detail, version = 0 }: { detail: ProjectDetail; version?: number }) {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(SNAP_KEY) === 'open'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(SNAP_KEY, open ? 'open' : 'closed'); } catch { /* ignore */ } }, [open]);
  const p = detail.project;
  return (
    <section className="rounded-lg border border-line bg-surface" data-testid="project-snapshot">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="project-snapshot-body"
        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3.5 py-2.5 text-left hover:bg-sunken/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring">
        <ListChecks size={14} className="shrink-0 text-ink-muted" aria-hidden />
        <span className="text-[13.5px] font-semibold">Project snapshot</span>
        {!open && (
          <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 truncate text-[12px] text-ink-muted">
            <RagDot rag={p.rag} /><span className="num">{Math.round(p.percent_complete ?? 0)}%</span><span aria-hidden>·</span><span className="truncate">{p.status}</span>
          </span>
        )}
        <ChevronDown size={16} className={clsx('ml-auto shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div id="project-snapshot-body" className="border-t border-line px-3.5 pb-3.5 pt-3"><SnapshotBody detail={detail} version={version} /></div>}
    </section>
  );
}

function SnapshotBody({ detail, version }: { detail: ProjectDetail; version: number }) {
  const p = detail.project;
  const counts = useProjectCounts(p.project_id, version);
  const stages = [...detail.stages].sort((a, b) => a.sort_order - b.sort_order);
  const current = stages.find((s) => s.stage_id === p.current_stage_id);
  const nextGate = stages.find((s) => s.gate_status !== 'Approved');
  const risks: { icon: ReactNode; text: string }[] = [];
  if (p.rag === 'Red') risks.push({ icon: <AlertTriangle size={13} />, text: 'Project is rated Red' });
  if (counts?.overdue_tasks) risks.push({ icon: <CalendarClock size={13} />, text: `${counts.overdue_tasks} overdue task${counts.overdue_tasks > 1 ? 's' : ''}` });
  if (counts?.blocked_tasks) risks.push({ icon: <Ban size={13} />, text: `${counts.blocked_tasks} blocked task${counts.blocked_tasks > 1 ? 's' : ''}` });
  if (detail.perms.canViewFinance && p.funding_gap) risks.push({ icon: <AlertTriangle size={13} />, text: `Funding gap of ${money(p.funding_gap, p.currency)} to resolve` });
  if (p.clean_team_required === 'Y') risks.push({ icon: <ShieldAlert size={13} />, text: 'Clean-team rules apply to sensitive data' });

  return (
    <>
      <div className="flex items-center gap-3">
        <ProgressRing value={p.percent_complete} size={52} label={`Project ${Math.round(p.percent_complete ?? 0)}% complete`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><Pill>{p.status}</Pill><RagDot rag={p.rag} withLabel /></div>
          {current && (
            <div className="truncate text-[12.5px] text-ink-soft">Current stage:{' '}
              <TextLink to={`/projects/${p.project_id}/stages/${current.stage_id}`}>{current.name}</TextLink></div>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {([['Open', counts?.open_tasks, ''], ['Overdue', counts?.overdue_tasks, 'text-rose'], ['Blocked', counts?.blocked_tasks, 'text-rose']] as const).map(([k, v, tone]) => (
          <div key={k} className="rounded-md bg-sunken px-2 py-1.5">
            <dt className="text-[11.5px] text-ink-muted">{k}</dt>
            <dd className={clsx('num text-[16px] font-semibold', v ? tone : '')}>{v ?? '–'}</dd>
          </div>
        ))}
      </dl>

      {nextGate && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-2 text-[12.5px]">
          <span className="min-w-0"><span className="text-ink-muted">Next gate: </span>
            <TextLink to={`/projects/${p.project_id}/stages/${nextGate.stage_id}`}>{nextGate.name}</TextLink></span>
          <Pill>{nextGate.gate_status ?? 'Not Ready'}</Pill>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
        {([['Partner', p.partner_name], ['Manager', p.manager_name]] as const).map(([k, n]) => (
          <div key={k} className="flex min-w-0 items-center gap-2">
            <Avatar name={n} size={24} />
            <span className="min-w-0"><span className="block text-[11.5px] text-ink-muted">{k}</span><span className="block truncate">{n || '–'}</span></span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[12px] text-ink-muted">Target close <span className="num text-ink-soft">{date(p.target_close_date)}</span></div>

      {detail.perms.canViewFinance && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {([['Fees', p.fee_billed, p.fee_budget], ['TSA / month', p.tsa_monthly_cost, null], ['One-time', p.one_time_cost, null]] as const).map(([k, v, of]) => (
            <span key={k} className="inline-flex items-baseline gap-1 rounded-md bg-sunken px-2 py-1 text-[12px]">
              <span className="text-ink-muted">{k}</span>
              <span className="num font-medium">{money(v, p.currency)}{of ? <span className="text-ink-muted"> / {money(of, p.currency)}</span> : null}</span>
            </span>
          ))}
        </div>
      )}

      {risks.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="mb-1 text-[12px] font-medium text-ink-soft">Watch-outs</div>
          <ul className="space-y-1">
            {risks.map((r) => (
              <li key={r.text} className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"><span className="text-rose">{r.icon}</span>{r.text}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Chevron used at the end of clickable rows. */
export function RowChevron() {
  return <ChevronRight size={16} className="row-chevron" aria-hidden />;
}

/** Contacts with click-to-call / click-to-email links (masked values stay plain text). */
export function ContactList({ contacts }: { contacts: Contact[] }) {
  return (
    <ul className="space-y-2.5">
      {contacts.map((c) => (
        <li key={c.contact_id} className="text-[13px]">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.full_name}</span>{c.side && <span className="rounded bg-sunken px-1.5 text-[11.5px] text-ink-soft">{c.side}</span>}</div>
          <div className="text-[12px] text-ink-muted">{[c.role_title, c.org].filter(Boolean).join(', ')}</div>
          <div className="num mt-0.5 flex flex-wrap gap-x-3 text-[12px]">
            {c.phone && (c.phone.includes('•') ? <span className="inline-flex items-center gap-1 text-ink-soft"><Phone size={12} />{c.phone}</span>
              : <a className="link inline-flex items-center gap-1 font-normal" href={`tel:${c.phone.replace(/\s/g, '')}`}><Phone size={12} />{c.phone}</a>)}
            {c.email && (c.email.includes('•') ? <span className="inline-flex items-center gap-1 text-ink-soft"><Mail size={12} />{c.email}</span>
              : <a className="link inline-flex items-center gap-1 font-normal" href={`mailto:${c.email}`}><Mail size={12} />{c.email}</a>)}
          </div>
        </li>
      ))}
    </ul>
  );
}

