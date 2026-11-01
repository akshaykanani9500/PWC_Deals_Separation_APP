/**
 * Stage tabs: sticky under the workspace bar. Each tab is a bordered, numbered step with progress and gate state;
 * the selected tab is raised and joins the stage content below.
 */
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, Clock3, Pencil } from 'lucide-react';
import type { ProjectDetail } from '@shared/types';
import { onTabListKey } from '../../components/ui';

type StageRow = ProjectDetail['stages'][number];

export function GateIcon({ status, size = 14 }: { status?: string; size?: number }) {
  if (status === 'Approved') return <CheckCircle2 size={size} className="shrink-0 text-green" aria-label="Gate approved" />;
  if (status === 'Pending Approval') return <Clock3 size={size} className="shrink-0 text-amber" aria-label="Gate pending approval" />;
  return null;
}

export default function StageTabs({ projectId, stages, activeId, currentId, canEdit, onEdit }: {
  projectId: string; stages: StageRow[]; activeId?: string; currentId?: string; canEdit: boolean; onEdit: () => void;
}) {
  return (
    <div className="sticky top-[88px] z-30 -mx-5 bg-canvas px-5 pt-2">
      <div className="flex items-end gap-1.5">
        <div className="flex min-w-0 flex-1 items-end gap-1.5 overflow-x-auto pb-0" role="tablist" aria-label="Stages" onKeyDown={onTabListKey}>
          {stages.map((s, i) => {
            const active = s.stage_id === activeId;
            const current = s.stage_id === currentId;
            const pct = Math.round(s.percent_complete ?? 0);
            return (
              <Link
                key={s.stage_id}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                to={`/projects/${projectId}/stages/${s.stage_id}`}
                title={`${s.name}${s.description ? `: ${s.description}` : ''}`}
                className={clsx(
                  'group relative flex min-w-[150px] max-w-[250px] shrink-0 flex-col gap-1 rounded-t-lg border px-3 pb-2 pt-2.5 transition-colors',
                  active
                    ? 'z-[1] -mb-px border-line border-b-surface bg-surface text-ink shadow-[0_-2px_6px_rgb(22_25_29/0.05)]'
                    : 'mb-1 border-line bg-sunken/70 text-ink-soft hover:border-line-strong hover:bg-surface hover:text-ink',
                )}
              >
                {active && <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-lg bg-brand-bright" aria-hidden />}
                <span className="flex items-center gap-2">
                  <span className={clsx('num flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    pct >= 100 ? 'bg-green text-white' : active ? 'bg-ink text-white' : 'bg-line text-ink-soft')}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{s.name}</span>
                  <GateIcon status={s.gate_status} />
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/70">
                    <span className={clsx('block h-full rounded-full', pct >= 100 ? 'bg-green' : 'bg-blue')} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="num w-9 text-right text-[11.5px] text-ink-muted">{pct}%</span>
                </span>
                {current && <span className="absolute -top-2 right-2 rounded-full bg-brand px-1.5 text-[10.5px] font-semibold text-white">Current</span>}
              </Link>
            );
          })}
        </div>
        <button
          onClick={onEdit}
          disabled={!canEdit}
          title={canEdit ? 'Add, rename, reorder or remove stages' : 'Your role cannot change the stages of this project'}
          className="mb-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink shadow-card hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Pencil size={14} aria-hidden /> Edit stages
        </button>
      </div>
    </div>
  );
}
