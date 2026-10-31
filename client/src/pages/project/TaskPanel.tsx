/** Task side panel (opened from a table row, linkable via ?task=) and the Add task panel. */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Trash2, Sparkles } from 'lucide-react';
import type { Activity, SuggestResponse, Task, TaskDetail } from '@shared/types';
import { WORK_STATUS, PRIORITY } from '@shared/schema';
import { useApi } from '../../hooks/useApi';
import { useUsers } from '../../hooks/useUsers';
import { useSession } from '../../lib/session';
import { patch, post, del } from '../../lib/api';
import { SidePanel, ConfirmDialog } from '../../components/SidePanel';
import { AiLabel, AiStrip, Button, Checkbox, Field, Input, Pill, Select, Skeleton, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import { date, dateTime, isOverdue, relative } from '../../lib/format';
import AiSuggestButton from '../../features/ai/AiSuggestButton';
import AiActions from '../../features/ai/AiActions';
import { CommList } from './ActivityView';
import { humanAction } from '../dashboard/widgets';

type Form = Partial<Record<keyof Task, string>>;
const FIELDS: (keyof Task)[] = ['title', 'description', 'assignee_user_id', 'status', 'priority', 'start_date', 'due_date', 'percent_complete', 'effort_hours', 'day1_critical', 'dependency_notes', 'done_notes', 'pending_notes'];
const NUMERIC = new Set<keyof Task>(['percent_complete', 'effort_hours']);

function toForm(t: Task): Form {
  const f: Form = {};
  for (const k of FIELDS) f[k] = t[k] == null ? '' : String(t[k]);
  return f;
}

function TaskFields({ form, set, editable, users, aiChanged }: {
  form: Form; set: (k: keyof Task, v: string) => void; editable: (k: keyof Task) => boolean;
  users: { user_id: string; full_name: string }[]; aiChanged?: Set<string>;
}) {
  const mark = (k: keyof Task) => clsx(aiChanged?.has(k) && 'ring-2 ring-piku/40');
  const dis = (k: keyof Task) => !editable(k);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Title" className="col-span-2"><Input className={mark('title')} value={form.title ?? ''} disabled={dis('title')} onChange={(e) => set('title', e.target.value)} /></Field>
      <Field label="Description" className="col-span-2"><Textarea className={mark('description')} value={form.description ?? ''} disabled={dis('description')} onChange={(e) => set('description', e.target.value)} /></Field>
      <Field label="Assignee">
        <Select className={mark('assignee_user_id')} value={form.assignee_user_id ?? ''} disabled={dis('assignee_user_id')} onChange={(e) => set('assignee_user_id', e.target.value)}>
          <option value="">Unassigned</option>{users.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
        </Select>
      </Field>
      <Field label="Status">
        <Select className={mark('status')} value={form.status ?? 'Not Started'} disabled={dis('status')} onChange={(e) => set('status', e.target.value)}>{WORK_STATUS.map((s) => <option key={s}>{s}</option>)}</Select>
      </Field>
      <Field label="Priority">
        <Select className={mark('priority')} value={form.priority ?? ''} disabled={dis('priority')} onChange={(e) => set('priority', e.target.value)}><option value="">Not set</option>{PRIORITY.map((s) => <option key={s}>{s}</option>)}</Select>
      </Field>
      <Field label="Progress (%)"><Input className={mark('percent_complete')} type="number" min={0} max={100} value={form.percent_complete ?? ''} disabled={dis('percent_complete')} onChange={(e) => set('percent_complete', e.target.value)} /></Field>
      <Field label="Start date"><Input className={mark('start_date')} type="date" value={form.start_date ?? ''} disabled={dis('start_date')} onChange={(e) => set('start_date', e.target.value)} /></Field>
      <Field label="Due date"><Input className={mark('due_date')} type="date" value={form.due_date ?? ''} disabled={dis('due_date')} onChange={(e) => set('due_date', e.target.value)} /></Field>
      <Field label="Effort (hours)"><Input className={mark('effort_hours')} type="number" min={0} value={form.effort_hours ?? ''} disabled={dis('effort_hours')} onChange={(e) => set('effort_hours', e.target.value)} /></Field>
      <div className="flex items-end pb-1.5"><Checkbox checked={form.day1_critical === 'Y'} disabled={dis('day1_critical')} onChange={(v) => set('day1_critical', v ? 'Y' : 'N')} label="Day-1 critical" /></div>
      <Field label="What has already happened" className="col-span-2"><Textarea className={mark('done_notes')} value={form.done_notes ?? ''} disabled={dis('done_notes')} onChange={(e) => set('done_notes', e.target.value)} /></Field>
      <Field label="What is still pending" className="col-span-2"><Textarea className={mark('pending_notes')} value={form.pending_notes ?? ''} disabled={dis('pending_notes')} onChange={(e) => set('pending_notes', e.target.value)} /></Field>
      <Field label="Waiting on (dependencies)" className="col-span-2"><Textarea className={mark('dependency_notes')} value={form.dependency_notes ?? ''} disabled={dis('dependency_notes')} onChange={(e) => set('dependency_notes', e.target.value)} /></Field>
    </div>
  );
}

function diffPayload(form: Form, base: Form, editable: (k: keyof Task) => boolean) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (!editable(k) || (form[k] ?? '') === (base[k] ?? '')) continue;
    const v = form[k] ?? '';
    out[k] = NUMERIC.has(k) ? (v === '' ? null : Number(v)) : v === '' ? null : v;
  }
  return out;
}

function applyDraft(draft: SuggestResponse['draft'], form: Form, editable: (k: keyof Task) => boolean) {
  const d = (Array.isArray(draft) ? draft[0] ?? {} : draft) as Record<string, unknown>;
  const next = { ...form };
  const changed = new Set<string>();
  for (const k of FIELDS) {
    if (!(k in d) || !editable(k) || d[k] == null) continue;
    const v = String(d[k]);
    if (v !== (form[k] ?? '')) { next[k] = v; changed.add(k); }
  }
  return { next, changed };
}

export default function TaskPanel({ taskId, projectId, version, onClose, onChanged }: {
  taskId: string | null; projectId: string; version: number; onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const { session, can } = useSession();
  const users = useUsers();
  const { data, error, loading, reload } = useApi<TaskDetail>(taskId ? `/tasks/${taskId}` : null, [taskId]);
  const [form, setForm] = useState<Form>({});
  const [tab, setTab] = useState<'details' | 'comms' | 'notes' | 'history'>('details');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ai, setAi] = useState<{ changed: Set<string>; mode: string; rationale: string } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => { if (data) setForm(toForm(data.task)); setAi(null); }, [data]);
  useEffect(() => { setTab('details'); }, [taskId]);
  useEffect(() => { if (version && taskId) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  const editableSet = useMemo(() => new Set<string>(data?.perms.canEdit ? data.perms.editableFields : []), [data]);
  const editable = (k: keyof Task) => editableSet.has(k);
  const base = useMemo(() => (data ? toForm(data.task) : {}), [data]);
  const changes = data ? diffPayload(form, base, editable) : {};
  const dirty = Object.keys(changes).length > 0;
  const t = data?.task;

  async function save() {
    if (!t || !dirty) return;
    setSaving(true);
    try {
      await patch(`/tasks/${t.task_id}`, changes);
      toast.success('Task saved');
      onChanged(); reload();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }
  async function remove() {
    if (!t) return;
    setDeleting(true);
    try { await del(`/tasks/${t.task_id}`); toast.success('Task deleted'); setConfirm(false); onClose(); onChanged(); }
    catch (e) { toast.error(e); } finally { setDeleting(false); }
  }
  async function addNote() {
    if (!t || !note.trim()) return;
    try { await post('/notes', { project_id: projectId, stage_id: t.stage_id, activity_id: t.activity_id, task_id: t.task_id, body: note.trim() }); setNote(''); reload(); toast.success('Note added'); }
    catch (e) { toast.error(e); }
  }

  const readOnlyReason = data && !data.perms.canEdit
    ? `${session?.persona.name ?? 'Your role'} can view this task but not change it${session?.persona.code === 'ANALYST' ? ': analysts can only update tasks assigned to them' : ''}.`
    : data && data.perms.editableFields.length < FIELDS.length ? 'You can update status, progress and notes on this task. Other fields are set by the activity owner.' : null;

  return (
    <>
      <SidePanel open={!!taskId} onClose={onClose} width="lg"
        title={t ? t.title : 'Task'}
        subtitle={t ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{t.task_id}</span><Pill>{t.status}</Pill>{t.priority && <Pill>{t.priority}</Pill>}
            {t.day1_critical === 'Y' && <Pill tone="bg-rose-soft text-rose">Day-1 critical</Pill>}
            <span className={clsx('num', isOverdue(t.due_date, t.status) && 'font-medium text-rose')}>Due {date(t.due_date)}</span>
          </span>
        ) : undefined}
        footer={data ? (
          <>
            {data.perms.canDelete && <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirm(true)} className="mr-auto">Delete task</Button>}
            <Button variant="ghost" onClick={onClose}>Close</Button>
            {data.perms.canEdit && <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>Save changes</Button>}
          </>
        ) : undefined}
      >
        {error && <p className="text-rose">{error.status === 403 ? 'You cannot open this task.' : error.status === 404 ? 'This task no longer exists.' : error.message}</p>}
        {loading && !data && <div className="space-y-3"><Skeleton className="h-8" /><Skeleton className="h-40" /><Skeleton className="h-24" /></div>}
        {data && t && (
          <>
            <div className="mb-4 flex gap-1 rounded-lg bg-sunken p-1" role="tablist">
              {([['details', 'Details'], ['comms', `Communication (${data.communications.length})`], ['notes', `Notes (${data.notes.length})`], ['history', 'History']] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={clsx('flex-1 rounded-md px-2 py-1 text-[12.5px] font-medium', tab === k ? 'bg-surface text-ink shadow-card' : 'text-ink-soft hover:text-ink')}>{l}</button>
              ))}
            </div>

            {tab === 'details' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-line p-3 text-[12.5px]">
                  <div><div className="text-[11.5px] text-ink-muted">Assignee</div>{t.assignee_name ?? 'Unassigned'}</div>
                  <div><div className="text-[11.5px] text-ink-muted">Completed</div><span className="num">{date(t.completed_date)}</span></div>
                  <div><div className="text-[11.5px] text-ink-muted">Last update</div>{relative(t.updated_at ?? t.created_at)}</div>
                </div>
                {readOnlyReason && <p className="rounded-md bg-sunken px-3 py-2 text-[12.5px] text-ink-soft">{readOnlyReason}</p>}
                {data.perms.canEdit && can('ai.suggest') && (
                  <div className="rounded-lg border border-dashed border-piku/30 bg-piku-soft/40 px-3 py-2">
                    <p className="mb-2 text-[12.5px] text-ink-soft">Let AI propose updated fields from the latest emails, calls and notes. You review before saving.</p>
                    <AiSuggestButton label="Suggest update" request={{ kind: 'task', projectId, taskId: t.task_id, activityId: t.activity_id, stageId: t.stage_id, current: form }}
                      onApply={(draft, res) => { const r = applyDraft(draft, form, editable); setForm(r.next); setAi({ changed: r.changed, mode: res.mode, rationale: res.rationale }); }} />
                  </div>
                )}
                {ai && (
                  <div className="rounded-lg bg-piku-soft/60 px-3 py-2 text-[12.5px] text-ink-soft">
                    <div className="mb-1 flex items-center gap-2"><Sparkles size={13} className="text-piku" /><AiLabel mode={ai.mode} /><span className="text-[11.5px]">{ai.changed.size} field{ai.changed.size === 1 ? '' : 's'} changed, outlined below. Not saved yet.</span></div>
                    {ai.rationale}
                    <button className="ml-2 text-[12px] underline" onClick={() => { setForm(base); setAi(null); }}>Undo suggestion</button>
                  </div>
                )}
                <TaskFields form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} editable={editable} users={users} aiChanged={ai?.changed} />
                <AiActions scope="task" id={t.task_id} />
              </div>
            )}

            {tab === 'comms' && <CommList comms={data.communications} expanded />}

            {tab === 'notes' && (
              <div className="space-y-3">
                {can('notes.add') && (
                  <div>
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note about this task" aria-label="New note" />
                    <div className="mt-1.5 flex justify-end"><Button size="sm" variant="primary" onClick={addNote} disabled={!note.trim()}>Add note</Button></div>
                  </div>
                )}
                {data.notes.map((n) => (
                  <div key={n.note_id} className="rounded-md bg-canvas px-3 py-2 text-[12.5px]">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-[11px] text-ink-muted">{n.author_name ?? 'Someone'}, {relative(n.created_at)}</p>
                  </div>
                ))}
                {!data.notes.length && <p className="text-[12.5px] text-ink-muted">No notes on this task yet.</p>}
              </div>
            )}

            {tab === 'history' && (
              <ol className="relative ml-2 border-l border-line">
                {data.history.map((h) => (
                  <li key={h.audit_id} className="mb-3 ml-4">
                    <span className={clsx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface', h.ai_generated === 'Y' ? 'bg-piku' : 'bg-ink-muted')} />
                    <p className="text-[12.5px]"><span className="font-medium">{users.find((u) => u.user_id === h.actor_user_id)?.full_name ?? h.persona_code ?? 'System'}</span> {humanAction(h.action)}</p>
                    <p className="text-[11px] text-ink-muted">{dateTime(h.created_at)}</p>
                    {h.details && <HistoryDetails raw={h.details} />}
                  </li>
                ))}
                {!data.history.length && <li className="ml-4 text-[12.5px] text-ink-muted">No changes recorded yet.</li>}
              </ol>
            )}
          </>
        )}
      </SidePanel>
      <ConfirmDialog open={confirm} title="Delete this task?" body="It is removed from the activity. The change is kept in the audit log." onConfirm={remove} onCancel={() => setConfirm(false)} busy={deleting} />
    </>
  );
}

function HistoryDetails({ raw }: { raw: string }) {
  let text = raw;
  try {
    const d = JSON.parse(raw);
    const fields = d?.changes ?? d?.patch ?? d;
    if (fields && typeof fields === 'object') text = Object.entries(fields).slice(0, 6).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ');
  } catch { /* plain text */ }
  return <p className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-soft">{text}</p>;
}

/** Add task panel (with AI suggestion of tasks for the activity). */
export function AddTaskPanel({ open, onClose, activity, onSaved }: { open: boolean; onClose: () => void; activity: Activity; onSaved: () => void }) {
  const toast = useToast();
  const users = useUsers();
  const blank: Form = { title: '', description: '', assignee_user_id: '', status: 'Not Started', priority: 'Medium', due_date: '', start_date: '', percent_complete: '0', effort_hours: '', day1_critical: 'N', dependency_notes: '', done_notes: '', pending_notes: '' };
  const [form, setForm] = useState<Form>(blank);
  const [saving, setSaving] = useState(false);
  const [ideas, setIdeas] = useState<{ title: string; priority?: string; day1_critical?: string; description?: string; pick: boolean }[]>([]);
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => { if (open) { setForm(blank); setIdeas([]); setMode(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  async function save() {
    const picked = ideas.filter((i) => i.pick);
    if (!form.title?.trim() && !picked.length) { toast.error('Enter a task title or pick suggested tasks.'); return; }
    setSaving(true);
    try {
      if (form.title?.trim()) {
        const body = diffPayload(form, {}, () => true);
        await post(`/activities/${activity.activity_id}/tasks`, { ...body, status: form.status || 'Not Started' });
      }
      if (picked.length) {
        await post(`/activities/${activity.activity_id}/tasks/bulk`, { tasks: picked.map(({ title, priority, day1_critical, description }) => ({ title, priority, description, day1_critical: day1_critical === 'Y' ? 'Y' : 'N', status: 'Not Started' })), fromAi: true });
      }
      toast.success(picked.length ? `${picked.length + (form.title?.trim() ? 1 : 0)} tasks added` : 'Task added');
      onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  return (
    <SidePanel open={open} onClose={onClose} width="lg" title="Add task" subtitle={`To activity: ${activity.name}`} onSave={save} saving={saving} saveLabel="Add tasks">
      <AiStrip text="Get a list of tasks this activity usually needs, from approved learnings. Tick the ones to add."><AiSuggestButton label="Suggest tasks" request={{ kind: 'tasks', projectId: activity.project_id, stageId: activity.stage_id, activityId: activity.activity_id }}
        onApply={(draft, res) => { const list = Array.isArray(draft) ? draft : ((draft as Record<string, unknown>).tasks as Record<string, unknown>[] ?? []);
          setIdeas(list.map((d) => ({ title: String(d.title ?? d.name ?? ''), priority: d.priority ? String(d.priority) : undefined, description: d.description ? String(d.description) : undefined, day1_critical: d.day1_critical === 'Y' || d.day1_critical === true ? 'Y' : 'N', pick: true })).filter((i) => i.title));
          setMode(res.mode); }} /></AiStrip>
      {ideas.length > 0 && (
        <div className="mb-5 rounded-lg border border-piku/25 bg-piku-soft/40 p-3">
          <div className="mb-2 flex items-center gap-2"><span className="text-[13px] font-semibold">Suggested tasks</span>{mode && <AiLabel mode={mode} />}</div>
          <ul className="space-y-1">
            {ideas.map((i, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[#D04A02]" checked={i.pick} onChange={(e) => setIdeas((s) => s.map((x, j) => (j === idx ? { ...x, pick: e.target.checked } : x)))} aria-label="Include task" />
                <input className="input py-1" value={i.title} onChange={(e) => setIdeas((s) => s.map((x, j) => (j === idx ? { ...x, title: e.target.value } : x)))} aria-label="Task title" />
                {i.day1_critical === 'Y' && <Pill tone="bg-rose-soft text-rose">Day-1</Pill>}
                {i.priority && <Pill>{i.priority}</Pill>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-ink-muted">Ticked tasks are added together with the task below (if it has a title).</p>
        </div>
      )}
      <TaskFields form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} editable={() => true} users={users} />
    </SidePanel>
  );
}
