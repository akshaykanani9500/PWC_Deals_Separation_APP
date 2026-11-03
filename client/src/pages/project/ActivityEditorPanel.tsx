/** Activity editor for one stage: add, edit, reorder, remove activities, plus AI-suggested activities (with tasks). */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, Trash2, ChevronRight, Sparkles } from 'lucide-react';
import type { Activity, StageDetail, SuggestResponse } from '@shared/types';
import { PRIORITY } from '@shared/schema';
import { api, post, patch, del } from '../../lib/api';
import { useTeam } from '../../hooks/useTeam';
import { SidePanel, ConfirmDialog } from '../../components/SidePanel';
import { AiLabel, AiStrip, Button, Field, Input, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import AiSuggestButton from '../../features/ai/AiSuggestButton';
import { ActivityList, tasksPayload, toPlanActivities, type PlanActivity } from '../../components/PlanTree';

type Fields = { name: string; description: string; owner_user_id: string; priority: string; due_date: string };
interface Row extends Fields { key: string; activity_id?: string; original?: Fields; tasks?: PlanActivity['tasks']; fromAi?: boolean; canEdit: boolean; canDelete: boolean }
let seq = 0;

export function ActivityEditorPanel({ open, onClose, stageDetail, projectId, onSaved }: {
  open: boolean; onClose: () => void; stageDetail: StageDetail; projectId: string; onSaved: () => void;
}) {
  const toast = useToast();
  const users = useTeam(projectId);
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<Row[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [ideas, setIdeas] = useState<PlanActivity[] | null>(null);
  const [aiMeta, setAiMeta] = useState<{ mode: string; rationale: string; sources: { label: string }[] } | null>(null);
  const stage = stageDetail.stage;

  useEffect(() => {
    if (!open) return;
    setRows([...stageDetail.activities].sort((a, b) => a.sort_order - b.sort_order).map((a) => {
      const v: Fields = { name: a.name, description: a.description ?? '', owner_user_id: a.owner_user_id ?? '', priority: a.priority ?? '', due_date: a.due_date ?? '' };
      return { key: a.activity_id, activity_id: a.activity_id, ...v, original: v, canEdit: a.perms.canEdit, canDelete: a.perms.canDelete };
    }));
    setRemoved([]); setIdeas(null); setAiMeta(null); setOpenKey(null);
  }, [open, stageDetail]);

  const set = (key: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => setRows((r) => { const c = [...r]; const j = i + d; if (j < 0 || j >= c.length) return r; [c[i], c[j]] = [c[j], c[i]]; return c; });

  function applySuggestion(draft: SuggestResponse['draft'], res: SuggestResponse) {
    const list = Array.isArray(draft) ? draft : ((draft as Record<string, unknown>).activities ?? []);
    const existing = new Set(rows.map((r) => r.name.trim().toLowerCase()));
    setIdeas(toPlanActivities(list).map((a) => ({ ...a, include: !existing.has(a.name.trim().toLowerCase()) })));
    setAiMeta({ mode: res.mode, rationale: res.rationale, sources: res.sources });
  }
  function addIdeas() {
    const picked = (ideas ?? []).filter((i) => i.include && i.name.trim());
    setRows((r) => [...r, ...picked.map((a) => ({ key: `new${++seq}`, name: a.name, description: a.description ?? '', owner_user_id: '', priority: a.priority ?? 'Medium', due_date: '', tasks: a.tasks, fromAi: true, canEdit: true, canDelete: true }))]);
    setIdeas(null);
    toast.info(`${picked.length} activit${picked.length === 1 ? 'y' : 'ies'} added to the list. Save to create them.`);
  }

  async function save() {
    if (rows.some((r) => !r.name.trim())) { toast.error('Every activity needs a name.'); return; }
    setSaving(true);
    try {
      for (const r of removed) if (r.activity_id) await del(`/activities/${r.activity_id}`);
      for (const r of rows) {
        if (!r.activity_id || !r.original || !r.canEdit) continue;
        const ch: Record<string, unknown> = {};
        (['name', 'description', 'owner_user_id', 'priority', 'due_date'] as const).forEach((k) => { if (r[k] !== r.original![k]) ch[k] = r[k] === '' ? null : r[k]; });
        if (Object.keys(ch).length) await patch(`/activities/${r.activity_id}`, ch);
      }
      const fresh = rows.filter((r) => !r.activity_id);
      let created: Activity[] = [];
      if (fresh.length) {
        created = await post<Activity[]>(`/stages/${stage.stage_id}/activities/bulk`, {
          activities: fresh.map((r) => ({ name: r.name.trim(), description: r.description || undefined, owner_user_id: r.owner_user_id || undefined,
            priority: r.priority || undefined, due_date: r.due_date || undefined, tasks: r.tasks ? tasksPayload(r.tasks) : [] })),
          fromAi: fresh.some((r) => r.fromAi),
        });
      }
      let ci = 0;
      const ids = rows.map((r) => r.activity_id ?? created[ci++]?.activity_id).filter(Boolean) as string[];
      const before = [...stageDetail.activities].sort((a, b) => a.sort_order - b.sort_order).map((a) => a.activity_id).filter((id) => !removed.some((r) => r.activity_id === id));
      if (ids.join() !== [...before, ...created.map((c) => c.activity_id)].join()) {
        await api(`/stages/${stage.stage_id}/activities/reorder`, { method: 'POST', body: { activityIds: ids } });
      }
      toast.success('Activities saved');
      onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  return (
    <>
      <SidePanel open={open} onClose={onClose} width="lg" title="Edit activities" subtitle={`Stage: ${stage.name}. Activities appear as sub-tabs. Changes are saved together.`}
        onSave={save} saving={saving}>
        <AiStrip text="Get activities (with their tasks) that similar past deals needed in this stage. You choose what to add."><AiSuggestButton label="Suggest activities" request={{ kind: 'activities', projectId, stageId: stage.stage_id, current: { stage_name: stage.name, activities: rows.map((r) => ({ name: r.name, description: r.description, priority: r.priority })) } }} onApply={applySuggestion} applyToast="Suggested activities listed — add the ones you want, then press Save" /></AiStrip>
        {ideas && (
          <div className="mb-4 rounded-lg border border-piku/25 bg-piku-soft/40 p-3">
            <div className="mb-1 flex items-center gap-2"><Sparkles size={13} className="text-piku" /><span className="text-[13px] font-semibold">Suggested activities</span>{aiMeta && <AiLabel mode={aiMeta.mode} />}</div>
            {aiMeta?.rationale && <p className="mb-1 text-[12.5px] text-ink-soft">{aiMeta.rationale}</p>}
            {aiMeta?.sources?.length ? <p className="mb-2 text-[11.5px] text-ink-muted">Based on: {aiMeta.sources.slice(0, 3).map((s) => s.label).join('; ')}{aiMeta.sources.length > 3 ? ` and ${aiMeta.sources.length - 3} more` : ''}</p> : null}
            {ideas.length ? <ActivityList activities={ideas} onChange={setIdeas} /> : <p className="text-[12.5px] text-ink-muted">No new activities to suggest for this stage.</p>}
            <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" onClick={addIdeas} disabled={!ideas.some((i) => i.include)}>Add selected to the list</Button><Button size="sm" variant="ghost" onClick={() => setIdeas(null)}>Dismiss</Button></div>
          </div>
        )}

        <ol className="space-y-2">
          {rows.map((r, i) => {
            const isOpen = openKey === r.key;
            const locked = !r.canEdit;
            return (
              <li key={r.key} className={clsx('rounded-lg border bg-surface', r.activity_id ? 'border-line' : 'border-brand-ring')}>
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <span className="num w-6 text-center text-[12px] text-ink-muted">{i + 1}</span>
                  <input className="input flex-1 py-1 font-medium" value={r.name} disabled={locked} onChange={(e) => set(r.key, { name: e.target.value })} aria-label="Activity name"
                    title={locked ? 'You cannot edit this activity (it is outside your workstream)' : undefined} />
                  {!r.activity_id && <span className="rounded bg-brand-soft px-1.5 text-[11px] font-medium text-brand-dark">{r.fromAi ? `New, AI${r.tasks?.length ? `, ${r.tasks.length} tasks` : ''}` : 'New'}</span>}
                  <button className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
                  <button className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
                  <button className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink" onClick={() => setOpenKey(isOpen ? null : r.key)} aria-label="Details" aria-expanded={isOpen}><ChevronRight size={14} className={clsx('transition-transform', isOpen && 'rotate-90')} /></button>
                  <button className="rounded p-1 text-ink-muted hover:bg-rose-soft hover:text-rose disabled:opacity-30" disabled={!r.canDelete}
                    onClick={() => (r.activity_id ? setConfirm(r) : setRows((x) => x.filter((y) => y.key !== r.key)))} aria-label="Remove activity"><Trash2 size={14} /></button>
                </div>
                {isOpen && (
                  <div className="grid grid-cols-3 gap-3 border-t border-line px-3 py-3">
                    <Field label="Description" className="col-span-3"><Textarea value={r.description} disabled={locked} onChange={(e) => set(r.key, { description: e.target.value })} /></Field>
                    <Field label="Owner">
                      <Select value={r.owner_user_id} disabled={locked} onChange={(e) => set(r.key, { owner_user_id: e.target.value })}>
                        <option value="">No owner</option>{users.filter((u) => ['PARTNER', 'MANAGER', 'LEAD', 'ANALYST', 'EXEC'].includes(u.persona_code)).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Priority"><Select value={r.priority} disabled={locked} onChange={(e) => set(r.key, { priority: e.target.value })}><option value="">Not set</option>{PRIORITY.map((p) => <option key={p}>{p}</option>)}</Select></Field>
                    <Field label="Due date"><Input type="date" value={r.due_date} disabled={locked} onChange={(e) => set(r.key, { due_date: e.target.value })} /></Field>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <Button className="mt-3" icon={<Plus size={14} />} onClick={() => { const key = `new${++seq}`; setRows((r) => [...r, { key, name: 'New activity', description: '', owner_user_id: '', priority: 'Medium', due_date: '', canEdit: true, canDelete: true }]); setOpenKey(key); }}>Add activity</Button>
        {removed.length > 0 && <p className="mt-3 text-[12px] text-rose">Will be removed on save: {removed.map((r) => r.name).join(', ')}.</p>}
      </SidePanel>
      <ConfirmDialog open={!!confirm} title={`Remove ${confirm?.name}?`} confirmLabel="Remove" body="Its tasks are removed too when you save. The change is kept in the audit history."
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (confirm) { setRemoved((x) => [...x, confirm]); setRows((x) => x.filter((y) => y.key !== confirm.key)); } setConfirm(null); }} />
    </>
  );
}
