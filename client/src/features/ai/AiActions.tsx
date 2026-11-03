/**
 * Quick AI actions for a scope: "Draft email", "Schedule meeting", "Call prep".
 * v1.4 (C): each opens a portal modal (never clipped by the sticky side panel) with a real workflow:
 *  - Meeting: editable title / agenda, attendee picker, suggested or custom slot + duration, demo meeting link,
 *    copy invite, .ics download, "Draft invite email", "Save to project log".
 *  - Email: editable To / CC / Subject / Body with a recipient picker, redraft with AI, copy, open in the mail app,
 *    "Save to project log".
 *  - Call prep: talking points, tel: link (only when the number is visible to the role), notes + outcome, "Log call".
 * The server re-checks every permission (notes.add to save; the client view is read-only and cannot e-mail).
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Copy, Download, Link2, Loader2, Mail, Phone, PhoneCall, Save, Sparkles } from 'lucide-react';
import type { CommsContext, CommsPerson, MeetingSuggestion, SummaryResponse } from '@shared/types';
import { post } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Modal } from '../../components/Modal';
import { AiLabel, Button, Field, Input, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';

export interface AiActionsProps {
  scope: 'project' | 'stage' | 'activity' | 'task'; id: string;
  /** Called after something was saved to the project log (refresh the communications list). */
  onLogged?: () => void;
}

type Kind = 'email' | 'meeting' | 'call';
interface EmailDraft { to: string; subject: string; body: string; mode: string }

function useCopy() {
  const [copied, setCopied] = useState('');
  const copy = async (text: string, what = 'copy') => {
    try { await navigator.clipboard.writeText(text); } catch {
      // clipboard blocked (http / tests): fall back to a hidden textarea
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
    }
    setCopied(what); setTimeout(() => setCopied(''), 1500);
  };
  return { copied, copy };
}

const realAddr = (p?: CommsPerson) => (p?.email && !p.emailMasked ? p.email : '');
const addrList = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
const bareEmail = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? (s.includes('@') ? s : '')).trim();
const usable = (e: string) => !!e && !e.includes('•');
const pad = (n: number) => String(n).padStart(2, '0');
const icsDate = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const randomId = () => Math.random().toString(36).slice(2, 6) + '-' + Math.random().toString(36).slice(2, 6);

export default function AiActions({ scope, id, onLogged }: AiActionsProps) {
  const { session } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState<Kind | null>(null);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ctx, setCtx] = useState<CommsContext | null>(null);
  const { copied, copy } = useCopy();
  const isClient = session?.persona.code === 'CLIENT';

  // email
  const [intent, setIntent] = useState('');
  const [to, setTo] = useState(''); const [cc, setCc] = useState(''); const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [emailMode, setEmailMode] = useState(''); const [emailAi, setEmailAi] = useState(false);
  // meeting
  const [meeting, setMeeting] = useState<MeetingSuggestion | null>(null);
  const [mTitle, setMTitle] = useState(''); const [agenda, setAgenda] = useState('');
  const [invitees, setInvitees] = useState<Set<string>>(new Set());
  const [slot, setSlot] = useState<string>('0'); const [customDate, setCustomDate] = useState(''); const [customTime, setCustomTime] = useState('10:00');
  const [duration, setDuration] = useState(30); const [link, setLink] = useState('');
  // call
  const [call, setCall] = useState<SummaryResponse | null>(null);
  const [callee, setCallee] = useState(''); const [callNotes, setCallNotes] = useState(''); const [outcome, setOutcome] = useState('Connected - next steps agreed'); const [callMin, setCallMin] = useState(15);

  const people = ctx?.people ?? [];
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  async function ensureCtx() {
    if (ctx) return ctx;
    const c = await post<CommsContext>('/ai/comms/context', { scope, id });
    setCtx(c); return c;
  }

  async function loadEmail(nextIntent = intent, nextLang = lang) {
    const e = await post<EmailDraft>('/ai/draft-email', { scope, id, intent: nextIntent, language: nextLang });
    setTo(e.to.includes('•') ? e.to.replace(/<[^>]*•[^>]*>/, '').trim() : e.to); setSubject(e.subject); setBody(e.body); setEmailMode(e.mode); setEmailAi(true);
  }
  async function loadMeeting(nextLang = lang) {
    const [m, c] = await Promise.all([post<MeetingSuggestion>('/ai/meeting', { scope, id, language: nextLang }), ensureCtx()]);
    setMeeting(m); setMTitle(m.title); setAgenda(m.agenda.join('\n')); setDuration(m.durationMin ?? 30); setSlot('0');
    const known = new Set(c.people.map((p) => p.id));
    setInvitees(new Set((m.attendeeIds ?? []).filter((x) => known.has(x))));
  }
  async function loadCall(nextLang = lang) {
    const [s, c] = await Promise.all([post<SummaryResponse>('/ai/summary', { scope, id, language: nextLang }), ensureCtx()]);
    setCall(s);
    const firstWithPhone = c.people.find((p) => p.kind === 'contact' && p.phone) ?? c.people.find((p) => p.phone && p.id !== session?.user.user_id);
    setCallee(firstWithPhone?.id ?? '');
  }

  async function run(_kind: Kind, fn: () => Promise<void>) {
    setLoading(true); setError('');
    try { await fn(); } catch (e: any) { setError(e?.message || 'AI action failed'); } finally { setLoading(false); }
  }

  function openKind(k: Kind) {
    setOpen(k); setError('');
    if (k === 'email') { setIntent(''); setCc(''); run(k, async () => { await ensureCtx(); await loadEmail(''); }); }
    if (k === 'meeting') { setLink(''); setCustomDate(''); run(k, () => loadMeeting()); }
    if (k === 'call') { setCallNotes(''); setOutcome('Connected - next steps agreed'); setCallMin(15); run(k, () => loadCall()); }
  }

  // ---------- meeting helpers ----------
  const slots = meeting?.slots ?? [];
  const when: { start: Date | null; label: string } = (() => {
    if (slot === 'custom') {
      if (!customDate) return { start: null, label: 'Pick a date' };
      const d = new Date(`${customDate}T${customTime || '10:00'}`);
      return Number.isNaN(d.getTime()) ? { start: null, label: 'Pick a date' } : { start: d, label: d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) };
    }
    const s = slots[Number(slot)];
    return s ? { start: new Date(s.start), label: s.label } : { start: null, label: meeting?.suggestedSlots[Number(slot)] ?? '' };
  })();
  const inviteeList = [...invitees].map((x) => byId.get(x)).filter(Boolean) as CommsPerson[];
  const agendaLines = agenda.split('\n').map((l) => l.trim()).filter(Boolean);
  const inviteText = [
    mTitle,
    `When: ${when.label}${when.start ? ` (${duration} min)` : ''}`,
    link ? `Join: ${link} (demo link - not a real meeting room)` : '',
    inviteeList.length ? `Attendees: ${inviteeList.map((p) => p.name).join(', ')}` : '',
    '', 'Agenda:', ...agendaLines.map((a, i) => `${i + 1}. ${a}`),
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');

  function downloadIcs() {
    if (!when.start) { toast.error('Pick a time slot first.'); return; }
    const end = new Date(when.start.getTime() + duration * 60000);
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Deals Separation Hub//Demo//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
      `UID:${randomId()}@deals-separation-hub.example`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(when.start)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEsc(mTitle)}`, `DESCRIPTION:${icsEsc(inviteText)}`, link ? `LOCATION:${icsEsc(link)}` : '',
      ...inviteeList.filter((p) => usable(realAddr(p))).map((p) => `ATTENDEE;CN=${icsEsc(p.name)}:mailto:${realAddr(p)}`),
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines], { type: 'text/calendar' }));
    a.download = `${mTitle.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 50) || 'meeting'}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function draftInviteEmail() {
    setTo(inviteeList.filter((p) => p.id !== session?.user.user_id).map((p) => (realAddr(p) ? `${p.name} <${realAddr(p)}>` : p.name)).join(', '));
    setCc(''); setSubject(`Invitation: ${mTitle}`);
    setBody(`Hi all,\n\nPlease join this meeting.\n\n${inviteText}\n\nThanks,\n${session?.user.full_name ?? ''}`);
    setEmailMode(meeting?.mode ?? 'offline'); setEmailAi(true); setIntent('');
    setOpen('email');
  }

  async function save(channel: 'Meeting' | 'Email' | 'Call', payload: { subject: string; body: string; to_name?: string; occurred_at?: string; duration_min?: number; contact_id?: string | null }, msg: string) {
    setSaving(true);
    try {
      await post('/ai/comms/log', { scope, id, channel, aiDrafted: true, ...payload });
      toast.success(msg);
      onLogged?.();
      setOpen(null);
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  const saveMeeting = () => {
    if (!mTitle.trim()) { toast.error('Give the meeting a title.'); return; }
    if (!when.start) { toast.error('Pick a time slot first.'); return; }
    save('Meeting', {
      subject: mTitle.trim(), to_name: inviteeList.map((p) => p.name).join(', '), occurred_at: when.start.toISOString(), duration_min: duration,
      body: [`Scheduled: ${when.label}, ${duration} min`, link ? `Link: ${link} (demo)` : '', inviteeList.length ? `Attendees: ${inviteeList.map((p) => p.name).join(', ')}` : '', '', 'Agenda:', ...agendaLines.map((a, i) => `${i + 1}. ${a}`)].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n'),
    }, 'Meeting saved to the project log');
  };
  const saveEmail = () => {
    if (!subject.trim()) { toast.error('Add a subject.'); return; }
    save('Email', { subject: subject.trim(), body: `${cc ? `CC: ${cc}\n\n` : ''}${body}`, to_name: to }, 'Email saved to the project log');
  };
  const callPerson = byId.get(callee);
  const talking = call ? [...call.risks, ...call.nextSteps] : [];
  const logCall = () => save('Call', {
    subject: `Call${callPerson ? ` with ${callPerson.name}` : ''}: ${ctx?.ref.label ?? ''} - ${outcome}`.slice(0, 200),
    body: [`Outcome: ${outcome}`, callNotes ? `\nNotes:\n${callNotes}` : '', talking.length ? `\nTalking points:\n${talking.map((t) => `- ${t}`).join('\n')}` : ''].join('\n'),
    to_name: callPerson?.name, duration_min: callMin, contact_id: callPerson?.kind === 'contact' ? callPerson.id : null,
  }, 'Call logged to the project log');

  const mailto = (() => {
    const t = addrList(to).map(bareEmail).filter(usable).join(',');
    const c = addrList(cc).map(bareEmail).filter(usable).join(',');
    return `mailto:${encodeURIComponent(t).replace(/%2C/g, ',')}?${c ? `cc=${encodeURIComponent(c)}&` : ''}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  })();
  const emailText = `To: ${to}${cc ? `\nCC: ${cc}` : ''}\nSubject: ${subject}\n\n${body}`;
  const callText = call ? `${call.summary}\n\nTalking points:\n${talking.map((a) => `- ${a}`).join('\n')}${callNotes ? `\n\nNotes:\n${callNotes}` : ''}` : '';

  function addRecipient(field: 'to' | 'cc', pid: string) {
    const p = byId.get(pid); if (!p) return;
    const entry = realAddr(p) ? `${p.name} <${realAddr(p)}>` : p.name;
    const set = field === 'to' ? setTo : setCc;
    set((s) => (addrList(s).some((x) => x.startsWith(p.name)) ? s : [...addrList(s), entry].join(', ')));
    if (!realAddr(p)) toast.info(`${p.name}'s address is hidden for your role; add it in your mail app.`);
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-piku/40 hover:text-piku';
  const mode = open === 'email' ? emailMode : open === 'meeting' ? meeting?.mode : call?.mode;
  const canSave = !!ctx?.canSave;
  const saveHint = ctx && !ctx.canSave ? ctx.saveReason : undefined;
  const regen = () => { if (open === 'email') run('email', () => loadEmail()); if (open === 'meeting') run('meeting', () => loadMeeting()); if (open === 'call') run('call', () => loadCall()); };

  const langToggle = (
    <div className="flex rounded-lg border border-line p-0.5 text-[11px]" role="group" aria-label="Language">
      {(['en', 'hi'] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => {
          setLang(l);
          if (open === 'email') run('email', () => loadEmail(intent, l)); if (open === 'meeting') run('meeting', () => loadMeeting(l)); if (open === 'call') run('call', () => loadCall(l));
        }} className={`rounded-md px-2 py-0.5 ${lang === l ? 'bg-piku text-white' : 'text-ink-soft'}`}>{l === 'en' ? 'EN' : 'हिं'}</button>
      ))}
    </div>
  );

  const footerLeft = <span className="mr-auto flex items-center gap-2">{mode && <AiLabel mode={mode} />}{saveHint && <span className="text-[11.5px] text-ink-muted">{saveHint}</span>}</span>;

  return (
    <div data-testid="ai-actions">
      <div className="flex flex-wrap gap-2">
        {!isClient && <button type="button" className={btn} onClick={() => openKind('email')}><Mail size={13} /> Draft email</button>}
        <button type="button" className={btn} onClick={() => openKind('meeting')}><CalendarClock size={13} /> Schedule meeting</button>
        <button type="button" className={btn} onClick={() => openKind('call')}><PhoneCall size={13} /> Call prep</button>
      </div>

      <Modal open={!!open} onClose={() => setOpen(null)} width="xl" headerRight={langToggle}
        icon={open === 'email' ? <Mail size={16} /> : open === 'meeting' ? <CalendarClock size={16} /> : <PhoneCall size={16} />}
        title={open === 'email' ? 'Draft email' : open === 'meeting' ? 'Schedule a meeting' : 'Call prep brief'}
        footer={open === 'meeting' ? (
          <>
            {footerLeft}
            <Button size="sm" icon={copied === 'invite' ? <Check size={13} /> : <Copy size={13} />} onClick={() => copy(inviteText, 'invite')} disabled={loading || !meeting}>{copied === 'invite' ? 'Copied' : 'Copy invite'}</Button>
            <Button size="sm" icon={<Download size={13} />} onClick={downloadIcs} disabled={loading || !meeting}>Download .ics</Button>
            {!isClient && <Button size="sm" icon={<Mail size={13} />} onClick={draftInviteEmail} disabled={loading || !meeting}>Draft invite email</Button>}
            {canSave && <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={saveMeeting} loading={saving} disabled={loading || !meeting}>Save to project log</Button>}
          </>
        ) : open === 'email' ? (
          <>
            {footerLeft}
            <Button size="sm" icon={copied === 'email' ? <Check size={13} /> : <Copy size={13} />} onClick={() => copy(emailText, 'email')} disabled={loading}>{copied === 'email' ? 'Copied' : 'Copy'}</Button>
            <a href={mailto} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-sunken"><Mail size={13} /> Open in mail app</a>
            {canSave && <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={saveEmail} loading={saving} disabled={loading}>Save to project log</Button>}
          </>
        ) : (
          <>
            {footerLeft}
            <Button size="sm" icon={copied === 'call' ? <Check size={13} /> : <Copy size={13} />} onClick={() => copy(callText, 'call')} disabled={loading || !call}>{copied === 'call' ? 'Copied' : 'Copy'}</Button>
            {canSave && <Button size="sm" variant="primary" icon={<Save size={13} />} onClick={logCall} loading={saving} disabled={loading || !call}>Log call</Button>}
          </>
        )}>
        {error && <p className="mb-2 rounded-md bg-rose-soft px-3 py-2 text-[13px] text-rose" role="alert">{error}</p>}
        {loading && <div className="flex items-center gap-2 py-6 text-sm text-ink-muted"><Loader2 size={16} className="animate-spin text-piku" /> Drafting from the project data...</div>}

        {!loading && open === 'email' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="What is the email for? e.g. chase overdue items, update the client" aria-label="Email purpose" />
              <Button size="sm" icon={<Sparkles size={13} />} onClick={() => run('email', () => loadEmail())}>Redraft with AI</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <Field label="To"><Input value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></Field>
              <Field label="Add recipient"><Select value="" onChange={(e) => addRecipient('to', e.target.value)} aria-label="Add recipient to To">
                <option value="">Choose a person…</option>{people.filter((p) => p.id !== session?.user.user_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.side ? ` (${p.side})` : p.role ? ` (${p.role})` : ''}{p.emailMasked ? ' · address hidden' : ''}</option>)}
              </Select></Field>
              <Field label="CC"><Input value={cc} onChange={(e) => setCc(e.target.value)} aria-label="CC" /></Field>
              <Field label="Add CC"><Select value="" onChange={(e) => addRecipient('cc', e.target.value)} aria-label="Add recipient to CC">
                <option value="">Choose a person…</option>{people.filter((p) => p.id !== session?.user.user_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.emailMasked ? ' · address hidden' : ''}</option>)}
              </Select></Field>
            </div>
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" /></Field>
            <Field label="Body"><Textarea value={body} onChange={(e) => { setBody(e.target.value); }} className="min-h-[220px] font-sans" aria-label="Body" /></Field>
            {emailAi && <p className="text-[11.5px] text-ink-muted">Drafted by AI from this screen's data. Review before sending; masked addresses are left out of the mail app link.</p>}
          </div>
        )}

        {!loading && open === 'meeting' && meeting && (
          <div className="space-y-4">
            <Field label="Title"><Input value={mTitle} onChange={(e) => setMTitle(e.target.value)} aria-label="Meeting title" disabled={isClient} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[12.5px] font-medium text-ink-soft">When</p>
                <div className="space-y-1.5" role="radiogroup" aria-label="Meeting time">
                  {(slots.length ? slots.map((s) => s.label) : meeting.suggestedSlots).map((s, i) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 text-[13px]">
                      <input type="radio" name="slot" checked={slot === String(i)} onChange={() => setSlot(String(i))} className="accent-[#5B3FD0]" /> {s}
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input type="radio" name="slot" checked={slot === 'custom'} onChange={() => setSlot('custom')} className="accent-[#5B3FD0]" /> Custom date and time
                  </label>
                  {slot === 'custom' && (
                    <div className="ml-6 flex gap-2">
                      <Input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} aria-label="Meeting date" />
                      <Input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} aria-label="Meeting time of day" />
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1 text-[13px]">
                    <span className="text-ink-muted">Duration</span>
                    <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duration" className="w-28">
                      {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
                    </Select>
                  </div>
                </div>
                <div className="mt-3">
                  {link ? (
                    <div className="rounded-md border border-piku/30 bg-piku-soft/50 px-2.5 py-2 text-[12.5px]" data-testid="meeting-link">
                      <div className="flex items-center gap-1.5"><Link2 size={13} className="text-piku" /><span className="num break-all">{link}</span></div>
                      <p className="mt-0.5 text-[11px] text-ink-muted">Demo link (fictional) - not a real meeting room.</p>
                    </div>
                  ) : <Button size="sm" icon={<Link2 size={13} />} onClick={() => setLink(`https://meet.example.com/dsh-${randomId()}`)}>Create meeting link</Button>}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[12.5px] font-medium text-ink-soft">Attendees {isClient && <span className="font-normal text-ink-muted">(the PwC team adds internal people)</span>}</p>
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-line p-1.5" aria-label="Attendees">
                  {people.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-sunken">
                        <input type="checkbox" className="mt-0.5 accent-[#5B3FD0]" checked={invitees.has(p.id)} disabled={isClient}
                          onChange={(e) => setInvitees((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} aria-label={`Invite ${p.name}`} />
                        <span className="min-w-0"><span className="font-medium">{p.name}</span>
                          <span className="block truncate text-[11.5px] text-ink-muted">{[p.side === 'PwC' || (p.kind === 'team' && !p.side) ? 'PwC team' : p.side ? `${p.side}${p.kind === 'contact' && p.side !== 'Client' ? ' contact' : ''}` : '', p.role, p.org && p.kind === 'contact' && p.org !== p.side ? p.org : ''].filter(Boolean).join(' · ')}{p.email ? ` · ${p.email}` : ''}</span></span>
                      </label>
                    </li>
                  ))}
                  {!people.length && <li className="px-1.5 py-1 text-[12.5px] text-ink-muted">No people available.</li>}
                </ul>
                {meeting.attendees.length > 0 && <p className="mt-1 text-[11.5px] text-ink-muted">Suggested: owners of the open, blocked, overdue and next-step tasks on the agenda.</p>}
              </div>
            </div>
            <Field label="Agenda (one item per line)"><Textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} className="min-h-[140px]" aria-label="Agenda" disabled={isClient} /></Field>
            {isClient && <p className="text-[12px] text-ink-muted">The client view is read-only: you can copy the invite or download the calendar file, but not save it to the project log.</p>}
          </div>
        )}

        {!loading && open === 'call' && call && (
          <div className="space-y-3 text-sm">
            <p className="text-ink">{call.summary}</p>
            {!!call.risks.length && <div><p className="text-xs font-semibold text-rose">Raise on the call</p><ul className="list-disc pl-5 text-ink-soft">{call.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
            {!!call.nextSteps.length && <div><p className="text-xs font-semibold text-blue">Agree</p><ul className="list-disc pl-5 text-ink-soft">{call.nextSteps.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
            {!isClient && (
              <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
                <Field label="Who are you calling?">
                  <Select value={callee} onChange={(e) => setCallee(e.target.value)} aria-label="Who are you calling">
                    <option value="">Not specified</option>
                    {people.filter((p) => p.id !== session?.user.user_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.side ? ` (${p.side})` : ''}</option>)}
                  </Select>
                </Field>
                <div className="self-end text-[13px]">
                  {callPerson?.phone ? (callPerson.phoneMasked
                    ? <span className="inline-flex items-center gap-1 text-ink-muted"><Phone size={13} /> {callPerson.phone} (number hidden for your role)</span>
                    : <a className="link inline-flex items-center gap-1" href={`tel:${callPerson.phone.replace(/\s/g, '')}`}><Phone size={13} /> Call {callPerson.phone}</a>)
                    : <span className="text-ink-muted">No phone number on record.</span>}
                </div>
                <Field label="Outcome">
                  <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Call outcome">
                    {['Connected - next steps agreed', 'Connected - follow-up needed', 'Left voicemail', 'No answer', 'Rescheduled'].map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Duration (min)"><Input type="number" min={0} max={600} value={callMin} onChange={(e) => setCallMin(Number(e.target.value) || 0)} aria-label="Call duration" /></Field>
                <Field label="Notes" className="sm:col-span-2"><Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} placeholder="What was agreed, by whom, by when" aria-label="Call notes" /></Field>
              </div>
            )}
          </div>
        )}
        {!loading && !error && open && (
          <button type="button" onClick={regen} className="mt-3 inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-piku"><Sparkles size={12} /> Regenerate with AI</button>
        )}
        {!loading && open === 'meeting' && !meeting && !error && <p className="text-[13px] text-ink-muted">No suggestion yet.</p>}
      </Modal>
    </div>
  );
}
