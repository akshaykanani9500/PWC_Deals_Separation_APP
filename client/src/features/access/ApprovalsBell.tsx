/**
 * Top-bar approvals bell (v1.4): count = requests waiting for me + unseen updates on my own requests.
 * Popover: "Waiting for you" (approve / reject inline, reject needs a note) and "Your requests" (latest status changes).
 * Keyboard: button toggles, Esc closes and returns focus to the button, focus moves into the popover on open.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, Bell, Check, X } from 'lucide-react';
import type { AccessRequestRow } from '@shared/types';
import { post } from '../../lib/api';
import { relative } from '../../lib/format';
import { useToast } from '../../components/toast';
import { Button, Textarea } from '../../components/ui';
import { ACCESS_CHANGED_EVENT, getLastSeen, isUnseen, setLastSeen, useAccessFeed } from './useAccessSummary';
import { ApprovalRulesDialog } from './ApprovalRules';
import { ageText, approverNames, updateText } from './text';

function WaitingItem({ g, onDone }: { g: AccessRequestRow; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      const res = await post<AccessRequestRow>(`/access/requests/${g.grant_id}/decision`, { decision, note: note || null });
      toast.success(res.notice ?? (decision === 'reject' ? 'Request rejected' : 'Approved'));
      setMode(null); setNote('');
      window.dispatchEvent(new Event(ACCESS_CHANGED_EVENT));
      onDone();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const level = g.can.approveL2 ? 2 : 1;
  return (
    <li className={clsx('rounded-lg border px-3 py-2.5', g.escalated ? 'border-amber bg-amber-soft/40' : 'border-line')} aria-label={`${g.label} for ${g.grantee_name}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
          <div className="text-[13px] font-semibold text-ink">{g.grantee_name} · {g.label}</div>
          <div className="text-ink-soft">{g.project_code} · {g.duration_days} days · level {level}{g.requested_by !== g.grantee_user_id ? ` · sponsored by ${g.requested_by_name}` : ''}</div>
          <div className="mt-0.5 line-clamp-2 italic text-ink-muted">“{g.justification}”</div>
        </div>
        <span className={clsx('shrink-0 text-[11.5px] font-medium', g.escalated ? 'text-amber' : 'text-ink-muted')}>
          {g.escalated && <AlertTriangle size={11} className="mr-0.5 inline" aria-hidden />}{g.escalated ? 'Escalated · ' : ''}{ageText(g)}
        </span>
      </div>
      {mode ? (
        <div className="mt-2 space-y-1.5">
          <label className="block">
            <span className="label">{mode === 'reject' ? 'Reason (required)' : 'Note (optional)'}</span>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </label>
          <div className="flex gap-1.5">
            {mode === 'approve'
              ? <Button size="sm" variant="primary" icon={<Check size={13} />} loading={busy} onClick={() => decide('approve')}>Confirm approval</Button>
              : <Button size="sm" variant="danger" icon={<X size={13} />} loading={busy} disabled={note.trim().length < 5} disabledReason="Give a short reason" onClick={() => decide('reject')}>Confirm reject</Button>}
            <Button size="sm" variant="ghost" onClick={() => { setMode(null); setNote(''); }}>Back</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => setMode('approve')} aria-label={`Approve ${g.label} for ${g.grantee_name}`}>Approve</Button>
          <Button size="sm" variant="danger" icon={<X size={13} />} onClick={() => setMode('reject')} aria-label={`Reject ${g.label} for ${g.grantee_name}`}>Reject</Button>
        </div>
      )}
    </li>
  );
}

export default function ApprovalsBell({ userId, canAsk = true }: { userId: string; canAsk?: boolean }) {
  const { data, reload } = useAccessFeed(true);
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(false);
  const [lastSeen, setSeen] = useState(() => getLastSeen(userId));
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const waiting = data?.waiting ?? [];
  const updates = data?.updates ?? [];
  const unseen = updates.filter((u) => isUnseen(u, userId, lastSeen));
  const count = waiting.length + unseen.length;

  useEffect(() => { setSeen(getLastSeen(userId)); }, [userId]);
  const close = useCallback((focusBack = true) => {
    setOpen(false);
    // Opening the bell counts as seeing the updates.
    const now = new Date().toISOString();
    setLastSeen(userId, now); setSeen(now);
    if (focusBack) btn.current?.focus();
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => pop.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !rules) close(); };
    const onDoc = (e: MouseEvent) => {
      if (rules) return;
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDoc); };
  }, [open, close, rules]);

  const label = `Approvals and access updates: ${waiting.length} waiting for you${unseen.length ? `, ${unseen.length} new update${unseen.length === 1 ? '' : 's'}` : ''}`;
  return (
    <div className="relative">
      <button ref={btn} onClick={() => (open ? close() : (setOpen(true), reload()))} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title="Approvals and access updates"
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-chrome-muted hover:bg-chrome-soft hover:text-chrome-text">
        <Bell size={17} aria-hidden />
        {count > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-amber px-1 text-center text-[11px] font-semibold leading-[18px] text-white" aria-hidden>{count}</span>}
      </button>
      {open && (
        <div ref={pop} tabIndex={-1} role="dialog" aria-label="Approvals and access updates"
          className="absolute right-0 z-50 mt-1.5 flex max-h-[min(640px,80vh)] w-[min(420px,94vw)] flex-col rounded-xl border border-line bg-surface text-ink shadow-pop outline-none">
          <div className="overflow-y-auto p-3">
            <section aria-labelledby="bell-wait">
              <h3 id="bell-wait" className="mb-2 text-[13px] font-semibold">Waiting for you <span className="num text-ink-muted">({waiting.length})</span></h3>
              {waiting.length ? <ul className="space-y-2">{waiting.map((g) => <WaitingItem key={g.grant_id} g={g} onDone={reload} />)}</ul>
                : <p className="text-[12.5px] text-ink-muted">Nothing needs your approval.</p>}
            </section>
            {(canAsk || updates.length > 0) && <section aria-labelledby="bell-mine" className="mt-4">
              <h3 id="bell-mine" className="mb-2 text-[13px] font-semibold">Your requests</h3>
              {updates.length ? (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {updates.map((g) => {
                    const nu = isUnseen(g, userId, lastSeen);
                    return (
                      <li key={g.grant_id} className="px-3 py-2 text-[12.5px] leading-snug">
                        <div className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 font-medium text-ink">{g.label}{g.grantee_user_id !== userId ? ` for ${g.grantee_name}` : ''} · {g.project_code}</span>
                          {nu && <span className="rounded bg-amber px-1 text-[10.5px] font-semibold text-white">New</span>}
                          <span className="shrink-0 text-[11.5px] text-ink-muted">{relative(g.last_event_at)}</span>
                        </div>
                        <div className={clsx(g.state === 'Rejected' || g.blocked_reason ? 'text-rose' : g.state === 'Active' ? 'text-green' : g.escalated ? 'text-amber' : 'text-ink-soft')}>
                          {g.state}: {updateText(g)}
                        </div>
                        {(g.state === 'Pending L1' || g.state === 'Pending L2') && !g.blocked_reason && g.state !== 'Pending L2' && (
                          <div className="text-ink-muted">Now with {approverNames(g.next_approvers)}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-[12.5px] text-ink-muted">You have not asked for or sponsored any access yet.</p>}
            </section>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
            <button type="button" onClick={() => setRules(true)} className="text-[12.5px] font-medium text-link hover:underline">How approval works</button>
            <Link to="/access" onClick={() => close(false)} className="text-[13px] font-medium text-link hover:underline">Open Access &amp; approvals</Link>
          </div>
        </div>
      )}
      <ApprovalRulesDialog open={rules} onClose={() => setRules(false)} />
    </div>
  );
}
