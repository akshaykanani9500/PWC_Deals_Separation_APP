/** New project side panel with optional AI-suggested plan (stages > activities > tasks). */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { ProjectDetail, SuggestResponse } from '@shared/types';
import { DEAL_TYPES, INDUSTRIES, SENSITIVITY } from '@shared/schema';
import { DEFAULT_STAGES } from '@shared/defaults';
import { post } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useUsers } from '../../hooks/useUsers';
import { SidePanel } from '../../components/SidePanel';
import { Checkbox, Field, Input, Select, Textarea, AiLabel } from '../../components/ui';
import { useToast } from '../../components/toast';
import AiSuggestButton from '../../features/ai/AiSuggestButton';
import { StageList, stagesPayload, toPlanStages, planCounts, type PlanStage } from '../../components/PlanTree';

const blank = () => ({
  code_name: '', client_alias: '', deal_type: 'Sell-side carve-out', industry: 'Financial Services & Payments', description: '',
  start_date: '', target_close_date: '', partner_user_id: '', manager_user_id: '', sensitivity: 'Confidential',
  data_residency: 'India', clean_team_required: 'N', currency: 'USD',
});

export default function NewProjectPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { session } = useSession();
  const users = useUsers();
  const [f, setF] = useState(blank);
  const [plan, setPlan] = useState<PlanStage[] | null>(null);
  const [aiMeta, setAiMeta] = useState<{ mode: string; rationale: string; sources: { id: string; label: string }[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setF(() => {
      const b = blank();
      if (session?.persona.code === 'PARTNER') b.partner_user_id = session.user.user_id;
      if (session?.persona.code === 'MANAGER') b.manager_user_id = session.user.user_id;
      return b;
    });
    setPlan(null); setAiMeta(null);
  }, [open, session]);

  const partners = users.filter((u) => u.persona_code === 'PARTNER');
  const managers = users.filter((u) => u.persona_code === 'MANAGER');

  function applySuggestion(draft: SuggestResponse['draft'], res: SuggestResponse) {
    const d = (Array.isArray(draft) ? { stages: draft } : draft) as Record<string, unknown>;
    const stages = toPlanStages(d.stages);
    if (stages.length) setPlan(stages);
    setF((s) => ({
      ...s,
      description: s.description || (typeof d.description === 'string' ? d.description : s.description),
      // the server returns the project name as `name` (older drafts used `code_name`)
      code_name: s.code_name || (typeof d.name === 'string' ? d.name : typeof d.code_name === 'string' ? d.code_name : s.code_name),
    }));
    setAiMeta({ mode: res.mode, rationale: res.rationale, sources: res.sources });
  }

  async function save() {
    if (!f.code_name.trim()) { toast.error('Give the project a code name.'); return; }
    if (f.start_date && f.target_close_date && f.target_close_date < f.start_date) { toast.error('Target close must be after the start date.'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), status: 'Planning',
      };
      if (plan) { body.stages = stagesPayload(plan); if (aiMeta) body.fromAi = true; }
      const members: { user_id: string; member_role: string }[] = [];
      if (f.partner_user_id) members.push({ user_id: f.partner_user_id, member_role: 'Partner' });
      if (f.manager_user_id) members.push({ user_id: f.manager_user_id, member_role: 'Manager' });
      if (members.length) body.members = members;
      const res = await post<ProjectDetail>('/projects', body);
      toast.success(`Project ${res.project.code_name} created`);
      onClose();
      nav(`/projects/${res.project.project_id}`);
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  const counts = plan ? planCounts(plan) : null;

  return (
    <SidePanel open={open} onClose={onClose} width="lg" title="New project" subtitle="Set up the engagement. Start from an AI-suggested plan or the standard five stages."
      onSave={save} saving={saving} saveLabel="Create project">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code name" className="col-span-2"><Input value={f.code_name} onChange={(e) => set('code_name', e.target.value)} placeholder="e.g. Project Atlas" autoFocus /></Field>
        <Field label="Client (described, no real name)" className="col-span-2"><Input value={f.client_alias} onChange={(e) => set('client_alias', e.target.value)} placeholder="e.g. Global payments firm divesting its card unit" /></Field>
        <Field label="Deal type"><Select value={f.deal_type} onChange={(e) => set('deal_type', e.target.value)}>{DEAL_TYPES.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Industry"><Select value={f.industry} onChange={(e) => set('industry', e.target.value)}>{INDUSTRIES.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Description" className="col-span-2"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Scope, scale (apps, sites, people) and what decides success" /></Field>
        <Field label="Start date"><Input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label="Target close"><Input type="date" value={f.target_close_date} onChange={(e) => set('target_close_date', e.target.value)} /></Field>
        <Field label="Engagement partner">
          <Select value={f.partner_user_id} onChange={(e) => set('partner_user_id', e.target.value)}>
            <option value="">Not assigned</option>{partners.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Engagement manager">
          <Select value={f.manager_user_id} onChange={(e) => set('manager_user_id', e.target.value)}>
            <option value="">Not assigned</option>{managers.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Sensitivity"><Select value={f.sensitivity} onChange={(e) => set('sensitivity', e.target.value)}>{SENSITIVITY.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Data residency"><Input value={f.data_residency} onChange={(e) => set('data_residency', e.target.value)} placeholder="India, EU, US" /></Field>
        <div className="col-span-2"><Checkbox checked={f.clean_team_required === 'Y'} onChange={(v) => set('clean_team_required', v ? 'Y' : 'N')} label="Clean team required before close (competitively sensitive data)" /></div>
      </div>

      <div className="mt-6 rounded-xl border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[13.5px] font-semibold">Project plan</h3>
            <p className="text-[12px] text-ink-muted">
              {plan && counts ? `${counts.stages} stages, ${counts.activities} activities, ${counts.tasks} tasks selected. Edit or untick anything before creating.`
                : 'Without a suggestion, the standard five stages are created.'}
            </p>
          </div>
        </div>
        <div className="border-b border-line px-4 py-3">
          <AiSuggestButton
            label={plan ? 'Suggest again' : 'Suggest a plan from past deals'}
            request={{ kind: 'project', hints: { deal_type: f.deal_type, industry: f.industry, name: f.code_name, description: f.description }, current: { ...f } /* every typed field; the server merges them (typed values win) */ }}
            onApply={applySuggestion}
          />
        </div>
        <div className="px-3 py-2">
          {plan ? (
            <>
              {aiMeta && (
                <div className="mb-2 rounded-lg bg-piku-soft/60 px-3 py-2 text-[12.5px] text-ink-soft">
                  <div className="mb-1 flex items-center gap-2"><Sparkles size={13} className="text-piku" /><AiLabel mode={aiMeta.mode} /></div>
                  {aiMeta.rationale}
                  {aiMeta.sources?.length > 0 && <div className="mt-1 text-[11.5px] text-ink-muted">Based on: {aiMeta.sources.slice(0, 3).map((s) => s.label).join('; ')}{aiMeta.sources.length > 3 ? ` and ${aiMeta.sources.length - 3} more` : ''}</div>}
                </div>
              )}
              <StageList stages={plan} onChange={setPlan} />
              <button className="mt-2 text-[12px] text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => { setPlan(null); setAiMeta(null); }}>Discard suggestion and use the standard stages</button>
            </>
          ) : (
            <ol className="space-y-1 px-1 py-1">
              {DEFAULT_STAGES.map((s) => (
                <li key={s.name} className="text-[13px]"><span className="font-medium">{s.name}</span><span className="text-ink-muted">: {s.description}</span></li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </SidePanel>
  );
}
