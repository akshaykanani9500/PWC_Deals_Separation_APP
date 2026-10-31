import { Link } from 'react-router-dom';
import { ChevronLeft, Pencil, Users, Wallet, Archive, ShieldAlert } from 'lucide-react';
import type { ProjectDetail } from '@shared/types';
import { useSession } from '../../lib/session';
import { Button, Gate, Pill, Progress, RagDot } from '../../components/ui';
import { date, money, num } from '../../lib/format';

type PanelName = 'edit' | 'team' | 'finance' | 'closeout' | 'stages';

export default function ProjectHeader({ detail, onOpen }: { detail: ProjectDetail; onOpen: (p: PanelName) => void }) {
  const { session } = useSession();
  const p = detail.project;
  const perms = detail.perms;
  const role = session?.persona.name ?? 'Your role';
  const closed = p.status === 'Closed';

  const facts: [string, React.ReactNode][] = [
    ['Partner', p.partner_name || '–'],
    ['Manager', p.manager_name || '–'],
    ['Start', <span className="num">{date(p.start_date)}</span>],
    ['Target close', <span className="num">{date(p.target_close_date)}</span>],
    ['Scope', <span className="num">{[p.apps_in_scope && `${num(p.apps_in_scope)} apps`, p.sites_in_scope && `${num(p.sites_in_scope)} sites`, p.employees_conveying && `${num(p.employees_conveying)} people`].filter(Boolean).join(', ') || '–'}</span>],
  ];
  const finance: [string, number | null | undefined][] = perms.canViewFinance ? [
    ['Fee budget', p.fee_budget], ['Billed', p.fee_billed], ['TSA / month', p.tsa_monthly_cost], ['One-time cost', p.one_time_cost], ['Funding gap', p.funding_gap],
  ] : [];

  return (
    <section className="mb-4">
      <Link to="/" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink"><ChevronLeft size={14} /> All projects</Link>
      <div className="card px-5 py-4">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="min-w-[280px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[28px] font-semibold leading-tight">{p.code_name}</h1>
              <Pill>{p.status}</Pill>
              <RagDot rag={p.rag} withLabel />
              {p.clean_team_required === 'Y' && <span className="inline-flex items-center gap-1 rounded bg-amber-soft px-1.5 py-[1px] text-[11.5px] font-medium text-amber" title="Competitively sensitive data is limited to the clean team"><ShieldAlert size={12} /> Clean team</span>}
              {p.sensitivity && <span className="text-[11.5px] text-ink-muted">{p.sensitivity}{p.data_residency ? `, data in ${p.data_residency}` : ''}</span>}
            </div>
            <p className="mt-1 text-[13px] text-ink-soft">{[p.client_alias, p.deal_type, p.industry].filter(Boolean).join(' | ')}</p>
            {p.description && <p className="mt-2 max-w-[78ch] text-[13px] leading-relaxed text-ink-soft">{p.description}</p>}
          </div>
          <div className="w-[220px] shrink-0">
            <div className="text-[11.5px] text-ink-muted">Overall completion</div>
            <div className="num text-[30px] font-medium leading-tight">{Math.round(p.percent_complete ?? 0)}%</div>
            <Progress value={p.percent_complete} showLabel={false} />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Gate allowed={perms.canEditProject} reason={`${role} cannot edit project details.`}>
              <Button icon={<Pencil size={14} />} onClick={() => onOpen('edit')} disabled={!perms.canEditProject || closed}>Edit project</Button>
            </Gate>
            <Button icon={<Users size={14} />} onClick={() => onOpen('team')}>Team ({detail.members.length})</Button>
            {perms.canViewFinance && <Button icon={<Wallet size={14} />} onClick={() => onOpen('finance')}>Finance</Button>}
            {perms.canClose && !closed && <Button variant="primary" icon={<Archive size={14} />} onClick={() => onOpen('closeout')}>Close project</Button>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3 md:grid-cols-5">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0"><div className="text-[11.5px] text-ink-muted">{k}</div><div className="truncate text-[13px]">{v}</div></div>
          ))}
        </div>
        {finance.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {finance.map(([k, v]) => (
              <span key={k} className="inline-flex items-baseline gap-1.5 rounded-md bg-sunken px-2.5 py-1">
                <span className="text-[11.5px] text-ink-muted">{k}</span>
                <span className={`num text-[13px] font-medium ${k === 'Funding gap' && v ? 'text-amber' : ''}`}>{money(v, p.currency)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
