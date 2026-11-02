/** One access request: who / what / why, the two-level approval trail, and the actions this viewer may take. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Check, CheckCircle2, Circle, Clock3, ShieldCheck, ShieldAlert, X, XCircle, Ban } from 'lucide-react';
import type { AccessRequestRow } from '@shared/types';
import { post } from '../../lib/api';
import { useToast } from '../../components/toast';
import { Button, Pill, Textarea } from '../../components/ui';
import { date, dateTime } from '../../lib/format';
import { PERSONA_LABEL } from '../../hooks/useUsers';
import { ACCESS_CHANGED_EVENT } from './useAccessSummary';

type Step = { label: string; who?: string; when?: string | null; note?: string | null; state: 'done' | 'current' | 'todo' | 'failed' };

function steps(g: AccessRequestRow): Step[] {
  const rejectedAt = g.state === 'Rejected' ? (g.l2_decided_at ? 2 : 1) : 0;
  const s: Step[] = [
    { label: 'Requested', who: g.requested_by_name, when: g.created_at, state: 'done' },
    {
      label: 'Level 1 · engagement', who: g.l1_name, when: g.l1_decided_at, note: g.l1_note,
      state: rejectedAt === 1 ? 'failed' : g.l1_decided_at ? 'done' : g.state === 'Pending L1' ? 'current' : g.state === 'Cancelled' ? 'todo' : 'todo',
    },
    {
      label: 'Level 2 · Risk & Quality', who: g.l2_name, when: g.l2_decided_at, note: g.l2_note,
      state: rejectedAt === 2 ? 'failed' : g.l2_decided_at ? 'done' : g.state === 'Pending L2' ? 'current' : 'todo',
    },
  ];
  if (g.state === 'Active' || g.state === 'Expired' || g.state === 'Revoked') {
    s.push({
      label: g.state === 'Revoked' ? 'Revoked' : g.state === 'Expired' ? 'Expired' : 'Live',
      who: g.state === 'Revoked' ? g.revoked_by_name : undefined,
      when: g.state === 'Revoked' ? g.revoked_at : g.expires_at,
      note: g.state === 'Revoked' ? g.revoke_reason : g.state === 'Active' ? `Until ${date(g.expires_at)}` : null,
      state: g.state === 'Active' ? 'done' : 'failed',
    });
  }
  return s;
}

const stepIcon = (st: Step['state']) => st === 'done' ? <CheckCircle2 size={15} className="text-green" />
  : st === 'current' ? <Clock3 size={15} className="text-amber" />
  : st === 'failed' ? <XCircle size={15} className="text-rose" /> : <Circle size={15} className="text-line-strong" />;

export default function RequestCard({ g, onChanged, compact }: { g: AccessRequestRow; onChanged: () => void; compact?: boolean }) {
  const toast = useToast();
  const [mode, setMode] = useState<null | 'approve' | 'reject' | 'revoke'>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const level = g.state === 'Pending L1' ? 1 : g.state === 'Pending L2' ? 2 : 0;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setMode(null); setNote(''); onChanged(); window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT)); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const decide = (decision: 'approve' | 'reject') => run(() => post(`/access/requests/${g.grant_id}/decision`, { decision, note: note || null }),
    decision === 'reject' ? 'Request rejected' : level === 2 ? 'Approved - access is live now' : 'Approved - sent to Risk & Quality');

  return (
    <article className={clsx('rounded-xl border bg-surface', g.can.approveL1 || g.can.approveL2 ? 'border-amber/60 shadow-card' : 'border-line')} aria-label={`${g.label} for ${g.grantee_name}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 pt-3">
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-semibold">{g.label}</h3>
            <Pill>{g.state}</Pill>
            {g.clean_team && g.permission_code.startsWith('finance') && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-soft px-1.5 py-[1px] text-[11.5px] font-medium text-amber"><ShieldAlert size={12} /> Clean-team deal</span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            For <span className="font-medium text-ink">{g.grantee_name}</span>{g.grantee_persona ? ` (${PERSONA_LABEL[g.grantee_persona] ?? g.grantee_persona})` : ''}
            {' on '}<Link className="font-medium text-link hover:underline" to={`/projects/${g.project_id}`}>{g.project_code}</Link>
            {' · '}{g.duration_days} days{g.requested_by && g.requested_by !== g.grantee_user_id ? ` · sponsored by ${g.requested_by_name}` : ''}
          </p>
        </div>
        <div className="text-right text-[12px] text-ink-muted">{g.grant_id}<br />{dateTime(g.created_at)}</div>
      </div>

      <blockquote className="mx-4 mt-2 rounded-md border-l-[3px] border-line-strong bg-sunken/60 px-3 py-1.5 text-[13px] text-ink-soft">“{g.justification}”</blockquote>

      {!compact && (
        <ol className="mx-4 mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Approval trail">
          {steps(g).map((s) => (
            <li key={s.label} className="flex gap-2 rounded-lg bg-canvas/70 px-2.5 py-2">
              <span className="mt-[1px]" aria-hidden>{stepIcon(s.state)}</span>
              <span className="min-w-0 text-[12.5px] leading-snug">
                <span className="block font-medium text-ink">{s.label}<span className="sr-only"> ({s.state})</span></span>
                {s.who && <span className="block text-ink-soft">{s.who}</span>}
                {s.when && s.state !== 'current' && <span className="block text-ink-muted">{dateTime(s.when)}</span>}
                {s.state === 'current' && <span className="block text-amber">Waiting</span>}
                {s.note && <span className="mt-0.5 block italic text-ink-muted">{s.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {(g.can.approveL1 || g.can.approveL2) && g.risk_note && (
        <p className="mx-4 mt-2 flex items-start gap-1.5 text-[12.5px] text-ink-soft"><ShieldCheck size={14} className="mt-[2px] shrink-0 text-blue" /> {g.risk_note}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-3">
        {mode ? (
          <div className="w-full space-y-2">
            <label className="block">
              <span className="label">{mode === 'reject' ? 'Reason for rejecting (required)' : mode === 'revoke' ? 'Reason for revoking (required)' : 'Note (optional)'}</span>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus
                placeholder={mode === 'approve' ? (level === 2 ? 'e.g. Need-to-know confirmed; on the clean team.' : 'e.g. Agreed for one week, read-only.') : ''} />
            </label>
            <div className="flex gap-2">
              {mode === 'approve' && <Button variant="primary" icon={<Check size={14} />} loading={busy} onClick={() => decide('approve')}>{level === 2 ? 'Approve and switch on' : 'Approve level 1'}</Button>}
              {mode === 'reject' && <Button variant="danger" icon={<X size={14} />} loading={busy} disabled={note.trim().length < 5} disabledReason="Give a short reason" onClick={() => decide('reject')}>Reject request</Button>}
              {mode === 'revoke' && <Button variant="danger" icon={<Ban size={14} />} loading={busy} disabled={note.trim().length < 3} disabledReason="Give a short reason"
                onClick={() => run(() => post(`/access/requests/${g.grant_id}/revoke`, { reason: note }), 'Access revoked')}>Revoke access now</Button>}
              <Button variant="ghost" onClick={() => { setMode(null); setNote(''); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <>
            {(g.can.approveL1 || g.can.approveL2) && (
              <>
                <Button variant="primary" size="sm" icon={<Check size={14} />} onClick={() => setMode('approve')}>{g.can.approveL2 ? 'Approve (level 2)' : 'Approve (level 1)'}</Button>
                <Button variant="danger" size="sm" icon={<X size={14} />} onClick={() => setMode('reject')}>Reject</Button>
              </>
            )}
            {g.can.revoke && <Button size="sm" variant="danger" icon={<Ban size={14} />} onClick={() => setMode('revoke')}>Revoke access</Button>}
            {g.can.cancel && <Button size="sm" variant="ghost" loading={busy} onClick={() => run(() => post(`/access/requests/${g.grant_id}/cancel`), 'Request cancelled')}>Cancel request</Button>}
            {!g.can.approveL1 && !g.can.approveL2 && !g.can.revoke && !g.can.cancel && level > 0 && (
              <span className="text-[12.5px] text-ink-muted">{level === 1 ? 'Waiting for a Partner or Manager on this project.' : 'Waiting for Risk & Quality.'}</span>
            )}
          </>
        )}
      </div>
    </article>
  );
}
