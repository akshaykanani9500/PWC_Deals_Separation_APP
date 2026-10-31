/**
 * Quick AI actions for a scope: "Draft email", "Schedule meeting", "Call prep". Agent 3 owns; Agent 2 places it.
 */
import { useEffect, useState } from 'react';
import { CalendarClock, Check, Copy, Loader2, Mail, PhoneCall, X } from 'lucide-react';
import type { SummaryResponse } from '@shared/types';
import { post } from '../../lib/api';
import { useSession } from '../../lib/session';

export interface AiActionsProps { scope: 'project' | 'stage' | 'activity' | 'task'; id: string }

type Kind = 'email' | 'meeting' | 'call';
interface EmailDraft { to: string; subject: string; body: string; mode: string }
interface MeetingDraft { title: string; agenda: string[]; attendees: string[]; suggestedSlots: string[]; mode: string }

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  return { copied, copy };
}

export default function AiActions({ scope, id }: AiActionsProps) {
  const { session } = useSession();
  const [open, setOpen] = useState<Kind | null>(null);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState<EmailDraft | null>(null);
  const [meeting, setMeeting] = useState<MeetingDraft | null>(null);
  const [call, setCall] = useState<SummaryResponse | null>(null);
  const { copied, copy } = useCopy();
  const isClient = session?.persona.code === 'CLIENT';

  const run = async (kind: Kind, nextIntent = intent, nextLang = lang) => {
    setLoading(true); setError('');
    try {
      if (kind === 'email') setEmail(await post<EmailDraft>('/ai/draft-email', { scope, id, intent: nextIntent, language: nextLang }));
      if (kind === 'meeting') setMeeting(await post<MeetingDraft>('/ai/meeting', { scope, id, language: nextLang }));
      if (kind === 'call') setCall(await post<SummaryResponse>('/ai/summary', { scope, id, language: nextLang }));
    } catch (e: any) {
      setError(e?.message || 'AI action failed');
    } finally {
      setLoading(false);
    }
  };

  const openKind = (k: Kind) => { setOpen(k); setEmail(null); setMeeting(null); setCall(null); run(k); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-piku/40 hover:text-piku';
  const emailText = email ? `To: ${email.to}\nSubject: ${email.subject}\n\n${email.body}` : '';
  const meetingText = meeting ? `${meeting.title}\nAttendees: ${meeting.attendees.join(', ')}\n\nAgenda:\n${meeting.agenda.map((a) => `- ${a}`).join('\n')}\n\nSlots: ${meeting.suggestedSlots.join(' | ')}` : '';
  const callText = call ? `${call.summary}\n\nAsk about:\n${[...call.risks, ...call.nextSteps].map((a) => `- ${a}`).join('\n')}` : '';
  const mailto = email ? `mailto:${encodeURIComponent(email.to.match(/<([^>]+)>/)?.[1] ?? '')}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}` : '#';
  const mode = email?.mode ?? meeting?.mode ?? call?.mode;

  return (
    <div data-testid="ai-actions">
      <div className="flex flex-wrap gap-2">
        {!isClient && <button type="button" className={btn} onClick={() => openKind('email')}><Mail size={13} /> Draft email</button>}
        <button type="button" className={btn} onClick={() => openKind('meeting')}><CalendarClock size={13} /> Schedule meeting</button>
        <button type="button" className={btn} onClick={() => openKind('call')}><PhoneCall size={13} /> Call prep</button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/30 p-4" onClick={() => setOpen(null)}>
          <div role="dialog" aria-label="AI action" className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              {open === 'email' ? <Mail size={16} className="text-piku" /> : open === 'meeting' ? <CalendarClock size={16} className="text-piku" /> : <PhoneCall size={16} className="text-piku" />}
              <h3 className="text-sm font-semibold text-ink">{open === 'email' ? 'Draft email' : open === 'meeting' ? 'Schedule a meeting' : 'Call prep brief'}</h3>
              <div className="ml-auto flex rounded-lg border border-line p-0.5 text-[11px]">
                {(['en', 'hi'] as const).map((l) => (
                  <button key={l} type="button" onClick={() => { setLang(l); run(open, intent, l); }} className={`rounded-md px-2 py-0.5 ${lang === l ? 'bg-piku text-white' : 'text-ink-soft'}`}>{l === 'en' ? 'EN' : 'हिं'}</button>
                ))}
              </div>
              <button type="button" onClick={() => setOpen(null)} className="rounded-md p-1 text-ink-muted hover:bg-sunken" aria-label="Close"><X size={15} /></button>
            </header>

            <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
              {open === 'email' && (
                <div className="mb-3 flex gap-2">
                  <input value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="Optional: what is the email for? e.g. chase overdue items, update the client"
                    className="flex-1 rounded-lg border border-line bg-sunken px-2.5 py-1.5 text-xs focus:border-piku focus:outline-none" />
                  <button type="button" onClick={() => run('email')} className="rounded-lg bg-piku px-3 text-xs font-semibold text-white">Redraft</button>
                </div>
              )}
              {loading && <div className="flex items-center gap-2 py-6 text-sm text-ink-muted"><Loader2 size={16} className="animate-spin text-piku" /> Drafting from the project data...</div>}
              {error && <p className="text-sm text-rose">{error}</p>}

              {!loading && email && open === 'email' && (
                <div className="space-y-2 text-sm">
                  <p><span className="text-ink-muted">To:</span> {email.to}</p>
                  <p><span className="text-ink-muted">Subject:</span> <span className="font-medium text-ink">{email.subject}</span></p>
                  <pre className="whitespace-pre-wrap rounded-lg bg-sunken p-3 font-sans text-sm text-ink-soft">{email.body}</pre>
                </div>
              )}
              {!loading && meeting && open === 'meeting' && (
                <div className="space-y-3 text-sm">
                  <p className="font-medium text-ink">{meeting.title}</p>
                  <div><p className="text-xs text-ink-muted">Attendees</p><p className="text-ink-soft">{meeting.attendees.join(', ')}</p></div>
                  <div><p className="text-xs text-ink-muted">Agenda</p><ol className="list-decimal space-y-0.5 pl-5 text-ink-soft">{meeting.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol></div>
                  <div><p className="mb-1 text-xs text-ink-muted">Suggested slots</p><div className="flex flex-wrap gap-1.5">{meeting.suggestedSlots.map((s) => <span key={s} className="rounded-md border border-piku/30 bg-piku-soft px-2 py-0.5 text-xs text-piku">{s}</span>)}</div></div>
                </div>
              )}
              {!loading && call && open === 'call' && (
                <div className="space-y-2 text-sm">
                  <p className="text-ink">{call.summary}</p>
                  {!!call.risks.length && <div><p className="text-xs font-semibold text-rose">Raise on the call</p><ul className="list-disc pl-5 text-ink-soft">{call.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
                  {!!call.nextSteps.length && <div><p className="text-xs font-semibold text-blue">Agree</p><ul className="list-disc pl-5 text-ink-soft">{call.nextSteps.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
                </div>
              )}
            </div>

            <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
              <span className="text-[10px] uppercase tracking-wider text-ink-muted">{mode ? `AI-generated · ${mode === 'offline' ? 'offline engine' : mode}` : ''}</span>
              <div className="ml-auto flex gap-2">
                <button type="button" disabled={loading} onClick={() => copy(open === 'email' ? emailText : open === 'meeting' ? meetingText : callText)} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-sunken disabled:opacity-40">
                  {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
                </button>
                {open === 'email' && email && (
                  <a href={mailto} className="inline-flex items-center gap-1 rounded-lg bg-piku px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4d33bd]"><Mail size={13} /> Open in mail</a>
                )}
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
