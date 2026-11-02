/**
 * "Access" side panel on a project: extra access already in place, a form to request access (for yourself) or to
 * sponsor it for someone in your team (Partner / Manager), and the approval route it will follow.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, Send } from 'lucide-react';
import type { AccessRequestRow, PersonaCode, ProjectDetail } from '@shared/types';
import { PERMISSIONS, type Action } from '@shared/permissions';
import { GRANTABLE, GRANT_DURATIONS, LEVEL1_PERSONAS, level1Check } from '@shared/access';
import { post } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useSession } from '../../lib/session';
import { useUsers, PERSONA_LABEL } from '../../hooks/useUsers';
import { useToast } from '../../components/toast';
import { SidePanel } from '../../components/SidePanel';
import { Button, Field, Select, Skeleton, Textarea } from '../../components/ui';
import RequestCard from './RequestCard';
import { ACCESS_CHANGED_EVENT } from './useAccessSummary';

const roleActions = (p?: string) => (p ? (PERMISSIONS[p as PersonaCode]?.actions ?? []) : []) as string[];

export default function RequestAccessPanel({ open, onClose, detail, defaultPermission, onChanged }: {
  open: boolean; onClose: () => void; detail: ProjectDetail; defaultPermission?: Action; onChanged?: () => void;
}) {
  const { session } = useSession();
  const toast = useToast();
  const users = useUsers();
  const pid = detail.project.project_id;
  const list = useApi<AccessRequestRow[]>(open ? `/access/requests?projectId=${pid}` : null, [open, pid]);
  const me = session?.user.user_id ?? '';
  const myPersona = session?.persona.code as PersonaCode | undefined;
  const myActions = (session?.actions ?? []) as string[];
  const canRequest = !!detail.perms.canRequestAccess;
  const canSponsor = !!detail.perms.canSponsorAccess;

  // Who can this request be for?
  const people = useMemo(() => {
    const out: { id: string; name: string; persona: PersonaCode; self: boolean }[] = [];
    if (canRequest && myPersona) out.push({ id: me, name: `Myself (${session?.user.full_name})`, persona: myPersona, self: true });
    if (canSponsor && myPersona) {
      for (const m of detail.members) {
        if (m.user_id === me || !m.persona_code) continue;
        if (!GRANTABLE.some((g) => g.eligible.includes(m.persona_code) && level1Check(myPersona, myActions, m.persona_code, g.code) === null)) continue;
        out.push({ id: m.user_id, name: `${m.full_name} (${PERSONA_LABEL[m.persona_code] ?? m.persona_code})`, persona: m.persona_code, self: false });
      }
    }
    return out;
  }, [canRequest, canSponsor, detail.members, me, myPersona, myActions, session?.user.full_name]);

  const [who, setWho] = useState('');
  const [perm, setPerm] = useState<string>('');
  const [days, setDays] = useState<number>(30);
  const [why, setWhy] = useState('');
  const [saving, setSaving] = useState(false);

  const target = people.find((p) => p.id === who) ?? people[0];
  const options = useMemo(() => {
    if (!target || !myPersona) return [];
    // Skip anything that person already has, or already asked for (pending / live) on this project.
    const taken = new Set((list.data ?? []).filter((g) => g.grantee_user_id === target.id && ['Pending L1', 'Pending L2', 'Active'].includes(g.state)).map((g) => g.permission_code));
    return GRANTABLE.filter((g) => g.eligible.includes(target.persona) && !roleActions(target.persona).includes(g.code) && !taken.has(g.code)
      && (target.self || level1Check(myPersona, myActions, target.persona, g.code) === null));
  }, [target, myPersona, myActions, list.data]);

  useEffect(() => {
    if (!open) return;
    setWho(people[0]?.id ?? '');
    setWhy('');
    setDays(30);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!options.length) { setPerm(''); return; }
    setPerm((p) => (options.some((o) => o.code === p) ? p : options.find((o) => o.code === defaultPermission)?.code ?? options[0].code));
  }, [options, defaultPermission]);

  const chosen = GRANTABLE.find((g) => g.code === perm);
  // Who would approve? Level 1 = Partner/Manager on this project holding the permission and senior to the person.
  const level1 = target && chosen ? detail.members.filter((m) => LEVEL1_PERSONAS.includes(m.persona_code) && m.user_id !== target.id
    && level1Check(m.persona_code, roleActions(m.persona_code), target.persona, chosen.code) === null) : [];
  const risk = users.filter((u) => u.persona_code === 'RISK');
  const pending = (list.data ?? []).filter((g) => g.state === 'Pending L1' || g.state === 'Pending L2');
  const live = (list.data ?? []).filter((g) => g.state === 'Active');
  const past = (list.data ?? []).filter((g) => !['Pending L1', 'Pending L2', 'Active'].includes(g.state)).slice(0, 4);

  const submit = async () => {
    if (!target || !chosen) return;
    setSaving(true);
    try {
      const res = await post<AccessRequestRow>('/access/requests', {
        project_id: pid, permission_code: chosen.code, justification: why, duration_days: days, grantee_user_id: target.self ? null : target.id,
      });
      toast.success(res.state === 'Pending L2' ? 'Sponsored - level 1 is done, now with Risk & Quality' : 'Request sent for level-1 approval');
      setWhy('');
      list.reload();
      onChanged?.();
      window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };

  const closed = detail.project.status === 'Closed';
  return (
    <SidePanel open={open} onClose={onClose} width="lg" title="Access on this project" subtitle={`${detail.project.code_name} · extra, time-bound permissions with two-level approval`}
      footer={<><Link to="/access" className="mr-auto text-[13px] font-medium text-link hover:underline">Open all access requests</Link><Button onClick={onClose}>Close</Button></>}>
      <div className="space-y-5">
        <section className="rounded-lg border border-line bg-canvas/60 px-3.5 py-3 text-[12.5px] text-ink-soft">
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink"><ShieldCheck size={15} className="text-blue" /> How access is governed</p>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>You ask for yourself, or a Partner / Manager sponsors it for their team member.</li>
            <li><b>Level 1</b>: a Partner or Manager on this deal who holds the permission and is senior to the person.</li>
            <li><b>Level 2</b>: Risk &amp; Quality checks need-to-know, clean team and confidentiality.</li>
            <li>Access is live only on this project, for 7, 30 or 90 days, and can be revoked any time. Every step is audited.</li>
          </ol>
        </section>

        {list.loading && !list.data && <Skeleton className="h-24" />}
        {live.length > 0 && (
          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold">Live extra access ({live.length})</h3>
            <div className="space-y-2">{live.map((g) => <RequestCard key={g.grant_id} g={g} compact onChanged={() => { list.reload(); onChanged?.(); }} />)}</div>
          </section>
        )}
        {pending.length > 0 && (
          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold">Waiting for approval ({pending.length})</h3>
            <div className="space-y-2">{pending.map((g) => <RequestCard key={g.grant_id} g={g} onChanged={() => { list.reload(); onChanged?.(); }} />)}</div>
          </section>
        )}

        <section className="rounded-xl border border-line px-4 py-3.5">
          <h3 className="mb-3 flex items-center gap-1.5 text-[14px] font-semibold"><KeyRound size={15} /> {canSponsor ? 'Request or sponsor access' : 'Request access'}</h3>
          {closed ? <p className="text-[13px] text-ink-muted">This project is closed; no new access can be added.</p>
            : !people.length ? <p className="text-[13px] text-ink-muted">Your role ({session?.persona.name}) keeps fixed access and cannot request extra permissions. Client users and control roles (Knowledge, Risk, Admin) are not part of the request flow.</p>
            : (
              <div className="space-y-3">
                {people.length > 1 && (
                  <Field label="Access for">
                    <Select value={target?.id} onChange={(e) => setWho(e.target.value)}>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                )}
                {options.length ? (
                  <>
                    <Field label="Permission" hint={chosen?.description}>
                      <Select value={perm} onChange={(e) => setPerm(e.target.value)}>
                        {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </Select>
                    </Field>
                    <fieldset>
                      <legend className="label">For how long</legend>
                      <div className="flex gap-1.5" role="radiogroup">
                        {GRANT_DURATIONS.map((d) => (
                          <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
                            className={`rounded-md border px-3 py-1.5 text-[13px] font-medium ${days === d ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line-strong bg-surface text-ink-soft hover:bg-sunken'}`}>
                            {d} days
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <Field label="Why is it needed?" hint="Be specific: approvers check need-to-know. At least 15 characters.">
                      <Textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} placeholder="e.g. Preparing the cost-sharing options paper for the control board; need the cost lines and who pays." />
                    </Field>
                    <div className="rounded-lg bg-sunken/70 px-3 py-2 text-[12.5px] text-ink-soft">
                      <div className="mb-1 font-medium text-ink">Approval route</div>
                      <div><b>Level 1</b>: {target && !target.self ? <>done by you as sponsor ({session?.user.full_name})</> : level1.length ? level1.map((m) => m.full_name).join(' or ') : 'the Deals Leader'}</div>
                      <div><b>Level 2</b>: Risk &amp; Quality{risk.length ? ` (${risk.map((r) => r.full_name).join(', ')})` : ''}</div>
                      {chosen?.riskNote && <div className="mt-1 text-ink-muted">{chosen.riskNote}</div>}
                    </div>
                    <Button variant="primary" icon={<Send size={14} />} loading={saving} disabled={why.trim().length < 15} disabledReason="Explain why in at least 15 characters" onClick={submit}>
                      {target && !target.self ? 'Sponsor and send to Risk & Quality' : 'Send request'}
                    </Button>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-muted">{target?.self ? 'Nothing more to request here: your role already has it, or your request is already pending or live (see above).' : 'Nothing to sponsor for this person: they already have it or a request is open, or it is a permission your own role does not hold (you can only give what you hold, to someone more junior).'}</p>
                )}
              </div>
            )}
        </section>

        {past.length > 0 && (
          <section>
            <h3 className="mb-2 text-[13.5px] font-semibold text-ink-soft">Recent history</h3>
            <div className="space-y-2">{past.map((g) => <RequestCard key={g.grant_id} g={g} compact onChanged={() => list.reload()} />)}</div>
          </section>
        )}
      </div>
    </SidePanel>
  );
}
