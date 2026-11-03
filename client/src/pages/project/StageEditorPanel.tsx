/** Stage editor: add, rename, describe, reorder, remove stages, plus AI-suggested stages. */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, Trash2, ChevronRight, Sparkles } from 'lucide-react';
import type { ProjectDetail, Stage, SuggestResponse } from '@shared/types';
import { api, post, patch, del } from '../../lib/api';
import { useUsers } from '../../hooks/useUsers';
import { SidePanel, ConfirmDialog } from '../../components/SidePanel';
import { AiLabel, AiStrip, Button, Field, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import AiSuggestButton from '../../features/ai/AiSuggestButton';
import { activitiesPayload, toPlanStages, type PlanStage } from '../../components/PlanTree';

interface Row {
  key: string;
  stage_id?: string;
  name: string; description: string; gate_criteria: string; owner_user_id: string;
  original?: { name: string; description: string; gate_criteria: string; owner_user_id: string };
  activities?: PlanStage['activities'];
  fromAi?: boolean;
}
let seq = 0;

export function StageEditorPanel({ open, detail, onClose, onSaved }: { open: boolean; detail: ProjectDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const users = useUsers();
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<Row[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [ideas, setIdeas] = useState<(PlanStage & { pick: boolean })[]>([]);
  const [aiMeta, setAiMeta] = useState<{ mode: string; rationale: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const sorted = [...detail.stages].sort((a, b) => a.sort_order - b.sort_order);
    setRows(sorted.map((s) => {
      const v = { name: s.name, description: s.description ?? '', gate_criteria: s.gate_criteria ?? '', owner_user_id: s.owner_user_id ?? '' };
      return { key: s.stage_id, stage_id: s.stage_id, ...v, original: v };
    }));
    setRemoved([]); setIdeas([]); setAiMeta(null); setOpenKey(null);
  }, [open, detail.stages]);

  const set = (key: string, patchRow: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patchRow } : x)));
  const move = (i: number, d: -1 | 1) => setRows((r) => { const c = [...r]; const j = i + d; if (j < 0 || j >= c.length) return r; [c[i], c[j]] = [c[j], c[i]]; return c; });

  function addBlank() {
    const key = `new${++seq}`;
    setRows((r) => [...r, { key, name: 'New stage', description: '', gate_criteria: '', owner_user_id: '' }]);
    setOpenKey(key);
  }

  function applySuggestion(draft: SuggestResponse['draft'], res: SuggestResponse) {
    const list = Array.isArray(draft) ? draft : ((draft as Record<string, unknown>).stages ?? []);
    const existing = new Set(rows.map((r) => r.name.trim().toLowerCase()));
    setIdeas(toPlanStages(list).map((s) => ({ ...s, pick: !existing.has(s.name.trim().toLowerCase()) })));
    setAiMeta({ mode: res.mode, rationale: res.rationale });
  }

  function addIdeas() {
    const picked = ideas.filter((i) => i.pick);
    setRows((r) => [...r, ...picked.map((s) => ({
      key: `new${++seq}`, name: s.name, description: s.description ?? '', gate_criteria: s.gate_criteria ?? '', owner_user_id: '', activities: s.activities, fromAi: true,
    }))]);
    setIdeas([]);
    toast.info(`${picked.length} stage${picked.length === 1 ? '' : 's'} added to the list. Save to create them.`);
  }

  async function save() {
    if (rows.some((r) => !r.name.trim())) { toast.error('Every stage needs a name.'); return; }
    setSaving(true);
    try {
      for (const r of removed) if (r.stage_id) await del(`/stages/${r.stage_id}`);
      for (const r of rows) {
        if (!r.stage_id || !r.original) continue;
        const ch: Record<string, unknown> = {};
        (['name', 'description', 'gate_criteria', 'owner_user_id'] as const).forEach((k) => { if (r[k] !== r.original![k]) ch[k] = r[k] === '' ? null : r[k]; });
        if (Object.keys(ch).length) await patch(`/stages/${r.stage_id}`, ch);
      }
      const fresh = rows.filter((r) => !r.stage_id);
      let created: Stage[] = [];
      if (fresh.length) {
        created = await post<Stage[]>(`/projects/${detail.project.project_id}/stages/bulk`, {
          stages: fresh.map((r) => ({ name: r.name.trim(), description: r.description || undefined, gate_criteria: r.gate_criteria || undefined,
            owner_user_id: r.owner_user_id || undefined, activities: r.activities ? activitiesPayload(r.activities) : [] })),
          fromAi: fresh.some((r) => r.fromAi),
        });
      }
      let ci = 0;
      const ids = rows.map((r) => r.stage_id ?? created[ci++]?.stage_id).filter(Boolean) as string[];
      const before = [...detail.stages].sort((a, b) => a.sort_order - b.sort_order).map((s) => s.stage_id).filter((id) => !removed.some((r) => r.stage_id === id));
      if (ids.join() !== [...before, ...created.map((c) => c.stage_id)].join() || removed.length) {
        await api(`/projects/${detail.project.project_id}/stages/reorder`, { method: 'POST', body: { stageIds: ids } });
      }
      toast.success('Stages saved');
      onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  return (
    <>
      <SidePanel open={open} onClose={onClose} width="lg" title="Edit stages" subtitle="Stages appear as tabs on the project. Changes are saved together."
        onSave={save} saving={saving}>
        <AiStrip text="Ask AI which stages fit this deal type and industry, based on approved learnings from closed projects."><AiSuggestButton label="Suggest stages" request={{ kind: 'stages', projectId: detail.project.project_id, current: { stages: rows.map((r) => ({ name: r.name, description: r.description, gate_criteria: r.gate_criteria })) } }} onApply={applySuggestion} applyToast="Suggested stages listed — add the ones you want, then press Save" /></AiStrip>
        {ideas.length > 0 && (
          <div className="mb-4 rounded-lg border border-piku/25 bg-piku-soft/40 p-3">
            <div className="mb-1 flex items-center gap-2"><Sparkles size={13} className="text-piku" /><span className="text-[13px] font-semibold">Suggested stages</span>{aiMeta && <AiLabel mode={aiMeta.mode} />}</div>
            {aiMeta?.rationale && <p className="mb-2 text-[12.5px] text-ink-soft">{aiMeta.rationale}</p>}
            <ul className="space-y-1.5">
              {ideas.map((s, i) => (
                <li key={s.key} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 h-3.5 w-3.5 accent-[#B83F04]" checked={s.pick} onChange={(e) => setIdeas((x) => x.map((y, j) => (j === i ? { ...y, pick: e.target.checked } : y)))} aria-label={`Add ${s.name}`} />
                  <div className="text-[12.5px]"><span className="font-medium">{s.name}</span>{s.activities.length > 0 && <span className="text-ink-muted"> with {s.activities.length} activities</span>}{s.description && <div className="text-ink-muted">{s.description}</div>}</div>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" onClick={addIdeas} disabled={!ideas.some((i) => i.pick)}>Add selected to the list</Button><Button size="sm" variant="ghost" onClick={() => setIdeas([])}>Dismiss</Button></div>
          </div>
        )}

        <ol className="space-y-2">
          {rows.map((r, i) => {
            const isOpen = openKey === r.key;
            return (
              <li key={r.key} className={clsx('rounded-lg border bg-surface', r.stage_id ? 'border-line' : 'border-brand-ring')}>
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <span className="num w-6 text-center text-[12px] text-ink-muted">{i + 1}</span>
                  <input className="input flex-1 py-1 font-medium" value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} aria-label="Stage name" />
                  {!r.stage_id && <span className="rounded bg-brand-soft px-1.5 text-[11px] font-medium text-brand-dark">{r.fromAi ? 'New, AI' : 'New'}</span>}
                  <button className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
                  <button className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
                  <button className="rounded p-1 text-ink-muted hover:bg-sunken hover:text-ink" onClick={() => setOpenKey(isOpen ? null : r.key)} aria-label="Details" aria-expanded={isOpen}><ChevronRight size={14} className={clsx('transition-transform', isOpen && 'rotate-90')} /></button>
                  <button className="rounded p-1 text-ink-muted hover:bg-rose-soft hover:text-rose" onClick={() => (r.stage_id ? setConfirm(r) : setRows((x) => x.filter((y) => y.key !== r.key)))} aria-label="Remove stage"><Trash2 size={14} /></button>
                </div>
                {isOpen && (
                  <div className="grid grid-cols-2 gap-3 border-t border-line px-3 py-3">
                    <Field label="Description" className="col-span-2"><Textarea value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} /></Field>
                    <Field label="Gate criteria (what must be true to move on)" className="col-span-2"><Textarea value={r.gate_criteria} onChange={(e) => set(r.key, { gate_criteria: e.target.value })} /></Field>
                    <Field label="Stage owner">
                      <Select value={r.owner_user_id} onChange={(e) => set(r.key, { owner_user_id: e.target.value })}>
                        <option value="">No owner</option>{users.filter((u) => ['PARTNER', 'MANAGER', 'LEAD'].includes(u.persona_code)).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
                      </Select>
                    </Field>
                    {r.activities && r.activities.length > 0 && <p className="self-end text-[12px] text-ink-muted">{r.activities.length} suggested activities will be created with this stage.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <Button className="mt-3" icon={<Plus size={14} />} onClick={addBlank}>Add stage</Button>
        {removed.length > 0 && <p className="mt-3 text-[12px] text-rose">{removed.length} stage{removed.length === 1 ? '' : 's'} will be removed on save: {removed.map((r) => r.name).join(', ')}.</p>}
      </SidePanel>
      <ConfirmDialog open={!!confirm} title={`Remove ${confirm?.name}?`} confirmLabel="Remove"
        body="Its activities and tasks are removed too when you save. Everything stays in the audit history."
        onCancel={() => setConfirm(null)}
        onConfirm={() => { if (confirm) { setRemoved((x) => [...x, confirm]); setRows((x) => x.filter((y) => y.key !== confirm.key)); } setConfirm(null); }} />
    </>
  );
}

