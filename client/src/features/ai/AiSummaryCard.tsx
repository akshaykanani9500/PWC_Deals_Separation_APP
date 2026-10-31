/**
 * AI summary card for the right-hand panel (summary of chat/email/call history for a scope).
 * Agent 3 owns; Agent 2 places it: <AiSummaryCard scope="activity" id={activityId} />
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { SummaryResponse } from '@shared/types';
import { post } from '../../lib/api';

export interface AiSummaryCardProps { scope: 'project' | 'stage' | 'activity' | 'task'; id: string; compact?: boolean }

const cache = new Map<string, SummaryResponse>();

export default function AiSummaryCard({ scope, id, compact }: AiSummaryCardProps) {
  const key = `${scope}:${id}`;
  const [data, setData] = useState<SummaryResponse | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false) => {
    if (!id) return;
    if (!force && cache.has(key)) { setData(cache.get(key)!); return; }
    setLoading(true); setError('');
    try {
      const r = await post<SummaryResponse>('/ai/summary', { scope, id });
      cache.set(key, r);
      setData(r);
    } catch (e: any) {
      setError(e?.message || 'Summary unavailable');
    } finally {
      setLoading(false);
    }
  }, [scope, id, key]);

  useEffect(() => { setData(cache.get(key) ?? null); load(); }, [key, load]);

  const Section = ({ title, items, tone }: { title: string; items: string[]; tone: string }) =>
    items.length ? (
      <div>
        <h4 className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>{title}</h4>
        <ul className="space-y-1">
          {items.map((x, i) => <li key={i} className="flex gap-1.5 text-xs leading-snug text-ink-soft"><span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${tone.replace('text-', 'bg-')}`} />{x}</li>)}
        </ul>
      </div>
    ) : null;

  return (
    <div className="rounded-xl border border-piku/20 bg-surface p-3 shadow-card" data-testid="ai-summary">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles size={14} className="text-piku" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">AI summary</h3>
        <button type="button" onClick={() => load(true)} disabled={loading} className="ml-auto rounded-md p-1 text-ink-muted hover:bg-sunken hover:text-piku" title="Refresh summary" aria-label="Refresh summary">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      {error && <p className="text-xs text-rose">{error}</p>}
      {!data && loading && (
        <div className="space-y-1.5">
          {[90, 75, 82].map((w) => <div key={w} className="h-2.5 animate-pulse rounded bg-sunken" style={{ width: `${w}%` }} />)}
        </div>
      )}
      {data && (
        <div className="space-y-2.5">
          <p className="text-sm leading-relaxed text-ink">{data.summary}</p>
          {!compact && <Section title="Highlights" items={data.highlights} tone="text-green" />}
          <Section title="Risks" items={data.risks} tone="text-rose" />
          {!compact && <Section title="Next steps" items={data.nextSteps} tone="text-blue" />}
          <p className="text-[10px] uppercase tracking-wider text-ink-muted">AI-generated · {data.mode === 'offline' ? 'offline engine' : data.mode}</p>
        </div>
      )}
    </div>
  );
}
