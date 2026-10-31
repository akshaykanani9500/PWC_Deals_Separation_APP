/** Browser-style stage tabs. Active tab merges into the content card below; gate state shows on each tab. */
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, Clock3, Pencil } from 'lucide-react';
import type { ProjectDetail } from '@shared/types';

type StageRow = ProjectDetail['stages'][number];

export function GateIcon({ status, size = 13 }: { status?: string; size?: number }) {
  if (status === 'Approved') return <CheckCircle2 size={size} className="shrink-0 text-green" aria-label="Gate approved" />;
  if (status === 'Pending Approval') return <Clock3 size={size} className="shrink-0 text-amber" aria-label="Gate pending approval" />;
  return null;
}

export default function StageTabs({ projectId, stages, activeId, currentId, canEdit, onEdit }: {
  projectId: string; stages: StageRow[]; activeId?: string; currentId?: string; canEdit: boolean; onEdit: () => void;
}) {
  return (
    <div className="relative z-[1] -mb-px flex items-end gap-1 overflow-x-auto pt-1" role="tablist" aria-label="Stages">
      {stages.map((s, i) => {
        const active = s.stage_id === activeId;
        const current = s.stage_id === currentId;
        return (
          <Link
            key={s.stage_id}
            role="tab"
            aria-selected={active}
            to={`/projects/${projectId}/stages/${s.stage_id}`}
            title={`${s.name}${s.description ? ` - ${s.description}` : ''}`}
            className={clsx(
              'group relative flex min-w-[140px] max-w-[240px] shrink-0 items-center gap-2 rounded-t-[10px] border border-b-0 px-3.5 pb-2.5 pt-2 transition-colors',
              active ? 'border-line bg-surface text-ink shadow-[0_-1px_0_0_theme(colors.brand.DEFAULT)_inset]' : 'border-transparent bg-sunken/80 text-ink-soft hover:bg-sunken hover:text-ink',
            )}
          >
            {active && <span className="absolute inset-x-2 top-0 h-[3px] rounded-b bg-brand" />}
            <span className={clsx('num flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]',
              s.percent_complete && s.percent_complete >= 100 ? 'bg-green text-white' : active ? 'bg-ink text-white' : 'bg-line text-ink-soft')}>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{s.name}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                <span className="num">{Math.round(s.percent_complete ?? 0)}%</span>
                {current && <span className="rounded bg-brand-soft px-1 font-medium text-brand-dark">Current</span>}
              </span>
            </span>
            <GateIcon status={s.gate_status} />
          </Link>
        );
      })}
      <button
        onClick={onEdit}
        disabled={!canEdit}
        title={canEdit ? 'Add, rename, reorder or remove stages' : 'Your role cannot change the stages of this project'}
        className="mb-1 ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Edit stages"
      >
        <Pencil size={15} />
      </button>
    </div>
  );
}
