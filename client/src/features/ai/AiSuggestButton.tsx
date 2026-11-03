/**
 * "Get AI suggestion" button used inside edit side panels.
 * Calls POST /api/ai/suggest with `request` (which carries ALL current form values), shows the 2-3 alternative
 * options as selectable cards (rationale, what came from your inputs, deduplicated sources, preview), and passes
 * the chosen option's draft to `onApply`. The parent form decides how to merge it; nothing is saved until Save.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { Check, Loader2, Sparkles, X, AlertTriangle, Star } from 'lucide-react';
import type { SuggestOption, SuggestRequest, SuggestResponse } from '@shared/types';
import { post } from '../../lib/api';
import { useToast } from '../../components/toast';

export interface AiSuggestButtonProps {
  request: SuggestRequest;
  onApply: (draft: SuggestResponse['draft'], response: SuggestResponse) => void;
  label?: string;
  disabled?: boolean;
  /** Toast shown after Apply (false = none). */
  applyToast?: string | false;
}

const fieldLabel = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function DraftPreview({ draft, reasons }: { draft: SuggestResponse['draft']; reasons?: Record<string, string> }) {
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
              {r.effort_hours != null && <span className="ml-1 text-ink-muted">· {r.effort_hours} h</span>}
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
          <li key={i} className="rounded-md bg-surface px-2 py-1">
            <span className="font-medium text-ink">{s.name}</span> · {s.activities?.length ?? 0} activities, {s.activities?.reduce((n: number, a: any) => n + (a.tasks?.length ?? 0), 0) ?? 0} tasks
            {!!s.activities?.length && <div className="truncate text-[11px] text-ink-muted">{s.activities.map((a: any) => a.name).join(' · ')}</div>}
          </li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  if (!entries.length) return <p className="text-xs text-ink-muted">No changes suggested.</p>;
  return (
    <dl className="max-h-56 space-y-1 overflow-y-auto pr-1 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-md bg-surface px-2 py-1">
          <dt className="text-[10px] uppercase tracking-wider text-ink-muted">{fieldLabel(k)}</dt>
          <dd className="text-ink">{Array.isArray(v) ? <ul className="list-disc pl-4">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ul> : String(v)}</dd>
          {reasons?.[k] && <dd className="text-[11px] text-ink-muted">{reasons[k]}</dd>}
        </div>
      ))}
    </dl>
  );
}

function statLine(o: SuggestOption): string {
  const s = o.stats ?? {};
  const bits: string[] = [];
  if (s.stages) bits.push(`${s.stages} stages`);
  if (s.activities != null) bits.push(`${s.activities} activities`);
  if (s.tasks != null) bits.push(`${s.tasks} tasks`);
  if (s.hours) bits.push(`${s.hours} h`);
  if (!bits.length && s.fields != null) bits.push(`${s.fields} field${s.fields === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

export default function AiSuggestButton({ request, onApply, label = 'Get AI suggestion', disabled, applyToast = 'Suggestion applied — review and press Save' }: AiSuggestButtonProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SuggestResponse | null>(null);
  const [pick, setPick] = useState<string>('');

  const run = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await post<SuggestResponse>('/ai/suggest', request);
      setResult(r);
      setPick(r.recommendedId ?? r.options?.[0]?.id ?? '');
    } catch (e: any) {
      setError(e?.message || 'Could not get a suggestion');
    } finally {
      setLoading(false);
    }
  };

  const options: SuggestOption[] = result?.options?.length ? result.options
    : result ? [{ id: 'default', label: 'Suggestion', rationale: result.rationale, draft: result.draft, sources: result.sources, fromInputs: [] }] : [];
  const chosen = options.find((o) => o.id === pick) ?? options[0];

  const apply = () => {
    if (!result || !chosen) return;
    onApply(chosen.draft, { ...result, draft: chosen.draft, rationale: chosen.rationale, sources: chosen.sources, recommendedId: chosen.id });
    setResult(null);
    if (applyToast) toast.success(applyToast);
  };

  return (
    <div className="w-full" data-testid="ai-suggest">
      <button type="button" onClick={run} disabled={disabled || loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-piku/30 bg-piku-soft px-3 py-1.5 text-sm font-medium text-piku transition hover:bg-piku hover:text-white disabled:opacity-50">
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {loading ? 'Thinking...' : label}
      </button>

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose/30 bg-rose-soft px-3 py-2 text-xs text-rose" role="alert">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {result && chosen && (
        <div className="mt-2 rounded-xl border border-piku/25 bg-piku-soft/60 p-3" data-testid="ai-suggest-result">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-piku">
            <Sparkles size={13} /> AI suggestion{options.length > 1 ? `: ${options.length} options` : ''}
            <span className="ml-auto text-[10px] font-normal uppercase tracking-wider text-ink-muted">AI-generated · {result.mode === 'offline' ? 'offline engine' : result.mode}</span>
          </div>

          {options.length > 1 && (
            <div role="radiogroup" aria-label="Suggestion options" className="mb-2 grid gap-1.5 sm:grid-cols-3">
              {options.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={o.id === chosen.id} onClick={() => setPick(o.id)} data-testid={`ai-option-${o.id}`}
                  className={clsx('rounded-lg border px-2.5 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-piku/50',
                    o.id === chosen.id ? 'border-piku bg-surface shadow-card' : 'border-line bg-surface/60 hover:border-piku/40')}>
                  <span className="flex items-center gap-1 text-[12.5px] font-semibold text-ink">
                    {o.id === chosen.id && <Check size={12} className="text-piku" aria-hidden />}{o.label}
                  </span>
                  {o.recommended && <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-piku-soft px-1 text-[10px] font-medium text-piku"><Star size={9} aria-hidden /> Recommended</span>}
                  {statLine(o) && <span className="mt-0.5 block text-[11px] text-ink-muted">{statLine(o)}</span>}
                </button>
              ))}
            </div>
          )}

          <p className="mb-2 text-xs text-ink-soft">{chosen.rationale}</p>
          {!!chosen.fromInputs?.length && (
            <div className="mb-2 rounded-md border border-piku/20 bg-surface/70 px-2 py-1.5" data-testid="ai-from-inputs">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-piku">From your inputs</p>
              <ul className="mt-0.5 space-y-0.5 text-[11.5px] text-ink-soft">{chosen.fromInputs.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
          <DraftPreview draft={chosen.draft} reasons={chosen.fieldReasons} />
          {!!chosen.sources.length && (
            <p className="mt-2 text-[11px] text-ink-muted">Based on: {chosen.sources.map((s) => s.label).join(' · ')}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={apply}
              className="inline-flex items-center gap-1 rounded-lg bg-piku px-3 py-1.5 text-xs font-semibold text-white hover:bg-piku/90" data-testid="ai-suggest-apply">
              <Check size={13} /> {options.length > 1 ? `Apply "${chosen.label}"` : 'Apply suggestion'}
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
