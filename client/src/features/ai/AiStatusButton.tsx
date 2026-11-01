/**
 * Top-bar AI status pill + `useAiStatus()` hook (v1.1).
 * Shows whether AI runs on Gemini (browser key or server .env key), offline, or has a key problem.
 * Clicking it opens the AI settings dialog where the user pastes a Google AI Studio key - the same
 * pattern as the course simulations. Placed by the app shell: <AiStatusButton />.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { get, getAiSettings, AI_SETTINGS_EVENT } from '../../lib/api';
import AiSettingsModal from './AiSettingsModal';

export interface AiStatusInfo {
  gemini: boolean;
  source: 'browser' | 'server' | 'none';
  serverKeyPresent: boolean;
  models: string[];
  lastModelUsed?: string;
  lastError?: string;
  pausedUntil?: string;
}

export type AiMode = 'gemini' | 'offline' | 'error' | 'loading';

// One shared status for every subscriber (top-bar pill, Piku header, admin page).
let status: AiStatusInfo | null = null;
let loading = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshAiStatus() {
  loading = true; emit();
  try { status = await get<AiStatusInfo>('/ai/status'); } catch { /* signed out or offline: keep last */ }
  loading = false; emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
let snapshot: { status: AiStatusInfo | null; loading: boolean } = { status, loading };
function getSnapshot() {
  if (snapshot.status !== status || snapshot.loading !== loading) snapshot = { status, loading };
  return snapshot;
}

/** Shorten "gemini-2.5-flash" -> "2.5-flash" for the pill. */
export function shortModel(m?: string) { return m ? m.replace(/^gemini-/, '') : ''; }

export function modeOf(s: AiStatusInfo | null): AiMode {
  if (!s) return 'loading';
  if (!s.gemini) return 'offline';
  if (s.pausedUntil || (s.lastError && !s.lastModelUsed)) return 'error';
  return 'gemini';
}

/** Hook for any component that wants to show the AI mode (e.g. Piku's header). */
export function useAiStatus() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (!snapshot.status && !loading) void refreshAiStatus();
    const on = () => void refreshAiStatus();
    window.addEventListener(AI_SETTINGS_EVENT, on);
    return () => window.removeEventListener(AI_SETTINGS_EVENT, on);
  }, []);
  const s = snap.status;
  const mode = modeOf(s);
  const model = s?.lastModelUsed || s?.models?.[0];
  const netIssue = /reach|network|timeout|no answer/i.test(s?.lastError ?? '');
  const label = mode === 'gemini' ? `AI: Gemini · ${shortModel(model)}`
    : mode === 'error' ? (netIssue ? "AI: can't reach Google" : 'AI: key error')
    : mode === 'offline' ? 'AI: Offline'
    : 'AI: …';
  return { mode, label, model, source: s?.source ?? 'none', status: s, refresh: refreshAiStatus };
}

export default function AiStatusButton() {
  const { mode, label, status: s } = useAiStatus();
  const [open, setOpen] = useState(false);
  const hasBrowserKey = !!getAiSettings().key;
  const title = mode === 'gemini'
    ? `AI features use Google Gemini (${s?.source === 'browser' ? 'your key from AI settings' : 'the server key in .env'}). Click to change.`
    : mode === 'error'
      ? `Gemini problem: ${s?.lastError ?? 'key rejected'}. AI answers in offline mode until fixed. Click to open AI settings.`
      : 'AI runs in offline mode. Click to add a Google AI (Gemini) key.';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={`${label}. Open AI settings`}
        data-testid="ai-status-button"
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-piku focus-visible:ring-offset-2',
          mode === 'gemini' && 'border-green/30 bg-green-soft text-green hover:bg-green-soft/70',
          mode === 'error' && 'border-rose/30 bg-rose-soft text-rose hover:bg-rose-soft/70',
          (mode === 'offline' || mode === 'loading') && 'border-line bg-sunken text-ink-soft hover:bg-line/60',
        )}
      >
        <span aria-hidden className={clsx('h-2 w-2 rounded-full', mode === 'gemini' ? 'bg-green' : mode === 'error' ? 'bg-rose' : 'bg-ink-muted')} />
        <Sparkles size={13} aria-hidden />
        <span>{label}</span>
        {mode === 'offline' && !hasBrowserKey && <span className="ml-0.5 rounded bg-piku px-1.5 py-[1px] text-[10.5px] font-semibold text-white">Add key</span>}
      </button>
      {open && <AiSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}
