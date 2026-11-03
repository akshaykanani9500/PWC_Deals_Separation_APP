/** Project-level side panels: edit project, team. (Finance has its own full-screen workspace: pages/finance.) */
import { useEffect, useMemo, useState } from 'react';
import { Trash2, UserPlus, Sparkles, KeyRound, ShieldCheck, UserCog } from 'lucide-react';
import { ACCESS_CHANGED_EVENT } from '../../features/access/useAccessSummary';
import type { PersonaCode, ProjectDetail, SuggestResponse } from '@shared/types';
import { GRANTABLE, level1Check } from '@shared/access';
import { DEAL_TYPES, INDUSTRIES, PROJECT_STATUS, SENSITIVITY, MEMBER_ROLES, RAG } from '@shared/schema';
import { patch, post, del } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useUsers, PERSONA_LABEL } from '../../hooks/useUsers';
import { useSession } from '../../lib/session';
import { SidePanel, ConfirmDialog } from '../../components/SidePanel';
import { AiLabel, AiStrip, Avatar, Button, Checkbox, Field, Input, Pill, Select, Skeleton, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import { date, money } from '../../lib/format';
import AiSuggestButton from '../../features/ai/AiSuggestButton';

const TEXT_FIELDS = ['code_name', 'client_alias', 'deal_type', 'industry', 'description', 'status', 'rag', 'start_date', 'target_close_date',
  'partner_user_id', 'manager_user_id', 'sensitivity', 'data_residency', 'clean_team_required', 'currency', 'tags'] as const;
const NUM_FIELDS = ['apps_in_scope', 'sites_in_scope', 'employees_conveying'] as const;
const FIN_FIELDS = ['fee_budget', 'fee_billed', 'tsa_monthly_cost', 'one_time_cost', 'funding_gap'] as const;
type Key = (typeof TEXT_FIELDS)[number] | (typeof NUM_FIELDS)[number] | (typeof FIN_FIELDS)[number];

export function EditProjectPanel({ open, detail, onClose, onSaved }: { open: boolean; detail: ProjectDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const users = useUsers();
  const p = detail.project as unknown as Record<string, unknown>;
  const finEditable = (detail.perms.canEditFinance ?? can('finance.edit')) && detail.perms.canViewFinance;
  const base = useMemo(() => {
    const f: Record<string, string> = {};
    [...TEXT_FIELDS, ...NUM_FIELDS, ...FIN_FIELDS].forEach((k) => { f[k] = p[k] == null ? '' : String(p[k]); });
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  const [f, setF] = useState(base);
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState<{ mode: string; rationale: string } | null>(null);
  useEffect(() => { if (open) { setF(base); setAi(null); } }, [open, base]);
  const set = (k: Key, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    if (!f.code_name.trim()) { toast.error('The project needs a code name.'); return; }
    const body: Record<string, unknown> = {};
    for (const k of TEXT_FIELDS) if (f[k] !== base[k]) body[k] = f[k] === '' ? null : f[k];
    for (const k of NUM_FIELDS) if (f[k] !== base[k]) body[k] = f[k] === '' ? null : Number(f[k]);
    if (finEditable) for (const k of FIN_FIELDS) if (f[k] !== base[k]) body[k] = f[k] === '' ? null : Number(f[k]);
    if (!Object.keys(body).length) { onClose(); return; }
    setSaving(true);
    try { await patch(`/projects/${detail.project.project_id}`, body); toast.success('Project saved'); onSaved(); onClose(); }
    catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  function apply(draft: SuggestResponse['draft'], res: SuggestResponse) {
    const d = (Array.isArray(draft) ? draft[0] ?? {} : draft) as Record<string, unknown>;
    setF((s) => {
      const n = { ...s };
      for (const k of [...TEXT_FIELDS, ...NUM_FIELDS]) if (d[k] != null && k !== 'partner_user_id' && k !== 'manager_user_id') n[k] = String(d[k]);
      return n;
    });
    setAi({ mode: res.mode, rationale: res.rationale });
  }

  const partners = users.filter((u) => u.persona_code === 'PARTNER');
  const managers = users.filter((u) => u.persona_code === 'MANAGER');

  return (
    <SidePanel open={open} onClose={onClose} width="lg" title="Edit project" subtitle={detail.project.project_id} onSave={save} saving={saving}>
      <AiStrip text="AI can tidy the description and fill missing scope fields from the project's records. Review before saving."><AiSuggestButton label="Improve with AI" request={{ kind: 'project', projectId: detail.project.project_id, current: f, hints: { deal_type: f.deal_type, industry: f.industry, name: f.code_name, description: f.description } }} onApply={apply} /></AiStrip>
      {ai && <div className="mb-3 rounded-lg bg-piku-soft/60 px-3 py-2 text-[12.5px] text-ink-soft"><div className="mb-1 flex items-center gap-2"><Sparkles size={13} className="text-piku" /><AiLabel mode={ai.mode} /> <span>Review the changes, then save.</span></div>{ai.rationale}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code name"><Input value={f.code_name} onChange={(e) => set('code_name', e.target.value)} /></Field>
        <Field label="Client (described)"><Input value={f.client_alias} onChange={(e) => set('client_alias', e.target.value)} /></Field>
        <Field label="Deal type"><Select value={f.deal_type} onChange={(e) => set('deal_type', e.target.value)}><option value="">Not set</option>{DEAL_TYPES.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Industry"><Select value={f.industry} onChange={(e) => set('industry', e.target.value)}><option value="">Not set</option>{INDUSTRIES.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Description" className="col-span-2"><Textarea value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{PROJECT_STATUS.filter((s) => s !== 'Closed' || f.status === 'Closed').map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="RAG (normally calculated)"><Select value={f.rag} onChange={(e) => set('rag', e.target.value)}><option value="">Auto</option>{RAG.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Start date"><Input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label="Target close"><Input type="date" value={f.target_close_date} onChange={(e) => set('target_close_date', e.target.value)} /></Field>
        <Field label="Partner"><Select value={f.partner_user_id} onChange={(e) => set('partner_user_id', e.target.value)}><option value="">Not assigned</option>{partners.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}</Select></Field>
        <Field label="Manager"><Select value={f.manager_user_id} onChange={(e) => set('manager_user_id', e.target.value)}><option value="">Not assigned</option>{managers.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}</Select></Field>
        <Field label="Applications in scope"><Input type="number" min={0} value={f.apps_in_scope} onChange={(e) => set('apps_in_scope', e.target.value)} /></Field>
        <Field label="Sites in scope"><Input type="number" min={0} value={f.sites_in_scope} onChange={(e) => set('sites_in_scope', e.target.value)} /></Field>
        <Field label="Employees conveying"><Input type="number" min={0} value={f.employees_conveying} onChange={(e) => set('employees_conveying', e.target.value)} /></Field>
        <Field label="Sensitivity"><Select value={f.sensitivity} onChange={(e) => set('sensitivity', e.target.value)}><option value="">Not set</option>{SENSITIVITY.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Data residency"><Input value={f.data_residency} onChange={(e) => set('data_residency', e.target.value)} /></Field>
        <Field label="Tags" hint="Comma-separated"><Input value={f.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        <div className="col-span-2"><Checkbox checked={f.clean_team_required === 'Y'} onChange={(v) => set('clean_team_required', v ? 'Y' : 'N')} label="Clean team required before close" /></div>
      </div>
      {detail.perms.canViewFinance && (
        <div className="mt-5 rounded-lg border border-line p-3">
          <h4 className="mb-2 text-[13px] font-semibold">Finance {!finEditable && <span className="font-normal text-ink-muted">(view only for your role)</span>}</h4>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Currency"><Input value={f.currency} maxLength={3} disabled={!finEditable} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
            {([['fee_budget', 'Fee budget'], ['fee_billed', 'Fee billed'], ['tsa_monthly_cost', 'TSA cost per month'], ['one_time_cost', 'One-time cost'], ['funding_gap', 'Funding gap']] as const).map(([k, l]) => (
              <Field key={k} label={l}><Input type="number" min={0} value={f[k]} disabled={!finEditable} onChange={(e) => set(k, e.target.value)} /></Field>
            ))}
          </div>
        </div>
      )}
    </SidePanel>
  );
}

export function TeamPanel({ open, detail, onClose, onSaved, onGiveAccess }: { open: boolean; detail: ProjectDetail; onClose: () => void; onSaved: () => void; onGiveAccess?: (userId: string) => void }) {
  const toast = useToast();
  const users = useUsers();
  const canEdit = detail.perms.canEditProject;
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<string>('Analyst');
  const [workstream, setWorkstream] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const memberIds = new Set(detail.members.map((m) => m.user_id));
  const canSponsor = !!detail.perms.canSponsorAccess && !!onGiveAccess;
  const { session } = useSession();
  const sponsorable = (code: PersonaCode) => !!session && GRANTABLE.some((g) => g.eligible.includes(code)
    && level1Check(session.persona.code, session.actions as string[], code, g.code) === null);
  const chips = (uid: string) => (detail.memberAccess ?? []).filter((c) => c.user_id === uid);

  async function add() {
    if (!userId) return;
    setBusy(true);
    try { await post(`/projects/${detail.project.project_id}/members`, { user_id: userId, member_role: role, workstream: workstream || undefined }); toast.success('Team member added'); setUserId(''); setWorkstream(''); onSaved(); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    try {
      const res = await del<{ ok: boolean; withdrawn?: number }>(`/projects/${detail.project.project_id}/members/${id}`);
      const n = res?.withdrawn ?? 0;
      toast.success(n ? `Removed from the team. ${n} extra access item${n === 1 ? ' was' : 's were'} withdrawn.` : 'Removed from the team');
      onSaved(); window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
    }
    catch (e) { toast.error(e); } finally { setConfirm(null); }
  }

  return (
    <SidePanel open={open} onClose={onClose} title="Project team" subtitle="Who is staffed on this project. Staffing decides who can see it." footer={<Button onClick={onClose}>Close</Button>}>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {detail.members.map((m) => (
          <li key={m.member_id} className="flex items-center gap-3 px-3 py-2">
            <Avatar name={m.full_name} size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{m.full_name}</div>
              <div className="text-[11.5px] text-ink-muted">{[m.member_role, PERSONA_LABEL[m.persona_code], m.workstream].filter(Boolean).join(' | ')}</div>
              {chips(m.user_id).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1" aria-label={`Extra access for ${m.full_name}`}>
                  {chips(m.user_id).map((c) => (
                    <span key={c.grant_id} className="inline-flex items-center gap-1 rounded-md bg-blue-soft px-1.5 py-[1px] text-[11.5px] font-medium text-blue" title={c.label}>
                      {c.acting_role ? <UserCog size={11} aria-hidden /> : <ShieldCheck size={11} aria-hidden />}
                      {c.acting_role ? `Acting ${PERSONA_LABEL[c.acting_role] ?? c.acting_role}` : c.label} · until {date(c.expires_at)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {canSponsor && m.user_id !== session?.user.user_id && sponsorable(m.persona_code) && detail.project.status !== 'Closed' && (
              <button onClick={() => onGiveAccess!(m.user_id)} className="shrink-0 rounded px-1.5 py-1 text-[12px] font-medium text-link hover:bg-link-soft/40" aria-label={`Give extra access to ${m.full_name}`}>
                <KeyRound size={12} className="mr-0.5 inline" aria-hidden /> Give extra access
              </button>
            )}
            {m.clean_team === 'Y' && <Pill tone="bg-amber-soft text-amber">Clean team</Pill>}
            {canEdit && <button onClick={() => setConfirm(m.member_id)} className="rounded p-1 text-ink-muted hover:bg-rose-soft hover:text-rose" aria-label={`Remove ${m.full_name}`}><Trash2 size={14} /></button>}
          </li>
        ))}
        {!detail.members.length && <li className="px-3 py-4 text-[12.5px] text-ink-muted">Nobody is staffed yet.</li>}
      </ul>
      {canEdit ? (
        <div className="mt-5 rounded-lg border border-line p-3">
          <h4 className="mb-2 text-[13px] font-semibold">Add someone</h4>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Person" className="col-span-2">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose a person</option>
                {users.filter((u) => !memberIds.has(u.user_id)).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} ({PERSONA_LABEL[u.persona_code] ?? u.persona_code})</option>)}
              </Select>
            </Field>
            <Field label="Role on project"><Select value={role} onChange={(e) => setRole(e.target.value)}>{MEMBER_ROLES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
            <Field label="Workstream (optional)"><Input value={workstream} onChange={(e) => setWorkstream(e.target.value)} placeholder="e.g. Day-1 Readiness" /></Field>
          </div>
          <Button className="mt-3" variant="primary" icon={<UserPlus size={14} />} onClick={add} loading={busy} disabled={!userId}>Add to team</Button>
        </div>
      ) : <p className="mt-4 text-[12.5px] text-ink-muted">Only the engagement partner or manager can change the team.</p>}
      <ConfirmDialog open={!!confirm} title="Remove from the team?" confirmLabel="Remove" body="They lose access to this project straight away. Their pending access requests here are cancelled and any extra access is revoked." onCancel={() => setConfirm(null)} onConfirm={() => confirm && remove(confirm)} />
    </SidePanel>
  );
}
