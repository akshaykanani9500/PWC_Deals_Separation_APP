/**
 * "Get AI suggestion" button used inside edit side panels (Agent 3 owns this folder; Agent 2 uses it).
 * Calls POST /api/ai/suggest with `request`, shows the rationale + sources, and passes the draft to `onApply`.
 * The parent form decides how to merge the draft (user can still edit before saving).
 */
import { useState } from 'react';
import { Check, Loader2, Sparkles, X, AlertTriangle } from 'lucide-react';
import type { SuggestRequest, SuggestResponse } from '@shared/types';
import { post } from '../../lib/api';

export interface AiSuggestButtonProps {
  request: SuggestRequest;
  onApply: (draft: SuggestResponse['draft'], response: SuggestResponse) => void;
  label?: string;
  disabled?: boolean;
}

function DraftPreview({ draft }: { draft: SuggestResponse['draft'] }) {
  if (Array.isArray(draft)) {
    if (!draft.length) return <p className="text-xs text-ink-muted">Nothing new to add.</p>;
    return (
      <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-xs text-ink-soft">
        {draft.map((row, i) => {
          const r = row as Record<string, any>;
          const children = (r.activities ?? r.tasks) as any[] | undefined;
          return (
            <li key={i} className="rounded-md bg-surface px-2 py-1">
              <span className="font-medium text-ink">{r.name ?? r.title}</span>
              {r.priority && <span className="ml-1 text-ink-muted">· {r.priority}</span>}
              {r.day1_critical === 'Y' && <span className="ml-1 rounded bg-rose-soft px-1 text-[10px] font-semibold text-rose">Day-1</span>}
              {!!children?.length && <span className="ml-1 text-ink-muted">· {children.length} {r.activities ? 'activities' : 'tasks'}</span>}
            </li>
          );
        })}
      </ul>
    );
  }
  const d = draft as Record<string, any>;
  if (Array.isArray(d.stages)) {
    return (
      <ul className="max-h-48 space-y-1 overflow-y-auto pr-1 text-xs text-ink-soft">
        {d.stages.map((s: any, i: number) => (
          <li key={i} className="rounded-md bg-surface px-2 py-1"><span className="font-medium text-ink">{s.name}</span> · {s.activities?.length ?? 0} activities, {s.activities?.reduce((n: number, a: any) => n + (a.tasks?.length ?? 0), 0) ?? 0} tasks</li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return <p className="text-xs text-ink-muted">No changes suggested.</p>;
  return (
    <dl className="space-y-1 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-md bg-surface px-2 py-1">
          <dt className="text-[10px] uppercase tracking-wider text-ink-muted">{k.replace(/_/g, ' ')}</dt>
          <dd className="text-ink">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AiSuggestButton({ request, onApply, label = 'Get AI suggestion', disabled }: AiSuggestButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SuggestResponse | null>(null);

  const run = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      setResult(await post<SuggestResponse>('/ai/suggest', request));
    } catch (e: any) {
      setError(e?.message || 'Could not get a suggestion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full" data-testid="ai-suggest">
      <button type="button" onClick={run} disabled={disabled || loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-piku/30 bg-piku-soft px-3 py-1.5 text-sm font-medium text-piku transition hover:bg-piku hover:text-white disabled:opacity-50">
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {loading ? 'Thinking...' : label}
      </button>

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose-soft px-3 py-2 text-xs text-rose">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {result && (
        <div className="mt-2 rounded-xl border border-piku/25 bg-piku-soft/60 p-3" data-testid="ai-suggest-result">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-piku">
            <Sparkles size={13} /> AI suggestion
            <span className="ml-auto text-[10px] font-normal uppercase tracking-wider text-ink-muted">AI-generated · {result.mode === 'offline' ? 'offline engine' : result.mode}</span>
          </div>
          <p className="mb-2 text-xs text-ink-soft">{result.rationale}</p>
          <DraftPreview draft={result.draft} />
          {!!result.sources.length && (
            <p className="mt-2 text-[11px] text-ink-muted">Based on: {result.sources.map((s) => s.label).join(' · ')}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => { onApply(result.draft, result); setResult(null); }}
              className="inline-flex items-center gap-1 rounded-lg bg-piku px-3 py-1.5 text-xs font-semibold text-white hover:bg-piku/90" data-testid="ai-suggest-apply">
              <Check size={13} /> Apply suggestion
            </button>
            <button type="button" onClick={() => setResult(null)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-sunken">
              <X size={13} /> Dismiss
            </button>
          </div>
          <p className="mt-2 text-[10px] text-ink-muted">Review before saving - nothing is saved until you press Save.</p>
        </div>
      )}
    </div>
  );
}
