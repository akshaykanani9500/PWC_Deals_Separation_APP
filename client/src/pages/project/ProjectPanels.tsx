/** Project-level side panels: edit project, team, finance. */
import { useEffect, useMemo, useState } from 'react';
import { Trash2, UserPlus, Sparkles } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FinanceEntry, ProjectDetail, SuggestResponse, TsaService } from '@shared/types';
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
import { CHART } from '../dashboard/widgets';

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
  const finEditable = can('finance.edit') && detail.perms.canViewFinance;
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

export function TeamPanel({ open, detail, onClose, onSaved }: { open: boolean; detail: ProjectDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const users = useUsers();
  const canEdit = detail.perms.canEditProject;
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<string>('Analyst');
  const [workstream, setWorkstream] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const memberIds = new Set(detail.members.map((m) => m.user_id));

  async function add() {
    if (!userId) return;
    setBusy(true);
    try { await post(`/projects/${detail.project.project_id}/members`, { user_id: userId, member_role: role, workstream: workstream || undefined }); toast.success('Team member added'); setUserId(''); setWorkstream(''); onSaved(); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await del(`/projects/${detail.project.project_id}/members/${id}`); toast.success('Removed from the team'); onSaved(); }
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
            </div>
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
      <ConfirmDialog open={!!confirm} title="Remove from the team?" confirmLabel="Remove" body="They lose access to this project straight away." onCancel={() => setConfirm(null)} onConfirm={() => confirm && remove(confirm)} />
    </SidePanel>
  );
}

interface FinanceResponse { entries: FinanceEntry[]; tsaServices: TsaService[]; totals: Record<string, number> }

export function FinancePanel({ open, detail, onClose }: { open: boolean; detail: ProjectDetail; onClose: () => void }) {
  const { data, error, loading } = useApi<FinanceResponse>(open ? `/projects/${detail.project.project_id}/finance` : null, [open]);
  const cur = detail.project.currency || 'USD';
  const entries = [...(data?.entries ?? [])].sort((a, b) => a.period_month.localeCompare(b.period_month));
  return (
    <SidePanel open={open} onClose={onClose} width="xl" title="Finance" subtitle={`${detail.project.code_name}, figures in ${cur}`} footer={<Button onClick={onClose}>Close</Button>}>
      {error && <p className="text-rose">{error.status === 403 ? 'Your role cannot see finance for this project.' : error.message}</p>}
      {loading && !data && <Skeleton className="h-64" />}
      {data && (
        <div className="space-y-5">
          {data.totals && Object.keys(data.totals).length > 0 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {Object.entries(data.totals).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-sunken px-3 py-2">
                  <div className="text-[11.5px] text-ink-muted">{financeLabel(k)}</div>
                  <div className="num text-[16px] font-medium">{typeof v === 'number' && /hour|count|services/i.test(k) ? v.toLocaleString() : money(v, cur)}</div>
                </div>
              ))}
            </div>
          )}
          <section>
            <h4 className="mb-2 text-[13px] font-semibold">Monthly fees and client TSA cost</h4>
            {entries.length ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={entries} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={CHART.line} />
                    <XAxis dataKey="period_month" tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => money(v, cur)} width={64} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v: number) => money(v, cur, false)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="fee_planned" name="Fees planned" fill="#D9D3CA" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="fee_actual" name="Fees actual" fill={CHART.brand} radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Line dataKey="tsa_cost" name="Client TSA cost" stroke={CHART.blue} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-[12.5px] text-ink-muted">No monthly entries recorded.</p>}
          </section>
          <section>
            <h4 className="mb-2 text-[13px] font-semibold">TSA services ({data.tsaServices.length})</h4>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-[12.5px]">
                <thead><tr><th className="th">Service</th><th className="th">Provider</th><th className="th text-right">Per month</th><th className="th">Planned exit</th><th className="th text-right">Extension uplift</th><th className="th">Status</th></tr></thead>
                <tbody>
                  {data.tsaServices.map((s) => (
                    <tr key={s.service_id}>
                      <td className="td"><div className="font-medium">{s.name}</div>{s.linked_apps && <div className="text-[11px] text-ink-muted">{s.linked_apps}</div>}</td>
                      <td className="td">{s.provider || '–'}</td>
                      <td className="td num text-right">{money(s.monthly_fee, cur)}</td>
                      <td className="td num">{date(s.planned_exit_date)}</td>
                      <td className="td num text-right">{s.extension_uplift_pct != null ? `${s.extension_uplift_pct}%` : '–'}</td>
                      <td className="td">{s.status ? <Pill>{s.status}</Pill> : '–'}</td>
                    </tr>
                  ))}
                  {!data.tsaServices.length && <tr><td colSpan={6} className="td text-ink-muted">No TSA services recorded for this project.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </SidePanel>
  );
}

/** "tsaCostToDate" / "tsa_cost_to_date" -> "TSA cost to date" */
function financeLabel(k: string) {
  const t = k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/\btsa\b/g, 'TSA');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
