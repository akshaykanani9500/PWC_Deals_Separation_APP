/**
 * Piku - floating AI chat bubble (Agent 3 owns this folder).
 * Mounted ONCE by the app layout for signed-in users: <Piku />.
 * Reads the current page context (project/stage/activity/task) from the URL itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Mic, MicOff, Send, Square, Trash2, Volume2, VolumeX, X, ExternalLink } from 'lucide-react';
import type { ChatMessage, PikuContextType, PikuRequest, PikuResponse } from '@shared/types';
import { useSession } from '../../lib/session';
import { get, post } from '../../lib/api';
import RichText from '../ai/RichText';
import { useAiStatus } from '../ai/AiStatusButton';
import PikuMascot from './PikuMascot';
import { listen, looksHindi, speak, speechRecognitionSupported, speechSynthesisSupported, stopSpeaking, type Listener } from './voice';

type LangMode = 'auto' | 'en' | 'hi';

interface Msg {
  id: string;
  sender: 'user' | 'piku';
  body: string;
  mode?: string;
  sources?: PikuResponse['sources'];
  suggestedActions?: PikuResponse['suggestedActions'];
  error?: boolean;
}

interface PageContext { type: PikuContextType; projectId?: string; stageId?: string; activityId?: string; taskId?: string }

const LS_LANG = 'dsh.piku.lang';
const LS_SPEAK = 'dsh.piku.speak';
const LS_HEIGHT = 'dsh.piku.height';
const readLS = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function usePageContext(): PageContext {
  const { pathname, search } = useLocation();
  return useMemo(() => {
    const task = new URLSearchParams(search).get('task') ?? undefined;
    const a = matchPath('/projects/:projectId/stages/:stageId/activities/:activityId/*', pathname) ?? matchPath('/projects/:projectId/stages/:stageId/activities/:activityId', pathname);
    if (a) return { type: task ? 'task' : 'activity', projectId: a.params.projectId, stageId: a.params.stageId, activityId: a.params.activityId, taskId: task } as PageContext;
    const s = matchPath('/projects/:projectId/stages/:stageId/*', pathname) ?? matchPath('/projects/:projectId/stages/:stageId', pathname);
    if (s) return { type: task ? 'task' : 'stage', projectId: s.params.projectId, stageId: s.params.stageId, taskId: task } as PageContext;
    const p = matchPath('/projects/:projectId/*', pathname) ?? matchPath('/projects/:projectId', pathname);
    if (p) return { type: task ? 'task' : 'project', projectId: p.params.projectId, taskId: task } as PageContext;
    return { type: 'global' };
  }, [pathname, search]);
}

const contextId = (c: PageContext) => c.taskId ?? c.activityId ?? c.stageId ?? c.projectId ?? '';

/** Readable name for the context chip (fetched through the normal permission-checked API). */
function useContextLabel(ctx: PageContext): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    let alive = true;
    setLabel('');
    const load = async () => {
      try {
        if (ctx.type === 'task' && ctx.taskId) { const d = await get<any>(`/tasks/${ctx.taskId}`); return d?.task?.title; }
        if (ctx.type === 'activity' && ctx.activityId) { const d = await get<any>(`/activities/${ctx.activityId}`); return d?.activity?.name; }
        if (ctx.type === 'stage' && ctx.stageId) { const d = await get<any>(`/stages/${ctx.stageId}`); return d?.stage?.name; }
        if (ctx.type === 'project' && ctx.projectId) { const d = await get<any>(`/projects/${ctx.projectId}`); return d?.project?.code_name; }
      } catch { /* ignore */ }
      return '';
    };
    if (ctx.type !== 'global') load().then((l) => alive && setLabel(l || ''));
    return () => { alive = false; };
  }, [ctx.type, ctx.taskId, ctx.activityId, ctx.stageId, ctx.projectId]);
  return label;
}

const STARTERS: Record<PikuContextType, { en: string[]; hi: string[] }> = {
  global: { en: ['Which projects are at risk?', 'What are my tasks?', 'What is a TSA?'], hi: ['कौन से प्रोजेक्ट जोखिम में हैं?', 'मेरे टास्क क्या हैं?', 'TSA क्या होता है?'] },
  project: { en: ['What is the status of this project?', 'What is overdue here?', 'Summarise this project'], hi: ['इस प्रोजेक्ट का स्टेटस बताओ', 'यहाँ क्या देरी में है?', 'इस प्रोजेक्ट का सारांश दो'] },
  stage: { en: ['How is this stage going?', 'What is blocked here?', 'Who owns the open items?'], hi: ['यह चरण कैसा चल रहा है?', 'यहाँ क्या रुका हुआ है?', 'खुले काम किसके पास हैं?'] },
  activity: { en: ['Summarise this activity', 'What is overdue here?', 'Draft a status email'], hi: ['इस गतिविधि का सारांश दो', 'यहाँ क्या देरी में है?', 'स्टेटस ईमेल का ड्राफ्ट बनाओ'] },
  task: { en: ['What is pending on this task?', 'Who should I contact?', 'Draft a follow-up email'], hi: ['इस टास्क में क्या बाकी है?', 'मुझे किससे बात करनी चाहिए?', 'फ़ॉलो-अप ईमेल लिखो'] },
};

export default function Piku() {
  const { session, can } = useSession();
  if (!session || !can('piku.use')) return null;
  return <PikuInner firstName={session.user.full_name.split(' ')[0]} />;
}

function PikuInner({ firstName }: { firstName: string }) {
  const navigate = useNavigate();
  const ctx = usePageContext();
  const ctxLabel = useContextLabel(ctx);
  const [open, setOpen] = useState(false);
  const [langMode, setLangMode] = useState<LangMode>(() => (readLS(LS_LANG, 'auto') as LangMode));
  const [speakOn, setSpeakOn] = useState(() => readLS(LS_SPEAK, 'off') === 'on');
  const [height, setHeight] = useState(() => Number(readLS(LS_HEIGHT, '560')) || 560);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listenerRef = useRef<Listener | null>(null);
  const historyKey = `${ctx.type}:${contextId(ctx)}`;
  const loadedKey = useRef<string>('');

  useEffect(() => writeLS(LS_LANG, langMode), [langMode]);
  useEffect(() => writeLS(LS_SPEAK, speakOn ? 'on' : 'off'), [speakOn]);
  useEffect(() => writeLS(LS_HEIGHT, String(height)), [height]);

  // Load this context's history when the panel opens or the page changes.
  useEffect(() => {
    if (!open || loadedKey.current === historyKey) return;
    loadedKey.current = historyKey;
    const q = new URLSearchParams({ contextType: ctx.type, contextId: contextId(ctx), limit: '40' });
    get<ChatMessage[]>(`/ai/piku/history?${q}`)
      .then((rows) => setMessages(rows.map((r) => ({
        id: r.message_id, sender: r.sender, body: r.body, mode: r.ai_mode,
        sources: (() => { try { return r.sources ? JSON.parse(r.sources) : undefined; } catch { return undefined; } })(),
      }))))
      .catch(() => setMessages([]));
  }, [open, historyKey, ctx]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => () => { listenerRef.current?.stop(); stopSpeaking(); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setVoiceNote('');
    const userMsg: Msg = { id: `u${Date.now()}`, sender: 'user', body: message };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    try {
      const req: PikuRequest = { message, language: langMode, context: ctx };
      const res = await post<PikuResponse>('/ai/piku', req);
      setMessages((m) => [...m, { id: `p${Date.now()}`, sender: 'piku', body: res.answer, mode: res.mode, sources: res.sources, suggestedActions: res.suggestedActions }]);
      if (speakOn && speechSynthesisSupported()) {
        setSpeaking(true);
        speak(res.answer, res.language === 'hi' || looksHindi(res.answer) ? 'hi' : 'en', () => setSpeaking(false));
      }
    } catch (e: any) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, sender: 'piku', body: e?.message || 'Sorry, something went wrong. Please try again.', error: true }]);
    } finally {
      setBusy(false);
    }
  }, [busy, langMode, ctx, speakOn]);

  const toggleMic = () => {
    if (listening) { listenerRef.current?.stop(); return; }
    if (!speechRecognitionSupported()) { setVoiceNote('Voice input needs Chrome or Edge. You can still type.'); return; }
    stopSpeaking(); setSpeaking(false);
    setVoiceNote(langMode === 'hi' ? 'सुन रहा हूँ... बोलिए' : 'Listening... speak now');
    const l = listen(langMode === 'hi' ? 'hi' : 'en', (t) => setInput(t), (finalText, err) => {
      setListening(false);
      listenerRef.current = null;
      if (err && !finalText) { setVoiceNote(err); return; }
      setVoiceNote('');
      if (finalText) send(finalText);
    });
    if (!l) { setVoiceNote('Could not start the microphone.'); return; }
    listenerRef.current = l;
    setListening(true);
  };

  // drag the top edge to resize the panel height
  const dragStart = (e: RPointerEvent<HTMLDivElement>) => {
    const startY = e.clientY; const startH = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(360, Math.min(window.innerHeight - 120, startH + (startY - ev.clientY))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const starters = STARTERS[ctx.type][langMode === 'hi' ? 'hi' : 'en'];
  const chip = ctx.type === 'global' ? 'All my projects' : `${ctx.type[0].toUpperCase()}${ctx.type.slice(1)}${ctxLabel ? `: ${ctxLabel}` : ''}`;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Piku, the AI assistant"
          data-testid="piku-bubble"
          className="piku-bubble group fixed bottom-6 right-6 z-[70] flex items-center gap-2 rounded-full bg-piku py-2 pl-2 pr-4 text-white shadow-pop ring-4 ring-piku-soft transition hover:-translate-y-0.5 hover:bg-piku/90 focus:outline-none focus-visible:ring-brand-ring"
        >
          <span className="rounded-full bg-white/15 p-0.5"><PikuMascot size={36} /></span>
          <span className="text-sm font-semibold tracking-wide">Ask Piku</span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Piku AI assistant"
          data-testid="piku-panel"
          style={{ height }}
          className="fixed bottom-4 right-4 z-[70] flex w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        >
          <div onPointerDown={dragStart} className="h-1.5 w-full cursor-ns-resize bg-piku-soft/60 hover:bg-piku-soft" title="Drag to resize" />
          {/* header */}
          <header className="flex items-center gap-3 border-b border-line bg-gradient-to-r from-piku-soft to-surface px-4 py-3">
            <PikuMascot size={36} mood={busy ? 'thinking' : listening ? 'listening' : 'happy'} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">Piku</h2>
                <span className="rounded-full bg-piku px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">AI</span>
              </div>
              <p className="truncate text-xs text-ink-muted" title={chip}>Asking about <span className="font-medium text-ink-soft">{chip}</span></p>
              <PikuMode />
            </div>
            <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 text-[11px] font-medium" role="group" aria-label="Answer language">
              {(['auto', 'en', 'hi'] as LangMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setLangMode(m)}
                  className={`rounded-md px-1.5 py-1 ${langMode === m ? 'bg-piku text-white' : 'text-ink-soft hover:bg-sunken'}`}>
                  {m === 'auto' ? 'Auto' : m === 'en' ? 'EN' : 'हिं'}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setSpeakOn((s) => !s); if (speakOn) { stopSpeaking(); setSpeaking(false); } }}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-sunken" aria-pressed={speakOn}
              title={speakOn ? 'Stop reading answers aloud' : 'Read answers aloud'}>
              {speakOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-ink-soft hover:bg-sunken" aria-label="Close Piku"><X size={16} /></button>
          </header>

          {/* messages */}
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-canvas/60 px-4 py-4">
            {messages.length === 0 && !busy && (
              <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <p className="text-sm text-ink">
                  {langMode === 'hi' ? `नमस्ते ${firstName}! मैं पीकू हूँ।` : `Hi ${firstName}! I'm Piku.`}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {langMode === 'hi'
                    ? 'स्टेटस, देरी, ज़िम्मेदार, TSA, सारांश या ईमेल ड्राफ्ट - कुछ भी पूछें। मैं सिर्फ़ वही डेटा देखता हूँ जो आपकी भूमिका देख सकती है।'
                    : 'Ask about status, overdue work, owners, TSA, summaries or email drafts - type or use the mic. I only use data your role can see.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {starters.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-piku/30 bg-piku-soft px-3 py-1 text-xs font-medium text-piku hover:bg-piku hover:text-white">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.sender === 'user' ? (
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-white">{m.body}</div>
                ) : (
                  <div data-testid="piku-answer" className={`max-w-[92%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 shadow-card ${m.error ? 'border-rose/30 bg-rose-soft' : 'border-line bg-surface'}`}>
                    <RichText text={m.body} />
                    {!!m.sources?.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.sources.map((s, i) => (
                          <button key={`${s.type}${s.id}`} type="button" disabled={!s.href} data-testid="piku-source" data-href={s.href ?? ''}
                            onClick={() => s.href && navigate(s.href)}
                            className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-sunken px-1.5 py-0.5 text-[11px] text-ink-soft hover:border-piku/40 hover:text-piku disabled:cursor-default"
                            title={s.label}>
                            <span className="font-semibold text-piku">{i + 1}</span>
                            <span className="max-w-[160px] truncate">{s.label}</span>
                            {s.href && <ExternalLink size={10} />}
                          </button>
                        ))}
                      </div>
                    )}
                    {!m.error && (
                      <p className="mt-1.5 text-[10px] uppercase tracking-wider text-ink-muted">AI-generated · {m.mode === 'offline' || !m.mode ? 'offline engine' : m.mode}</p>
                    )}
                    {idx === messages.length - 1 && !!m.suggestedActions?.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.suggestedActions.map((a) => (
                          <button key={a.label} type="button" onClick={() => (a.prompt ? send(a.prompt) : a.href && navigate(a.href))}
                            className="rounded-full border border-piku/30 px-2.5 py-0.5 text-[11px] font-medium text-piku hover:bg-piku-soft">{a.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-xs text-ink-muted" data-testid="piku-typing">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-piku" style={{ animationDelay: `${i * 120}ms` }} />)}
                </span>
                {langMode === 'hi' ? 'पीकू सोच रहा है...' : 'Piku is checking your data...'}
              </div>
            )}
          </div>

          {/* composer */}
          <footer className="border-t border-line bg-surface p-3">
            {(voiceNote || speaking) && (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-piku-soft px-2.5 py-1.5 text-xs text-piku">
                <span>{speaking ? (langMode === 'hi' ? 'पढ़ रहा हूँ...' : 'Reading the answer aloud...') : voiceNote}</span>
                {speaking && (
                  <button type="button" onClick={() => { stopSpeaking(); setSpeaking(false); }} className="inline-flex items-center gap-1 font-semibold"><Square size={11} /> Stop</button>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button type="button" onClick={toggleMic} aria-pressed={listening}
                className={`shrink-0 rounded-xl border p-2.5 ${listening ? 'animate-pulse border-rose bg-rose text-white' : 'border-line text-ink-soft hover:border-piku/40 hover:text-piku'}`}
                title={listening ? 'Stop listening' : `Speak (${langMode === 'hi' ? 'Hindi' : 'English'})`} aria-label="Voice input">
                {listening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder={langMode === 'hi' ? 'पीकू से पूछें...' : 'Ask Piku anything about your deals...'}
                aria-label="Message Piku"
                data-testid="piku-input"
                className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-sunken px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted focus:border-piku focus:bg-surface focus:outline-none"
              />
              <button type="button" onClick={() => send(input)} disabled={!input.trim() || busy}
                className="shrink-0 rounded-xl bg-piku p-2.5 text-white hover:bg-piku/90 disabled:opacity-40" aria-label="Send" data-testid="piku-send">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-muted">
              <span>Enter to send · Shift+Enter new line · Esc to close</span>
              {messages.length > 0 && (
                <button type="button" onClick={() => setMessages([])} className="inline-flex items-center gap-1 hover:text-rose"><Trash2 size={10} /> Clear view</button>
              )}
            </div>
          </footer>
        </section>
      )}
    </>
  );
}

/** Small line under the Piku title showing whether answers come from Gemini or the offline engine. */
function PikuMode() {
  const { mode, label } = useAiStatus();
  return (
    <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-ink-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${mode === 'gemini' ? 'bg-green' : mode === 'error' ? 'bg-rose' : 'bg-ink-muted'}`} aria-hidden />
      {label.replace(/^AI: /, '')}
    </p>
  );
}
