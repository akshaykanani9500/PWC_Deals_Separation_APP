/**
 * Compact project header: one row with identity, health and actions; longer details (description, scope,
 * finance, stage timeline) sit in a "Project overview" section that opens on demand.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, Pencil, Users, Wallet, Archive, ShieldAlert, ShieldCheck, KeyRound, Lock } from 'lucide-react';
import type { ProjectDetail } from '@shared/types';
import { useSession } from '../../lib/session';
import { Avatar, Button, ButtonLink, Gate, Pill, ProgressRing, RagDot } from '../../components/ui';
import { date, money, num } from '../../lib/format';
import StageTimeline from './StageTimeline';

type PanelName = 'edit' | 'team' | 'access' | 'closeout' | 'stages';
const OVERVIEW_KEY = 'dsh.overview.open';

export default function ProjectHeader({ detail, onOpen }: { detail: ProjectDetail; onOpen: (p: PanelName) => void }) {
  const { session } = useSession();
  const p = detail.project;
  const perms = detail.perms;
  const role = session?.persona.name ?? 'Your role';
  const closed = p.status === 'Closed';
  const [overview, setOverview] = useState<boolean>(() => { try { return localStorage.getItem(OVERVIEW_KEY) === '1'; } catch { return false; } });
  const toggle = () => setOverview((o) => { try { localStorage.setItem(OVERVIEW_KEY, o ? '0' : '1'); } catch { /* ignore */ } return !o; });

  const facts: [string, React.ReactNode][] = [
    ['Client', p.client_alias || '–'],
    ['Deal type', p.deal_type || '–'],
    ['Industry', p.industry || '–'],
    ['Dates', <span className="num">{date(p.start_date)} to {date(p.target_close_date)}</span>],
    ['Scope', <span className="num">{[p.apps_in_scope && `${num(p.apps_in_scope)} apps`, p.sites_in_scope && `${num(p.sites_in_scope)} sites`, p.employees_conveying && `${num(p.employees_conveying)} people`].filter(Boolean).join(', ') || '–'}</span>],
    ['Data', `${p.sensitivity ?? '–'}${p.data_residency ? `, held in ${p.data_residency}` : ''}`],
  ];
  const finance: [string, number | null | undefined][] = perms.canViewFinance ? [
    ['Fee budget', p.fee_budget], ['Billed', p.fee_billed], ['TSA / month', p.tsa_monthly_cost], ['One-time cost', p.one_time_cost], ['Funding gap', p.funding_gap],
  ] : [];

  return (
    <section className="mb-3 rounded-xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5">
        <ProgressRing value={p.percent_complete} size={50} label={`Overall completion ${Math.round(p.percent_complete ?? 0)}%`} />
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-[22px] font-semibold leading-tight">{p.code_name}</h1>
            <Pill>{p.status}</Pill>
            <RagDot rag={p.rag} withLabel />
            {p.clean_team_required === 'Y' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-soft px-1.5 py-[2px] text-[12px] font-medium text-amber" title="Competitively sensitive data is limited to the clean team">
                <ShieldAlert size={12} /> Clean team
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-soft">{[p.client_alias, p.deal_type, p.industry].filter(Boolean).join(' | ')}</p>
          {!!detail.grants?.length && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {detail.grants.map((g) => (
                <button key={g.grant_id} onClick={() => onOpen('access')} title="Extra access given to you through an approved request"
                  className="inline-flex items-center gap-1 rounded-md bg-blue-soft px-1.5 py-[2px] text-[12px] font-medium text-blue hover:underline">
                  <ShieldCheck size={12} /> {g.label} · until {date(g.expires_at)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {([['Partner', p.partner_name], ['Manager', p.manager_name]] as const).map(([k, n]) => (
            <div key={k} className="hidden items-center gap-2 lg:flex">
              <Avatar name={n} size={28} />
              <span className="leading-tight"><span className="block text-[11.5px] text-ink-muted">{k}</span><span className="block text-[13px]">{n || '–'}</span></span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Gate allowed={perms.canEditProject} reason={`${role} cannot edit project details.`}>
            <Button icon={<Pencil size={14} />} onClick={() => onOpen('edit')} disabled={!perms.canEditProject || closed}>Edit project</Button>
          </Gate>
          <Button icon={<Users size={14} />} onClick={() => onOpen('team')}>Team ({detail.members.length})</Button>
          {perms.canViewFinance ? (
            <ButtonLink to={`/projects/${p.project_id}/finance`} icon={<Wallet size={14} />}>Finance</ButtonLink>
          ) : perms.canRequestAccess ? (
            <ButtonLink to={`/projects/${p.project_id}/finance`} icon={<Lock size={14} />} title="Finance is restricted for your role; open it to request access">Finance</ButtonLink>
          ) : null}
          {perms.canClose && !closed && <Button variant="primary" icon={<Archive size={14} />} onClick={() => onOpen('closeout')}>Close project</Button>}
        </div>
      </div>

      <div className="flex items-stretch border-t border-line">
        <button onClick={toggle} aria-expanded={overview} aria-controls="project-overview" aria-label={overview ? 'Hide project overview' : 'Show project overview'}
          className="flex min-w-0 flex-1 items-center gap-2 px-5 py-2 text-left text-[13px] font-medium text-link hover:bg-link-soft/40">
          <ChevronDown size={15} className={clsx('shrink-0 transition-transform', !overview && '-rotate-90')} aria-hidden />
          {overview ? 'Hide project overview' : 'Show project overview'}
          <span className="truncate font-normal text-ink-muted">Description, scope{finance.length ? ', finance' : ''} and stage timeline</span>
        </button>
        {(perms.canRequestAccess || perms.canSponsorAccess) && (
          <button onClick={() => onOpen('access')}
            className="flex shrink-0 items-center gap-1.5 border-l border-line px-4 py-2 text-[13px] font-medium text-ink-soft hover:bg-sunken hover:text-ink"
            title={perms.canSponsorAccess ? 'Extra access for your team: sponsor, approve and revoke (two-level approval)' : 'Request extra, time-bound access on this project (two-level approval)'}>
            <KeyRound size={14} aria-hidden /> {perms.canSponsorAccess ? 'Access & approvals' : 'Request access'}
          </button>
        )}
      </div>
      {overview && (
        <div id="project-overview" className="grid gap-5 border-t border-line px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-w-0">
            {p.description && <p className="mb-3 max-w-[75ch] text-[13.5px] leading-relaxed text-ink-soft">{p.description}</p>}
            <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-3">
              {facts.map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="text-[12px] text-ink-muted">{k}</dt><dd className="text-[13.5px] leading-snug">{v}</dd></div>
              ))}
            </dl>
            {finance.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {finance.map(([k, v]) => (
                  <span key={k} className="inline-flex items-baseline gap-1.5 rounded-md bg-sunken px-2.5 py-1">
                    <span className="text-[12px] text-ink-muted">{k}</span>
                    <span className={`num text-[13px] font-medium ${k === 'Funding gap' && v ? 'text-amber' : ''}`}>{money(v, p.currency)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-2 text-[13px] font-semibold">Stage timeline</div>
            <StageTimeline detail={detail} />
          </div>
        </div>
      )}
    </section>
  );
}
