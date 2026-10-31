/** Activity: task table (main) + right panel with AI summary, mini dashboard, quick notes, contacts, comms. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Search, Plus, Flag, ClipboardList, Phone, Mail, Video, MessageSquare, StickyNote, Trash2 } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { ActivityDetail, ProjectDetail, Task, WorkStatus, Communication } from '@shared/types';
import { WORK_STATUS, PRIORITY } from '@shared/schema';
import { useApi } from '../../hooks/useApi';
import { useSort } from '../../hooks/useSort';
import { useSession } from '../../lib/session';
import { patch, post, del } from '../../lib/api';
import { SortHeader } from '../../components/SortHeader';
import { Button, Checkbox, EmptyState, Input, Pill, Progress, Select, Skeleton, Textarea, Avatar } from '../../components/ui';
import { useToast } from '../../components/toast';
import { date, isOverdue, relative, dateTime, num } from '../../lib/format';
import AiSummaryCard from '../../features/ai/AiSummaryCard';
import AiActions from '../../features/ai/AiActions';
import { AddTaskPanel } from './TaskPanel';
import { CHART } from '../dashboard/widgets';

type TaskRow = ActivityDetail['tasks'][number];

export default function ActivityView({ activityId, projectId, detail, version, onChanged }: {
  activityId: string; projectId: string; detail: ProjectDetail; version: number; onChanged: () => void;
}) {
  const { session } = useSession();
  const toast = useToast();
  const [search, setSearch] = useSearchParams();
  const { data, error, loading, reload, setData } = useApi<ActivityDetail>(`/activities/${activityId}`, [activityId]);
  useEffect(() => { if (version) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('');
  const [day1, setDay1] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [adding, setAdding] = useState(false);

  const tasks = data?.tasks ?? [];
  const assignees = useMemo(() => Array.from(new Map(tasks.filter((t) => t.assignee_user_id).map((t) => [t.assignee_user_id!, t.assignee_name ?? t.assignee_user_id!])).entries()), [tasks]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tasks.filter((t) => (!status || t.status === status) && (!assignee || t.assignee_user_id === assignee) && (!priority || t.priority === priority)
      && (!day1 || t.day1_critical === 'Y') && (!overdue || isOverdue(t.due_date, t.status))
      && (!s || [t.title, t.description, t.assignee_name, t.task_id].some((v) => v?.toLowerCase().includes(s))));
  }, [tasks, q, status, assignee, priority, day1, overdue]);
  const { sorted, sort, toggle } = useSort<TaskRow>(rows, { key: 'sort_order' }, {
    priority: (t) => ({ Critical: 0, High: 1, Medium: 2, Low: 3 } as Record<string, number>)[t.priority ?? ''] ?? 4,
    status: (t) => ({ Blocked: 0, 'In Progress': 1, 'Not Started': 2, Done: 3 } as Record<string, number>)[t.status] ?? 4,
    updated: (t) => t.updated_at ?? t.created_at,
  });

  async function quickStatus(t: TaskRow, s: WorkStatus) {
    const prev = data;
    setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.task_id === t.task_id ? { ...x, status: s, percent_complete: s === 'Done' ? 100 : x.percent_complete } : x)) });
    try {
      await patch(`/tasks/${t.task_id}`, { status: s, ...(s === 'Done' ? { percent_complete: 100 } : {}) });
      toast.success(`Status set to ${s}`);
      onChanged();
    } catch (e) { setData(prev); toast.error(e); }
  }

  const openTask = (id: string) => { search.set('task', id); setSearch(search); };
  const closed = detail.project.status === 'Closed';

  if (error) return <p className="px-4 py-6 text-rose">Could not load this activity: {error.message}</p>;
  if (loading && !data) return <div className="grid grid-cols-[1fr_320px] gap-4 p-4"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>;
  if (!data) return null;
  const a = data.activity;
  const roleName = session?.persona.name ?? 'Your role';

  return (
    <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 border-line xl:border-r">
        <div className="flex flex-wrap items-start gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold">{a.name}</h3>
            <p className="text-[12.5px] text-ink-muted">
              {[a.owner_name && `Owner: ${a.owner_name}`, a.due_date && `Due ${date(a.due_date)}`, a.priority && `${a.priority} priority`].filter(Boolean).join(' | ') || 'No owner set'}
            </p>
            {a.description && <p className="mt-1 max-w-[90ch] text-[12.5px] text-ink-soft">{a.description}</p>}
          </div>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)} disabled={!data.perms.canAddTask || closed}
            disabledReason={closed ? 'This project is closed.' : `${roleName} cannot add tasks to this activity.`}>Add task</Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="w-52 pl-8" aria-label="Search tasks" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-32" aria-label="Status"><option value="">Any status</option>{WORK_STATUS.map((s) => <option key={s}>{s}</option>)}</Select>
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-40" aria-label="Assignee"><option value="">Anyone</option>{assignees.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-32" aria-label="Priority"><option value="">Any priority</option>{PRIORITY.map((s) => <option key={s}>{s}</option>)}</Select>
          <Checkbox checked={day1} onChange={setDay1} label="Day-1 critical" />
          <Checkbox checked={overdue} onChange={setOverdue} label="Overdue" />
          <span className="num ml-auto text-[12px] text-ink-muted">{rows.length} of {tasks.length}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <thead>
              <tr>
                <SortHeader label="Task" k="title" sort={sort} onSort={toggle} className="pl-4" />
                <SortHeader label="Assignee" k="assignee_name" sort={sort} onSort={toggle} />
                <SortHeader label="Status" k="status" sort={sort} onSort={toggle} />
                <SortHeader label="Priority" k="priority" sort={sort} onSort={toggle} />
                <SortHeader label="Due" k="due_date" sort={sort} onSort={toggle} />
                <SortHeader label="Progress" k="percent_complete" sort={sort} onSort={toggle} className="w-32" />
                <SortHeader label="Updated" k="updated" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const late = isOverdue(t.due_date, t.status);
                return (
                  <tr key={t.task_id} className="cursor-pointer hover:bg-canvas" onClick={() => openTask(t.task_id)}>
                    <td className="td pl-4">
                      <div className="flex items-center gap-1.5">
                        {t.day1_critical === 'Y' && <Flag size={12} className="shrink-0 text-rose" aria-label="Day-1 critical" />}
                        <span className={clsx('font-medium', t.status === 'Done' && 'text-ink-muted line-through decoration-ink-muted/40')}>{t.title}</span>
                      </div>
                      <div className="num text-[11px] text-ink-muted">{t.task_id}{t.dependency_notes ? ' | has dependency' : ''}</div>
                    </td>
                    <td className="td whitespace-nowrap">{t.assignee_name ? <span className="inline-flex items-center gap-1.5"><Avatar name={t.assignee_name} size={20} />{t.assignee_name}</span> : <span className="text-ink-muted">Unassigned</span>}</td>
                    <td className="td" onClick={(e) => t.perms.canEdit && !closed && e.stopPropagation()}>
                      {t.perms.canEdit && !closed ? (
                        <select value={t.status} onChange={(e) => quickStatus(t, e.target.value as WorkStatus)} aria-label={`Status of ${t.title}`}
                          className={clsx('cursor-pointer rounded-full border-0 py-[1px] pl-2 pr-6 text-[11.5px] font-medium focus:ring-2 focus:ring-brand-soft',
                            { 'bg-sunken text-ink-soft': t.status === 'Not Started', 'bg-blue-soft text-blue': t.status === 'In Progress', 'bg-rose-soft text-rose': t.status === 'Blocked', 'bg-green-soft text-green': t.status === 'Done' })}>
                          {WORK_STATUS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      ) : <Pill>{t.status}</Pill>}
                    </td>
                    <td className="td">{t.priority ? <Pill>{t.priority}</Pill> : '–'}</td>
                    <td className={clsx('td num whitespace-nowrap text-[12.5px]', late && 'font-medium text-rose')}>{date(t.due_date)}{late && ' (overdue)'}</td>
                    <td className="td"><Progress value={t.status === 'Done' ? 100 : t.percent_complete} /></td>
                    <td className="td whitespace-nowrap text-[12px] text-ink-muted">{relative(t.updated_at ?? t.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!tasks.length && <EmptyState icon={<ClipboardList size={26} />} title="No tasks yet" body={data.perms.canAddTask ? 'Add the first task, or use AI suggestion in the Add task panel.' : 'Tasks will appear here once the team plans this activity.'} />}
          {tasks.length > 0 && !rows.length && <EmptyState title="No tasks match these filters" body="Clear a filter to see more." />}
        </div>
      </div>

      <ActivitySidebar data={data} projectId={projectId} onChanged={() => reload()} />

      <AddTaskPanel open={adding} onClose={() => setAdding(false)} activity={a} onSaved={() => { reload(); onChanged(); }} />
    </div>
  );
}

function ActivitySidebar({ data, projectId, onChanged }: { data: ActivityDetail; projectId: string; onChanged: () => void }) {
  const toast = useToast();
  const { session } = useSession();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const s = data.stats;
  const a = data.activity;
  const pieData = [
    { name: 'Done', value: s.done, color: CHART.green }, { name: 'In progress', value: s.inProgress, color: CHART.blue },
    { name: 'Blocked', value: s.blocked, color: CHART.rose }, { name: 'Not started', value: Math.max(0, s.total - s.done - s.inProgress - s.blocked), color: '#D9D3CA' },
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
    try { await del(`/notes/${id}`); onChanged(); } catch (e) { toast.error(e); }
  }

  return (
    <aside className="space-y-4 bg-canvas/50 p-4" aria-label="Activity summary">
      <AiSummaryCard scope="activity" id={a.activity_id} />

      <section className="rounded-lg border border-line bg-surface p-3">
        <h4 className="mb-2 text-[13px] font-semibold">At a glance</h4>
        <div className="flex items-center gap-3">
          <div className="h-[84px] w-[84px] shrink-0">
            {pieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={pieData} dataKey="value" innerRadius={26} outerRadius={40} stroke="none" paddingAngle={2}>{pieData.map((d) => <Cell key={d.name} fill={d.color} />)}</Pie></PieChart>
              </ResponsiveContainer>
            ) : <div className="h-full w-full rounded-full border-[10px] border-sunken" />}
          </div>
          <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            {([['Total', s.total], ['Done', s.done], ['In progress', s.inProgress], ['Blocked', s.blocked], ['Overdue', s.overdue], ['Day-1 critical', s.day1Critical]] as [string, number][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><dt className="text-ink-muted">{k}</dt><dd className={clsx('num font-medium', (k === 'Blocked' || k === 'Overdue') && v ? 'text-rose' : '')}>{v}</dd></div>
            ))}
            <div className="col-span-2 flex justify-between gap-2 border-t border-line pt-1"><dt className="text-ink-muted">Effort logged</dt><dd className="num font-medium">{num(s.hours)} h</dd></div>
          </dl>
        </div>
      </section>

      <AiActions scope="activity" id={a.activity_id} />

      <section className="rounded-lg border border-line bg-surface p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><StickyNote size={14} className="text-ink-muted" /> Quick notes</h4>
        {data.perms.canAddNote ? (
          <div className="mb-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note for the team" className="min-h-[56px]" aria-label="New note" />
            <div className="mt-1.5 flex justify-end"><Button size="sm" variant="primary" onClick={addNote} loading={saving} disabled={!note.trim()}>Add note</Button></div>
          </div>
        ) : <p className="mb-2 text-[12px] text-ink-muted">{session?.persona.name} can read notes but not add them.</p>}
        <ul className="space-y-2">
          {data.notes.map((n) => (
            <li key={n.note_id} className="group rounded-md bg-canvas px-2.5 py-2 text-[12.5px]">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <div className="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
                <span>{n.author_name ?? 'Someone'}, {relative(n.created_at)}</span>
                {n.created_by === session?.user.user_id && <button onClick={() => removeNote(n.note_id)} className="opacity-0 hover:text-rose group-hover:opacity-100" aria-label="Delete note"><Trash2 size={12} /></button>}
              </div>
            </li>
          ))}
          {!data.notes.length && <li className="text-[12px] text-ink-muted">No notes yet.</li>}
        </ul>
      </section>

      {data.contacts.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-3">
          <h4 className="mb-2 text-[13px] font-semibold">Contacts</h4>
          <ul className="space-y-2">
            {data.contacts.slice(0, 6).map((c) => (
              <li key={c.contact_id} className="text-[12.5px]">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.full_name}</span>{c.side && <span className="text-[11px] text-ink-muted">{c.side}</span>}</div>
                <div className="text-[11.5px] text-ink-muted">{[c.role_title, c.org].filter(Boolean).join(', ')}</div>
                <div className="num mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-soft">
                  {c.phone && <span className="inline-flex items-center gap-1"><Phone size={11} />{c.phone}</span>}
                  {c.email && <span className="inline-flex items-center gap-1"><Mail size={11} />{c.email}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-line bg-surface p-3">
        <h4 className="mb-2 text-[13px] font-semibold">Recent communications</h4>
        <CommList comms={data.communications.slice(0, 6)} />
      </section>
    </aside>
  );
}

const channelIcon: Record<string, JSX.Element> = {
  Email: <Mail size={13} />, Call: <Phone size={13} />, Meeting: <Video size={13} />, Chat: <MessageSquare size={13} />, Note: <StickyNote size={13} />,
};

/** Communication history list (used in activity sidebar and task panel). */
export function CommList({ comms, expanded }: { comms: Communication[]; expanded?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!comms.length) return <p className="text-[12px] text-ink-muted">No emails, calls or meetings logged yet.</p>;
  return (
    <ul className="space-y-1.5">
      {comms.map((c) => {
        const isOpen = expanded || open === c.comm_id;
        return (
          <li key={c.comm_id} className="rounded-md border border-line/70 bg-canvas/60">
            <button className="flex w-full items-start gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(isOpen && !expanded ? null : c.comm_id)} aria-expanded={isOpen}>
              <span className="mt-[2px] text-ink-muted">{channelIcon[c.channel] ?? <MessageSquare size={13} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{c.subject || c.channel}</span>
                <span className="block truncate text-[11.5px] text-ink-muted">
                  {c.channel}{c.from_name ? ` from ${c.from_name}` : ''}{c.to_name ? ` to ${c.to_name}` : ''}{c.duration_min ? `, ${c.duration_min} min` : ''}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-ink-muted" title={dateTime(c.occurred_at)}>{relative(c.occurred_at)}</span>
            </button>
            {isOpen && (
              <div className="border-t border-line/70 px-2.5 py-2 text-[12.5px]">
                {c.ai_summary && <p className="mb-1.5 rounded bg-piku-soft/60 px-2 py-1 text-[12px] text-ink-soft"><span className="font-medium text-piku">AI summary: </span>{c.ai_summary}</p>}
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
