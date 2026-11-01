/**
 * Activity: tasks as Table | Board | Timeline, with filters, bulk status change, quick add, and the right-hand
 * context panel (project snapshot, AI summary, at a glance, notes, contacts, communications).
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Search, Plus, Flag, ClipboardList, Phone, Mail, Video, MessageSquare, StickyNote, Trash2, Table2, Columns3, GanttChart,
  ChevronRight, CalendarDays, PieChart as PieIcon, MessagesSquare, Users, CornerDownLeft,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { ActivityDetail, ProjectDetail, Task, WorkStatus, Communication } from '@shared/types';
import { WORK_STATUS, PRIORITY } from '@shared/schema';
import { useApi } from '../../hooks/useApi';
import { useSort } from '../../hooks/useSort';
import { useSession } from '../../lib/session';
import { patch, post, del } from '../../lib/api';
import { SortHeader } from '../../components/SortHeader';
import Timeline from '../../components/Timeline';
import { Button, Checkbox, EmptyState, Input, Pill, Progress, Select, Skeleton, Textarea, Avatar, StatusIcon } from '../../components/ui';
import { useToast } from '../../components/toast';
import { date, isOverdue, relative, dateTime, num } from '../../lib/format';
import AiSummaryCard from '../../features/ai/AiSummaryCard';
import AiActions from '../../features/ai/AiActions';
import { AddTaskPanel } from './TaskPanel';
import { CHART } from '../dashboard/widgets';
import { ContactList, PanelSection, ProjectSnapshot, WithRightPanel } from './RightPanel';

type TaskRow = ActivityDetail['tasks'][number];
type View = 'table' | 'board' | 'timeline';
const VIEW_KEY = 'dsh.taskview';
const statusTone: Record<string, string> = {
  'Not Started': 'bg-sunken text-ink-soft', 'In Progress': 'bg-blue-soft text-blue', Blocked: 'bg-rose-soft text-rose', Done: 'bg-green-soft text-green',
};

export default function ActivityView({ activityId, projectId, detail, version, onChanged }: {
  activityId: string; projectId: string; detail: ProjectDetail; version: number; onChanged: () => void;
}) {
  const { session } = useSession();
  const toast = useToast();
  const [search, setSearch] = useSearchParams();
  const { data, error, loading, reload, setData } = useApi<ActivityDetail>(`/activities/${activityId}`, [activityId]);
  useEffect(() => { if (version) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || 'table'; } catch { return 'table'; } });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ } }, [view]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('');
  const [day1, setDay1] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const me = session?.user.user_id;
  const tasks = data?.tasks ?? [];
  const assignees = useMemo(() => Array.from(new Map(tasks.filter((t) => t.assignee_user_id).map((t) => [t.assignee_user_id!, t.assignee_name ?? t.assignee_user_id!])).entries()), [tasks]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tasks.filter((t) => (!status || t.status === status) && (!assignee || t.assignee_user_id === assignee) && (!priority || t.priority === priority)
      && (!day1 || t.day1_critical === 'Y') && (!overdue || isOverdue(t.due_date, t.status)) && (!mine || t.assignee_user_id === me)
      && (!s || [t.title, t.description, t.assignee_name, t.task_id].some((v) => v?.toLowerCase().includes(s))));
  }, [tasks, q, status, assignee, priority, day1, overdue, mine, me]);
  const { sorted, sort, toggle } = useSort<TaskRow>(rows, { key: 'sort_order' }, {
    priority: (t) => ({ Critical: 0, High: 1, Medium: 2, Low: 3 } as Record<string, number>)[t.priority ?? ''] ?? 4,
    status: (t) => ({ Blocked: 0, 'In Progress': 1, 'Not Started': 2, Done: 3 } as Record<string, number>)[t.status] ?? 4,
    updated: (t) => t.updated_at ?? t.created_at,
  });
  const closed = detail.project.status === 'Closed';
  const editable = (t: TaskRow) => t.perms.canEdit && !closed;
  const anyEditable = tasks.some(editable);
  const filtersOn = !!(q || status || assignee || priority || day1 || overdue || mine);

  /** Optimistic status change with rollback; offers Undo. */
  async function setTaskStatus(t: TaskRow, s: WorkStatus, opts: { silent?: boolean; undo?: boolean } = {}) {
    if (t.status === s) return;
    const prevStatus = t.status;
    const prevPct = t.percent_complete;
    setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.task_id === t.task_id ? { ...x, status: s, percent_complete: s === 'Done' ? 100 : x.percent_complete } : x)) });
    try {
      await patch(`/tasks/${t.task_id}`, { status: s, ...(s === 'Done' ? { percent_complete: 100 } : {}) });
      if (!opts.silent) {
        toast.success(`"${t.title}" moved to ${s}`, opts.undo === false ? undefined : {
          label: 'Undo',
          run: async () => {
            try { await patch(`/tasks/${t.task_id}`, { status: prevStatus, percent_complete: prevPct ?? 0 }); reload(); onChanged(); toast.info('Change undone'); }
            catch (e) { toast.error(e); }
          },
        });
      }
      onChanged();
      return true;
    } catch (e) {
      setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.task_id === t.task_id ? { ...x, status: prevStatus, percent_complete: prevPct } : x)) });
      toast.error(e);
      return false;
    }
  }

  async function bulkStatus(s: WorkStatus) {
    const targets = tasks.filter((t) => selected.has(t.task_id) && editable(t));
    let ok = 0;
    for (const t of targets) if (await setTaskStatus(t, s, { silent: true })) ok += 1;
    toast.success(`${ok} task${ok === 1 ? '' : 's'} moved to ${s}`);
    setSelected(new Set());
  }

  const openTask = (id: string) => { search.set('task', id); setSearch(search); };

  if (error) return <p className="px-4 py-6 text-rose">Could not load this activity: {error.message}</p>;
  if (loading && !data) return <div className="grid grid-cols-[1fr_340px] gap-4 p-4" aria-busy="true"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>;
  if (!data) return null;
  const a = data.activity;
  const roleName = session?.persona.name ?? 'Your role';
  const canAdd = data.perms.canAddTask && !closed;

  const main = (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold leading-snug">{a.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
            <span className="inline-flex items-center gap-1.5">{a.owner_name ? <><Avatar name={a.owner_name} size={20} />Owner: {a.owner_name}</> : 'No owner set'}</span>
            {a.due_date && <span className="num inline-flex items-center gap-1"><CalendarDays size={13} aria-hidden />Due {date(a.due_date)}</span>}
            {a.priority && <Pill>{a.priority}</Pill>}
          </p>
          {a.description && <p className="mt-1.5 max-w-[90ch] text-[13px] text-ink-soft">{a.description}</p>}
        </div>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)} disabled={!canAdd}
          disabledReason={closed ? 'This project is closed.' : `${roleName} cannot add tasks to this activity.`}>Add task</Button>
      </div>

      {/* Toolbar: view switch + filters */}
      <div className="flex flex-wrap items-center gap-2 border-y border-line bg-canvas/60 px-4 py-2.5">
        <div className="flex rounded-md border border-line-strong bg-surface p-0.5" role="group" aria-label="Task view">
          {([['table', 'Table', <Table2 size={14} key="t" />], ['board', 'Board', <Columns3 size={14} key="b" />], ['timeline', 'Timeline', <GanttChart size={14} key="g" />]] as const).map(([v, label, icon]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={clsx('inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[13px] font-medium', view === v ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sunken hover:text-ink')}>
              {icon}{label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="w-44 pl-8" aria-label="Search tasks" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Status"><option value="">Any status</option>{WORK_STATUS.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-40" aria-label="Assignee"><option value="">Anyone</option>{assignees.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-36" aria-label="Priority"><option value="">Any priority</option>{PRIORITY.map((s) => <option key={s}>{s}</option>)}</Select>
        <button onClick={() => setMine((m) => !m)} aria-pressed={mine}
          className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium', mine ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink hover:bg-sunken')}>
          My tasks
        </button>
        <Checkbox checked={day1} onChange={setDay1} label="Day-1 critical" />
        <Checkbox checked={overdue} onChange={setOverdue} label="Overdue" />
        {filtersOn && <button className="link text-[12.5px]" onClick={() => { setQ(''); setStatus(''); setAssignee(''); setPriority(''); setDay1(false); setOverdue(false); setMine(false); }}>Clear filters</button>}
        <span className="num ml-auto text-[12.5px] text-ink-muted">{rows.length} of {tasks.length} tasks</span>
      </div>

      {selected.size > 0 && view === 'table' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-link-soft/60 px-4 py-2 text-[13px]" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-ink-soft">Move to</span>
          {WORK_STATUS.map((s) => <Button key={s} size="sm" onClick={() => bulkStatus(s)} icon={<StatusIcon status={s} />}>{s}</Button>)}
          <button className="link ml-auto text-[12.5px]" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {view === 'table' && (
        <TaskTable rows={sorted} sort={sort} toggle={toggle} editable={editable} anyEditable={anyEditable} selected={selected} setSelected={setSelected}
          onOpen={openTask} onStatus={(t, s) => setTaskStatus(t, s)} canAdd={canAdd} activityId={a.activity_id}
          onAdded={() => { reload(); onChanged(); }} />
      )}
      {view === 'board' && <TaskBoard rows={sorted} editable={editable} onOpen={openTask} onStatus={(t, s) => setTaskStatus(t, s)} />}
      {view === 'timeline' && (
        <div className="p-4">
          <Timeline items={sorted.map((t) => ({
            id: t.task_id, label: t.title, sublabel: [t.assignee_name, t.status].filter(Boolean).join(', '),
            start: t.start_date, end: t.due_date, progress: t.status === 'Done' ? 100 : t.percent_complete,
            tone: t.status === 'Done' ? 'bg-green/60' : t.status === 'Blocked' ? 'bg-rose/60' : isOverdue(t.due_date, t.status) ? 'bg-amber/60' : 'bg-blue/50',
            onClick: () => openTask(t.task_id), ariaLabel: `Open task ${t.title}`,
          }))} emptyText="These tasks have no dates yet." />
        </div>
      )}

      {!tasks.length && (
        <EmptyState icon={<ClipboardList size={22} />} title="No tasks yet"
          body={canAdd ? 'Add the first task, or open Add task to get AI-suggested tasks from similar past deals.' : 'Tasks will appear here once the team plans this activity.'}
          action={canAdd ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add task</Button> : undefined} />
      )}
      {tasks.length > 0 && !rows.length && (
        <EmptyState icon={<Search size={20} />} title="No tasks match these filters" body="Clear a filter to see more tasks."
          action={<Button onClick={() => { setQ(''); setStatus(''); setAssignee(''); setPriority(''); setDay1(false); setOverdue(false); setMine(false); }}>Clear filters</Button>} />
      )}
    </div>
  );

  return (
    <>
      <WithRightPanel label="Activity context" main={main} panel={<ActivitySidebar data={data} detail={detail} version={version} projectId={projectId} onChanged={() => reload()} />} />
      <AddTaskPanel open={adding} onClose={() => setAdding(false)} activity={a} onSaved={() => { reload(); onChanged(); }} />
    </>
  );
}

function TaskTable({ rows, sort, toggle, editable, anyEditable, selected, setSelected, onOpen, onStatus, canAdd, activityId, onAdded }: {
  rows: TaskRow[]; sort: ReturnType<typeof useSort<TaskRow>>['sort']; toggle: (k: string) => void; editable: (t: TaskRow) => boolean; anyEditable: boolean;
  selected: Set<string>; setSelected: (s: Set<string>) => void; onOpen: (id: string) => void; onStatus: (t: TaskRow, s: WorkStatus) => void;
  canAdd: boolean; activityId: string; onAdded: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const selectable = rows.filter(editable);
  const allOn = selectable.length > 0 && selectable.every((t) => selected.has(t.task_id));

  async function quickAdd() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await post(`/activities/${activityId}/tasks`, { title: title.trim(), status: 'Not Started', priority: 'Medium' });
      toast.success(`Task "${title.trim()}" added`);
      setTitle(''); onAdded();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-[13.5px]">
        <thead>
          <tr>
            {anyEditable && (
              <th className="th w-10 pl-4">
                <input type="checkbox" className="h-4 w-4 cursor-pointer accent-[#B83F04]" aria-label="Select all tasks you can edit" checked={allOn}
                  onChange={(e) => setSelected(new Set(e.target.checked ? selectable.map((t) => t.task_id) : []))} />
              </th>
            )}
            <SortHeader label="Task" k="title" sort={sort} onSort={toggle} className={clsx('min-w-[280px]', anyEditable ? '' : 'pl-4')} />
            <SortHeader label="Assignee" k="assignee_name" sort={sort} onSort={toggle} />
            <SortHeader label="Status" k="status" sort={sort} onSort={toggle} />
            <SortHeader label="Priority" k="priority" sort={sort} onSort={toggle} />
            <SortHeader label="Due" k="due_date" sort={sort} onSort={toggle} />
            <SortHeader label="Progress" k="percent_complete" sort={sort} onSort={toggle} className="w-28" />
            <SortHeader label="Updated" k="updated" sort={sort} onSort={toggle} className="hidden 2xl:table-cell" />
            <th className="th w-20 text-right"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const late = isOverdue(t.due_date, t.status);
            const can = editable(t);
            return (
              <tr key={t.task_id} className="row-action" onClick={() => onOpen(t.task_id)}>
                {anyEditable && (
                  <td className="td w-10 pl-4" onClick={(e) => e.stopPropagation()}>
                    {can && <input type="checkbox" className="h-4 w-4 cursor-pointer accent-[#B83F04]" aria-label={`Select ${t.title}`} checked={selected.has(t.task_id)}
                      onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(t.task_id) : n.delete(t.task_id); setSelected(n); }} />}
                  </td>
                )}
                <td className={clsx('td', !anyEditable && 'pl-4')} data-testid="task-title">
                  <button type="button" className="group flex max-w-full items-center gap-1.5 text-left" onClick={(e) => { e.stopPropagation(); onOpen(t.task_id); }}>
                    {t.day1_critical === 'Y' && <Flag size={13} className="shrink-0 text-rose" aria-label="Day-1 critical" />}
                    <span className={clsx('font-medium text-ink group-hover:text-link group-hover:underline underline-offset-2', t.status === 'Done' && 'text-ink-muted line-through decoration-ink-muted/40')}>{t.title}</span>
                  </button>
                  <div className="num text-[11.5px] text-ink-muted">{t.task_id}{t.dependency_notes ? ' | has dependency' : ''}</div>
                </td>
                <td className="td whitespace-nowrap text-[13px]">{t.assignee_name ? <span className="inline-flex items-center gap-1.5"><Avatar name={t.assignee_name} size={22} />{t.assignee_name}</span> : <span className="text-ink-muted">Unassigned</span>}</td>
                <td className="td" onClick={(e) => can && e.stopPropagation()}>
                  {can ? (
                    <select value={t.status} onChange={(e) => onStatus(t, e.target.value as WorkStatus)} aria-label={`Status of ${t.title}`}
                      className={clsx('h-7 cursor-pointer rounded-full border border-ink/10 py-0 pl-2.5 pr-7 text-[12px] font-medium focus:ring-2 focus:ring-brand-soft', statusTone[t.status])}>
                      {WORK_STATUS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  ) : <Pill>{t.status}</Pill>}
                </td>
                <td className="td">{t.priority ? <Pill>{t.priority}</Pill> : '–'}</td>
                <td className={clsx('td num whitespace-nowrap text-[13px]', late && 'font-medium text-rose')}>{date(t.due_date)}{late && ' (overdue)'}</td>
                <td className="td"><Progress value={t.status === 'Done' ? 100 : t.percent_complete} /></td>
                <td className="td hidden whitespace-nowrap text-[12.5px] text-ink-muted 2xl:table-cell">{relative(t.updated_at ?? t.created_at)}</td>
                <td className="td pr-4 text-right">
                  <span className="inline-flex items-center gap-0.5 text-[12.5px] font-medium text-link">Open<ChevronRight size={15} className="row-chevron" aria-hidden /></span>
                </td>
              </tr>
            );
          })}
        </tbody>
        {canAdd && (
          <tfoot>
            <tr>
              <td colSpan={anyEditable ? 9 : 8} className="border-t border-line px-4 py-2">
                <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); quickAdd(); }}>
                  <Plus size={15} className="shrink-0 text-ink-muted" aria-hidden />
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quick add: type a task title and press Enter"
                    aria-label="Quick add task title" className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[13.5px] hover:border-line focus:border-brand-ring focus:bg-surface focus:outline-none" />
                  {title && <Button size="sm" variant="primary" type="submit" loading={saving} icon={<CornerDownLeft size={13} />}>Add</Button>}
                </form>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Kanban board by status. Drag cards between columns, or use the "Move to" menu on each card (keyboard friendly). */
function TaskBoard({ rows, editable, onOpen, onStatus }: {
  rows: TaskRow[]; editable: (t: TaskRow) => boolean; onOpen: (id: string) => void; onStatus: (t: TaskRow, s: WorkStatus) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const byId = new Map(rows.map((t) => [t.task_id, t]));

  function onDrop(e: DragEvent, s: WorkStatus) {
    e.preventDefault();
    setOver(null);
    const t = byId.get(dragId.current ?? e.dataTransfer.getData('text/plain'));
    dragId.current = null;
    if (t && editable(t)) onStatus(t, s);
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Task board">
      {WORK_STATUS.map((s) => {
        const col = rows.filter((t) => t.status === s);
        return (
          <section key={s} aria-label={`${s} column`}
            onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver((o) => (o === s ? null : o))} onDrop={(e) => onDrop(e, s)}
            className={clsx('flex min-h-[220px] flex-col rounded-xl border border-line bg-canvas/70', over === s && 'drop-target')}>
            <header className="flex items-center justify-between px-3 py-2.5">
              <h4 className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><span className={clsx('inline-flex rounded-full p-0.5', statusTone[s])}><StatusIcon status={s} /></span>{s}</h4>
              <span className="num rounded-full bg-surface px-2 text-[12px] text-ink-soft">{col.length}</span>
            </header>
            <ul className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {col.map((t) => {
                const can = editable(t);
                const late = isOverdue(t.due_date, t.status);
                return (
                  <li key={t.task_id} draggable={can} onDragStart={(e) => { dragId.current = t.task_id; e.dataTransfer.setData('text/plain', t.task_id); e.dataTransfer.effectAllowed = 'move'; }}
                    className={clsx('card-action p-2.5', can && 'active:cursor-grabbing')}>
                    <button type="button" className="block w-full text-left" onClick={() => onOpen(t.task_id)} aria-label={`Open task ${t.title}`}>
                      <span className="flex items-start gap-1.5">
                        {t.day1_critical === 'Y' && <Flag size={13} className="mt-0.5 shrink-0 text-rose" aria-label="Day-1 critical" />}
                        <span className="text-[13.5px] font-medium leading-snug hover:text-link">{t.title}</span>
                      </span>
                      <span className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-soft">
                        <span className="flex min-w-0 items-center gap-1.5">{t.assignee_name ? <><Avatar name={t.assignee_name} size={20} /><span className="truncate">{t.assignee_name}</span></> : 'Unassigned'}</span>
                        <span className={clsx('num shrink-0', late && 'font-medium text-rose')}>{date(t.due_date, false)}{late && ' late'}</span>
                      </span>
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {t.priority ? <Pill>{t.priority}</Pill> : <span />}
                      {can && (
                        <select value={t.status} onChange={(e) => onStatus(t, e.target.value as WorkStatus)} onClick={(e) => e.stopPropagation()}
                          aria-label={`Move ${t.title} to`} className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]">
                          {WORK_STATUS.map((x) => <option key={x} value={x}>{x === t.status ? `Move to...` : x}</option>)}
                        </select>
                      )}
                    </div>
                  </li>
                );
              })}
              {!col.length && <li className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-ink-muted">Drop tasks here</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ActivitySidebar({ data, detail, version, projectId, onChanged }: { data: ActivityDetail; detail: ProjectDetail; version: number; projectId: string; onChanged: () => void }) {
  const toast = useToast();
  const { session } = useSession();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const s = data.stats;
  const a = data.activity;
  const pieData = [
    { name: 'Done', value: s.done, color: CHART.green }, { name: 'In progress', value: s.inProgress, color: CHART.blue },
    { name: 'Blocked', value: s.blocked, color: CHART.rose }, { name: 'Not started', value: Math.max(0, s.total - s.done - s.inProgress - s.blocked), color: '#C9CED6' },
  ].filter((d) => d.value > 0);

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await post('/notes', { project_id: projectId, stage_id: a.stage_id, activity_id: a.activity_id, body: note.trim() });
      setNote(''); toast.success('Note added'); onChanged();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }
  async function removeNote(id: string) {
    try { await del(`/notes/${id}`); toast.success('Note deleted'); onChanged(); } catch (e) { toast.error(e); }
  }

  return (
    <>
      <ProjectSnapshot detail={detail} version={version} />
      <AiSummaryCard scope="activity" id={a.activity_id} />

      <PanelSection title="At a glance" icon={<PieIcon size={14} />}>
        <div className="flex items-center gap-3">
          <div className="h-[84px] w-[84px] shrink-0" aria-hidden>
            {pieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={pieData} dataKey="value" innerRadius={26} outerRadius={40} stroke="none" paddingAngle={2}>{pieData.map((d) => <Cell key={d.name} fill={d.color} />)}</Pie></PieChart>
              </ResponsiveContainer>
            ) : <div className="h-full w-full rounded-full border-[10px] border-sunken" />}
          </div>
          <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
            {([['Total', s.total], ['Done', s.done], ['In progress', s.inProgress], ['Blocked', s.blocked], ['Overdue', s.overdue], ['Day-1 critical', s.day1Critical]] as [string, number][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><dt className="text-ink-muted">{k}</dt><dd className={clsx('num font-medium', (k === 'Blocked' || k === 'Overdue') && v ? 'text-rose' : '')}>{v}</dd></div>
            ))}
            <div className="col-span-2 flex justify-between gap-2 border-t border-line pt-1"><dt className="text-ink-muted">Effort logged</dt><dd className="num font-medium">{num(s.hours)} h</dd></div>
          </dl>
        </div>
      </PanelSection>

      <AiActions scope="activity" id={a.activity_id} />

      <PanelSection title="Quick notes" icon={<StickyNote size={14} />}>
        {data.perms.canAddNote ? (
          <form className="mb-2" onSubmit={(e) => { e.preventDefault(); addNote(); }}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note for the team" className="min-h-[60px]" aria-label="New note" />
            <div className="mt-1.5 flex justify-end"><Button size="sm" variant="primary" type="submit" loading={saving} disabled={!note.trim()}>Add note</Button></div>
          </form>
        ) : <p className="mb-2 text-[12.5px] text-ink-muted">{session?.persona.name} can read notes but not add them.</p>}
        <ul className="space-y-2">
          {data.notes.map((n) => (
            <li key={n.note_id} className="rounded-md bg-canvas px-2.5 py-2 text-[13px]">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <div className="mt-1 flex items-center justify-between text-[11.5px] text-ink-muted">
                <span>{n.author_name ?? 'Someone'}, {relative(n.created_at)}</span>
                {n.created_by === session?.user.user_id && (
                  <button onClick={() => removeNote(n.note_id)} className="inline-flex h-7 items-center gap-1 rounded px-1.5 hover:bg-rose-soft hover:text-rose" aria-label="Delete note">
                    <Trash2 size={12} /> Delete
                  </button>
                )}
              </div>
            </li>
          ))}
          {!data.notes.length && <li className="text-[12.5px] text-ink-muted">No notes yet.</li>}
        </ul>
      </PanelSection>

      {data.contacts.length > 0 && (
        <PanelSection title="Contacts" icon={<Users size={14} />}>
          <ContactList contacts={data.contacts.slice(0, 6)} />
        </PanelSection>
      )}

      <PanelSection title="Recent communications" icon={<MessagesSquare size={14} />}>
        <CommList comms={data.communications.slice(0, 6)} />
      </PanelSection>
    </>
  );
}

const channelIcon: Record<string, JSX.Element> = {
  Email: <Mail size={13} />, Call: <Phone size={13} />, Meeting: <Video size={13} />, Chat: <MessageSquare size={13} />, Note: <StickyNote size={13} />,
};

/** Communication history list (used in side panels and the task panel). Each row expands to show the full text. */
export function CommList({ comms, expanded }: { comms: Communication[]; expanded?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!comms.length) return <p className="text-[12.5px] text-ink-muted">No emails, calls or meetings logged yet.</p>;
  return (
    <ul className="space-y-1.5">
      {comms.map((c) => {
        const isOpen = expanded || open === c.comm_id;
        return (
          <li key={c.comm_id} className="rounded-md border border-line bg-surface">
            <button className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-sunken/60" onClick={() => setOpen(isOpen && !expanded ? null : c.comm_id)} aria-expanded={isOpen}>
              <span className="mt-[2px] text-ink-muted">{channelIcon[c.channel] ?? <MessageSquare size={13} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.subject || c.channel}</span>
                <span className="block truncate text-[12px] text-ink-muted">
                  {c.channel}{c.from_name ? ` from ${c.from_name}` : ''}{c.to_name ? ` to ${c.to_name}` : ''}{c.duration_min ? `, ${c.duration_min} min` : ''}
                </span>
              </span>
              <span className="shrink-0 text-[11.5px] text-ink-muted" title={dateTime(c.occurred_at)}>{relative(c.occurred_at)}</span>
              {!expanded && <ChevronRight size={14} className={clsx('mt-[2px] shrink-0 text-ink-muted transition-transform', isOpen && 'rotate-90')} aria-hidden />}
            </button>
            {isOpen && (
              <div className="border-t border-line px-2.5 py-2 text-[13px]">
                {c.ai_summary && <p className="mb-1.5 rounded bg-piku-soft/70 px-2 py-1 text-[12.5px] text-ink-soft"><span className="font-medium text-piku">AI summary: </span>{c.ai_summary}</p>}
                <p className="whitespace-pre-wrap text-ink-soft">{c.body || 'No body recorded.'}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type { Task };
