/**
 * "Access" side panel on a project: extra access already in place, a form to request access (for yourself) or to
 * sponsor it for someone in your team (Partner / Manager), and the approval route it will follow.
 * v1.4: the route (with names) comes from the server (/access/preview), so it matches what will really happen,
 * including "nobody could approve this" before you send. Acting roles are offered next to single permissions.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, Send, AlertTriangle } from 'lucide-react';
import type { AccessPreview, AccessRequestRow, PersonaCode, ProjectDetail } from '@shared/types';
import { PERMISSIONS, type Action } from '@shared/permissions';
import { GRANTABLE, durationsFor, level1Check, policyText } from '@shared/access';
import { get, post } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useSession } from '../../lib/session';
import { PERSONA_LABEL } from '../../hooks/useUsers';
import { useToast } from '../../components/toast';
import { SidePanel } from '../../components/SidePanel';
import { Button, Field, Select, Skeleton, Textarea } from '../../components/ui';
import RequestCard from './RequestCard';
import { ACCESS_CHANGED_EVENT } from './useAccessSummary';
import { HowApprovalWorks } from './ApprovalRules';
import { approverNames } from './text';

const roleActions = (p?: string) => (p ? (PERMISSIONS[p as PersonaCode]?.actions ?? []) : []) as string[];

export default function RequestAccessPanel({ open, onClose, detail, defaultPermission, defaultGrantee, onChanged }: {
  open: boolean; onClose: () => void; detail: ProjectDetail; defaultPermission?: Action | string; defaultGrantee?: string | null; onChanged?: () => void;
}) {
  const { session } = useSession();
  const toast = useToast();
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
        if (m.user_id === me || !m.persona_code || out.some((o) => o.id === m.user_id)) continue;
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
  const [preview, setPreview] = useState<AccessPreview | null>(null);

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
    setWho(defaultGrantee && people.some((p) => p.id === defaultGrantee) ? defaultGrantee : people[0]?.id ?? '');
    setWhy('');
    setDays(30);
  }, [open, defaultGrantee]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!options.length) { setPerm(''); return; }
    setPerm((p) => (options.some((o) => o.code === p) ? p : options.find((o) => o.code === defaultPermission)?.code ?? options[0].code));
  }, [options, defaultPermission]);

  const chosen = GRANTABLE.find((g) => g.code === perm);
  const durations = chosen ? durationsFor(chosen.code) : [7, 30, 90];
  useEffect(() => { if (!durations.includes(days)) setDays(durations[durations.length - 1]); }, [perm]); // eslint-disable-line react-hooks/exhaustive-deps

  // The real approval route, with names, from the server.
  useEffect(() => {
    setPreview(null);
    if (!open || !target || !chosen) return;
    let alive = true;
    const q = new URLSearchParams({ projectId: pid, permission: chosen.code, ...(target.self ? {} : { grantee: target.id }) });
    get<AccessPreview>(`/access/preview?${q}`).then((p) => alive && setPreview(p)).catch(() => undefined);
    return () => { alive = false; };
  }, [open, pid, target?.id, chosen?.code]); // eslint-disable-line react-hooks/exhaustive-deps

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
      toast.success(res.notice ?? 'Request sent');
      setWhy('');
      list.reload();
      onChanged?.();
      window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };

  const closed = detail.project.status === 'Closed';
  const sponsoring = !!target && !target.self;
  const liveOnSend = sponsoring && preview && !preview.needsL2;
  const single = options.filter((o) => !o.actingRole);
  const acting = options.filter((o) => o.actingRole);
  return (
    <SidePanel open={open} onClose={onClose} width="lg" title="Access on this project" subtitle={`${detail.project.code_name} · extra, time-bound permissions with risk-tiered approval`}
      footer={<><Link to="/access" className="mr-auto text-[13px] font-medium text-link hover:underline">Open all access requests</Link><Button onClick={onClose}>Close</Button></>}>
      <div className="space-y-5">
        <section className="rounded-lg border border-line bg-canvas/60 px-3.5 py-3 text-[12.5px] text-ink-soft">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink"><ShieldCheck size={15} className="text-blue" /> How access is governed</p>
            <HowApprovalWorks label="Full rules and matrix" />
          </div>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>You ask for yourself, or a Partner / Manager sponsors it for their team member (a sponsor counts as level 1).</li>
            <li><b>Level 1</b>: a Partner or Manager on this deal who holds the permission and is senior to the person. Finance edits and acting roles need the Partner.</li>
            <li><b>Level 2</b>: Risk &amp; Quality, only for riskier items: finance edits, acting roles, and finance on clean-team deals.</li>
            <li>Live only on this project, for a limited time, revocable any time. Waiting 3+ days escalates; 7 days without a decision expires.</li>
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
                        {single.length > 0 && <optgroup label="Single permission">{single.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</optgroup>}
                        {acting.length > 0 && <optgroup label="Acting role (role elevation)">{acting.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</optgroup>}
                      </Select>
                    </Field>
                    <fieldset>
                      <legend className="label">For how long</legend>
                      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="For how long">
                        {durations.map((d) => (
                          <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
                            className={`rounded-md border px-3 py-1.5 text-[13px] font-medium ${days === d ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line-strong bg-surface text-ink-soft hover:bg-sunken'}`}>
                            {d} days
                          </button>
                        ))}
                        {chosen && chosen.maxDays < 90 && <span className="text-[12px] text-ink-muted">{chosen.maxDays} days at most for this item</span>}
                      </div>
                    </fieldset>
                    <Field label="Why is it needed?" hint="Be specific: approvers check need-to-know. At least 15 characters.">
                      <Textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} placeholder="e.g. Preparing the cost-sharing options paper for the control board; need the cost lines and who pays." />
                    </Field>
                    <div className="rounded-lg bg-sunken/70 px-3 py-2 text-[12.5px] text-ink-soft" aria-live="polite">
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-ink">Approval route</span>
                        <span className="text-ink-muted">Needs: {(preview?.policy ?? (chosen ? policyText(chosen.code, detail.project) : '')).replace(/^Level/, 'level')}</span>
                      </div>
                      {!preview ? <Skeleton className="h-8" /> : preview.blocked ? (
                        <p className="flex items-start gap-1.5 text-rose"><AlertTriangle size={14} className="mt-[2px] shrink-0" /> {preview.blocked}</p>
                      ) : (
                        <>
                          <div><b>Level 1</b>: {sponsoring ? <>done by you as sponsor ({session?.user.full_name})</> : approverNames(preview.level1)}</div>
                          <div><b>Level 2</b>: {preview.needsL2 ? `Risk & Quality (${preview.level2.map((r) => r.name).join(' or ')})` : 'not needed for this item'}</div>
                          <div className="mt-1 text-ink-muted">{liveOnSend ? 'Goes live as soon as you send it.' : preview.needsL2 ? 'Goes live after Risk & Quality approves.' : 'Goes live when level 1 approves.'}</div>
                        </>
                      )}
                      {chosen?.riskNote && <div className="mt-1 text-ink-muted">{chosen.riskNote}</div>}
                    </div>
                    <Button variant="primary" icon={<Send size={14} />} loading={saving} disabled={why.trim().length < 15 || !!preview?.blocked}
                      disabledReason={preview?.blocked ? 'Nobody could approve this yet; see the approval route' : 'Explain why in at least 15 characters'} onClick={submit}>
                      {!sponsoring ? 'Send request' : liveOnSend ? 'Sponsor and switch on' : 'Sponsor and send to Risk & Quality'}
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
