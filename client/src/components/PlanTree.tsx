/**
 * Editable checklist tree for AI-suggested plans: stages > activities > tasks.
 * The user can rename, untick, add and remove rows before anything is saved.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';

export interface PlanTask { key: string; include: boolean; title: string; priority?: string; day1_critical?: 'Y' | 'N'; effort_hours?: number; description?: string }
export interface PlanActivity { key: string; include: boolean; name: string; description?: string; priority?: string; tasks: PlanTask[] }
export interface PlanStage { key: string; include: boolean; name: string; description?: string; gate_criteria?: string; activities: PlanActivity[] }

let k = 0;
const key = () => `n${++k}`;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const yn = (v: unknown): 'Y' | 'N' => (v === true || v === 'Y' || v === 'y' || v === 'true' ? 'Y' : 'N');

export function toPlanTasks(raw: unknown): PlanTask[] {
  return (Array.isArray(raw) ? raw : []).map((t: any) => ({
    key: key(), include: true, title: str(t?.title ?? t?.name), priority: t?.priority ? str(t.priority) : undefined, day1_critical: yn(t?.day1_critical),
    effort_hours: Number.isFinite(Number(t?.effort_hours)) && t?.effort_hours != null ? Number(t.effort_hours) : undefined,
    description: t?.description ? str(t.description) : undefined,
  })).filter((t) => t.title);
}
export function toPlanActivities(raw: unknown): PlanActivity[] {
  return (Array.isArray(raw) ? raw : []).map((a: any) => ({
    key: key(), include: true, name: str(a?.name ?? a?.title), description: a?.description ? str(a.description) : undefined,
    priority: a?.priority ? str(a.priority) : undefined, tasks: toPlanTasks(a?.tasks),
  })).filter((a) => a.name);
}
export function toPlanStages(raw: unknown): PlanStage[] {
  return (Array.isArray(raw) ? raw : []).map((s: any) => ({
    key: key(), include: true, name: str(s?.name), description: s?.description ? str(s.description) : undefined,
    gate_criteria: s?.gate_criteria ? str(s.gate_criteria) : undefined, activities: toPlanActivities(s?.activities),
  })).filter((s) => s.name);
}

export const tasksPayload = (ts: PlanTask[]) => ts.filter((t) => t.include && t.title.trim())
  .map(({ title, priority, day1_critical, effort_hours, description }) => ({ title: title.trim(), ...(priority ? { priority } : {}), day1_critical: day1_critical ?? 'N',
    ...(effort_hours != null ? { effort_hours } : {}), ...(description ? { description } : {}) }));
export const activitiesPayload = (as: PlanActivity[]) => as.filter((a) => a.include && a.name.trim())
  .map((a) => ({ name: a.name.trim(), ...(a.description ? { description: a.description } : {}), ...(a.priority ? { priority: a.priority } : {}), tasks: tasksPayload(a.tasks) }));
export const stagesPayload = (ss: PlanStage[]) => ss.filter((s) => s.include && s.name.trim())
  .map((s) => ({ name: s.name.trim(), ...(s.description ? { description: s.description } : {}), ...(s.gate_criteria ? { gate_criteria: s.gate_criteria } : {}), activities: activitiesPayload(s.activities) }));

function RowShell({ depth, include, onToggle, children, onRemove, count, open, onOpen }: {
  depth: number; include: boolean; onToggle: (v: boolean) => void; children: React.ReactNode; onRemove: () => void;
  count?: number; open?: boolean; onOpen?: () => void;
}) {
  return (
    <div className={clsx('group flex items-center gap-1.5 rounded py-0.5 pr-1 hover:bg-canvas', !include && 'opacity-50')} style={{ paddingLeft: depth * 18 }}>
      {onOpen ? (
        <button onClick={onOpen} className="rounded p-0.5 text-ink-muted hover:text-ink" aria-label={open ? 'Collapse' : 'Expand'}>
          <ChevronRight size={14} className={clsx('transition-transform', open && 'rotate-90')} />
        </button>
      ) : <span className="w-[18px]" />}
      <input type="checkbox" className="h-3.5 w-3.5 accent-[#B83F04]" checked={include} onChange={(e) => onToggle(e.target.checked)} aria-label="Include" />
      <div className="min-w-0 flex-1">{children}</div>
      {count !== undefined && <span className="num shrink-0 text-[11px] text-ink-muted">{count}</span>}
      <button onClick={onRemove} className="rounded p-0.5 text-ink-muted opacity-0 hover:text-rose group-hover:opacity-100 focus:opacity-100" aria-label="Remove row"><Trash2 size={13} /></button>
    </div>
  );
}

const inlineInput = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] hover:border-line focus:border-brand-ring focus:bg-surface focus:outline-none';

export function TaskList({ tasks, onChange, depth = 0 }: { tasks: PlanTask[]; onChange: (t: PlanTask[]) => void; depth?: number }) {
  const set = (i: number, patch: Partial<PlanTask>) => onChange(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div>
      {tasks.map((t, i) => (
        <RowShell key={t.key} depth={depth} include={t.include} onToggle={(v) => set(i, { include: v })} onRemove={() => onChange(tasks.filter((_, j) => j !== i))}>
          <div className="flex items-center gap-2">
            <input className={inlineInput} value={t.title} onChange={(e) => set(i, { title: e.target.value })} aria-label="Task title" />
            {t.day1_critical === 'Y' && <span className="shrink-0 rounded bg-rose-soft px-1 text-[10.5px] font-medium text-rose">Day-1</span>}
            {t.priority && <span className="shrink-0 text-[11px] text-ink-muted">{t.priority}</span>}
            {t.effort_hours != null && <span className="num shrink-0 text-[11px] text-ink-muted">{t.effort_hours} h</span>}
          </div>
        </RowShell>
      ))}
      <button onClick={() => onChange([...tasks, { key: key(), include: true, title: 'New task', priority: 'Medium', day1_critical: 'N' }])}
        className="mt-0.5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-ink-muted hover:text-brand" style={{ marginLeft: depth * 18 + 22 }}>
        <Plus size={12} /> Add task
      </button>
    </div>
  );
}

export function ActivityList({ activities, onChange, depth = 0 }: { activities: PlanActivity[]; onChange: (a: PlanActivity[]) => void; depth?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const set = (i: number, patch: Partial<PlanActivity>) => onChange(activities.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div>
      {activities.map((a, i) => (
        <div key={a.key}>
          <RowShell depth={depth} include={a.include} onToggle={(v) => set(i, { include: v })} onRemove={() => onChange(activities.filter((_, j) => j !== i))}
            count={a.tasks.length} open={!!open[a.key]} onOpen={() => setOpen((o) => ({ ...o, [a.key]: !o[a.key] }))}>
            <input className={clsx(inlineInput, 'font-medium')} value={a.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Activity name" />
          </RowShell>
          {open[a.key] && <TaskList tasks={a.tasks} onChange={(t) => set(i, { tasks: t })} depth={depth + 1} />}
        </div>
      ))}
      <button onClick={() => onChange([...activities, { key: key(), include: true, name: 'New activity', tasks: [] }])}
        className="mt-0.5 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-ink-muted hover:text-brand" style={{ marginLeft: depth * 18 + 22 }}>
        <Plus size={12} /> Add activity
      </button>
    </div>
  );
}

export function StageList({ stages, onChange }: { stages: PlanStage[]; onChange: (s: PlanStage[]) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const set = (i: number, patch: Partial<PlanStage>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div>
      {stages.map((s, i) => (
        <div key={s.key} className="border-b border-line/70 py-1 last:border-0">
          <RowShell depth={0} include={s.include} onToggle={(v) => set(i, { include: v })} onRemove={() => onChange(stages.filter((_, j) => j !== i))}
            count={s.activities.length} open={!!open[s.key]} onOpen={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}>
            <input className={clsx(inlineInput, 'font-semibold')} value={s.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Stage name" />
          </RowShell>
          {open[s.key] && <ActivityList activities={s.activities} onChange={(a) => set(i, { activities: a })} depth={1} />}
        </div>
      ))}
      <button onClick={() => onChange([...stages, { key: key(), include: true, name: 'New stage', activities: [] }])}
        className="mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-ink-muted hover:text-brand" style={{ marginLeft: 22 }}>
        <Plus size={12} /> Add stage
      </button>
    </div>
  );
}

export function planCounts(stages: PlanStage[]) {
  const s = stages.filter((x) => x.include);
  const a = s.flatMap((x) => x.activities.filter((y) => y.include));
  const t = a.flatMap((x) => x.tasks.filter((y) => y.include));
  return { stages: s.length, activities: a.length, tasks: t.length };
}
