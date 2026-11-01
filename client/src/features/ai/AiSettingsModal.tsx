/**
 * AI settings dialog (v1.1) - paste a Google AI Studio (Gemini) key in the UI, test it, pick a model,
 * save. Same flow as the course simulations. Once saved, every AI feature (Piku, suggestions, summaries,
 * email/meeting drafts, close-out lessons) uses it immediately.
 * The key stays in this browser's localStorage and is sent only to this app's own server (x-ai-key header).
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardPaste, ExternalLink, Eye, EyeOff, KeyRound, Loader2, Trash2, X, XCircle, Server } from 'lucide-react';
import clsx from 'clsx';
import { getAiSettings, post, setAiSettings } from '../../lib/api';
import { refreshAiStatus, useAiStatus } from './AiStatusButton';

const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
/** Models Google has shut down: never offer them, even if an old setting saved one. */
const RETIRED = /^(gemini-1\.0|gemini-1\.5|gemini-pro$|gemini-2\.0)/i;
const KEY_RE = /^[A-Za-z0-9._-]{20,200}$/;

interface TestResult { ok: boolean; model?: string; latencyMs: number; error?: string; availableModels?: string[]; tried?: { model: string; result: string }[] }
interface ModelsResult { models: { name: string; displayName: string }[]; source: 'google' | 'default' }

export default function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const saved = getAiSettings();
  const { status } = useAiStatus();
  const [key, setKey] = useState(saved.key);
  const [model, setModel] = useState(saved.model && !RETIRED.test(saved.model) ? saved.model : DEFAULT_MODELS[0]);
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<string[]>(DEFAULT_MODELS);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [savedMsg, setSavedMsg] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = key.trim();
  const formatOk = !trimmed || KEY_RE.test(trimmed);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load the model list for the saved/server key on open.
  useEffect(() => { void loadModels(saved.key || undefined); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function loadModels(k?: string) {
    try {
      const r = await post<ModelsResult>('/ai/models', k ? { key: k } : {});
      const names = r.models.map((m) => m.name);
      if (names.length) {
        setModels(names);
        setModel((cur) => (names.includes(cur) ? cur : names.includes(DEFAULT_MODELS[0]) ? DEFAULT_MODELS[0] : names[0]));
      }
    } catch { /* keep defaults */ }
  }

  async function test() {
    setTesting(true); setResult(null); setSavedMsg('');
    try {
      const r = await post<TestResult>('/ai/test-key', { key: trimmed || undefined, model });
      setResult(r);
      if (r.availableModels?.length) setModels(r.availableModels);
      // Switch to the model that actually answered, so "Save & use" stores a working one.
      if (r.ok && r.model) setModel(r.model);
    } catch (e: any) {
      setResult({ ok: false, latencyMs: 0, error: e?.message ?? 'Test failed' });
    } finally { setTesting(false); }
  }

  async function paste() {
    try { const t = await navigator.clipboard.readText(); if (t) { setKey(t.trim()); setResult(null); } } catch { inputRef.current?.focus(); }
  }

  function save() {
    if (!formatOk) return;
    setAiSettings({ key: trimmed || null, model: model || null });
    setSavedMsg(trimmed ? 'Saved. All AI features now use this key.' : 'Saved model choice.');
    void refreshAiStatus();
  }

  function remove() {
    setAiSettings({ key: null, model: null });
    setKey(''); setResult(null);
    setSavedMsg(status?.serverKeyPresent ? 'Key removed. AI now uses the server key from .env.' : 'Key removed. AI now runs in offline mode.');
    void refreshAiStatus();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" data-testid="ai-settings-modal"
        className="w-full max-w-[520px] rounded-xl border border-line bg-surface shadow-pop">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-piku-soft text-piku"><KeyRound size={18} aria-hidden /></span>
            <div>
              <h2 id="ai-settings-title" className="text-[16px] font-semibold text-ink">AI settings</h2>
              <p className="text-[12.5px] text-ink-muted">Use your own Google AI (Gemini) key for Piku and every AI feature.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close AI settings" className="rounded-md p-1.5 text-ink-muted hover:bg-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-piku"><X size={18} /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="ai-key" className="mb-1 block text-[12.5px] font-medium text-ink">Google AI Studio API key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  ref={inputRef} id="ai-key" data-testid="ai-key-input"
                  type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                  value={key} onChange={(e) => { setKey(e.target.value); setResult(null); setSavedMsg(''); }}
                  placeholder="Paste your key here"
                  aria-invalid={!formatOk} aria-describedby="ai-key-help"
                  className={clsx('w-full rounded-lg border bg-surface px-3 py-2 pr-10 font-mono text-[13px] text-ink outline-none focus:ring-2',
                    formatOk ? 'border-line focus:border-piku focus:ring-piku/30' : 'border-rose focus:ring-rose/30')}
                />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-piku">
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <button type="button" onClick={paste} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-soft hover:bg-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-piku">
                <ClipboardPaste size={14} aria-hidden /> Paste
              </button>
            </div>
            <p id="ai-key-help" className={clsx('mt-1 text-[12px]', formatOk ? 'text-ink-muted' : 'text-rose')}>
              {formatOk
                ? <>No key yet? <a className="inline-flex items-center gap-0.5 font-medium text-piku underline underline-offset-2 hover:text-piku/80" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get one free in Google AI Studio <ExternalLink size={11} aria-hidden /></a></>
                : 'That does not look like a Google AI key (letters, digits, dots, dashes; 20+ characters).'}
            </p>
          </div>

          <div>
            <label htmlFor="ai-model" className="mb-1 block text-[12.5px] font-medium text-ink">Model</label>
            <select id="ai-model" data-testid="ai-model-select" value={model} onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-piku focus:ring-2 focus:ring-piku/30">
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="mt-1 text-[12px] text-ink-muted">This list comes from Google for your key. If the chosen model is busy or not allowed, the app automatically uses the next one that works.</p>
          </div>

          {result && (
            <div role="status" data-testid="ai-test-result"
              className={clsx('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]', result.ok ? 'border-green/30 bg-green-soft text-green' : 'border-rose/30 bg-rose-soft text-rose')}>
              {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden /> : <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}
              <div className="min-w-0">
                <p>{result.ok
                  ? <>Key works. <b>{result.model}</b> answered in {(result.latencyMs / 1000).toFixed(1)}s{model === result.model ? ' and is now selected' : ''}. Press <b>Save &amp; use</b>.</>
                  : result.error}</p>
                {result.tried && result.tried.length > 1 && (
                  <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-soft" data-testid="ai-test-tried">
                    {result.tried.map((t) => <li key={t.model}><span className="font-mono">{t.model}</span>: {t.result}</li>)}
                  </ul>
                )}
                {!result.ok && result.availableModels && result.availableModels.length > 0 && (
                  <p className="mt-1.5 text-[12px] text-ink-soft">Models your key can use: {result.availableModels.slice(0, 8).join(', ')}</p>
                )}
              </div>
            </div>
          )}
          {savedMsg && <p role="status" className="text-[13px] font-medium text-green" data-testid="ai-saved-msg">{savedMsg}</p>}

          <div className="space-y-1.5 rounded-lg bg-sunken px-3 py-2.5 text-[12px] text-ink-soft">
            <p>The key is stored only in this browser and is sent only to this app's own server, which calls Google for you. It is never saved in the database, the Google Sheet or the audit log.</p>
            <p className="flex items-center gap-1.5">
              <Server size={13} aria-hidden />
              {status?.serverKeyPresent
                ? 'A server key (.env) also exists. It is used when no key is saved here.'
                : 'No server key in .env. Without a key here, AI runs in offline mode.'}
            </p>
            <p>Currently in use: <b>{status?.source === 'browser' ? 'your key from this dialog' : status?.source === 'server' ? 'the server key (.env)' : 'none (offline mode)'}</b>{status?.lastError ? ` · last error: ${status.lastError}` : ''}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={remove} disabled={!saved.key && !key}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-rose hover:bg-rose-soft disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose">
            <Trash2 size={14} aria-hidden /> Remove key
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={test} disabled={testing || !formatOk || (!trimmed && status?.source === 'none')} data-testid="ai-test-button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-piku">
              {testing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <CheckCircle2 size={14} aria-hidden />} Test key
            </button>
            <button type="button" onClick={save} disabled={!formatOk} data-testid="ai-save-button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-piku px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-piku/90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-piku focus-visible:ring-offset-2">
              Save &amp; use
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
