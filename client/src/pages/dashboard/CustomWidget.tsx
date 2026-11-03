/**
 * v1.4 (C): custom dashboard widgets. A widget is a spec (metric + group by + chart + filter) from the safe catalogue
 * in shared/widgetCatalog.ts; the numbers come from POST /api/dashboard/widget-data (permission-filtered server-side).
 * WidgetBuilder: "Describe it" (AI maps text to a spec, or explains why not and offers alternatives + "Ask the
 * analytics team") and "Build it" (manual dropdowns) with a live preview.
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Loader2, Send, Sparkles, Wand2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ProjectListItem, WidgetData, WidgetSpec, WidgetSuggestResponse } from '@shared/types';
import { PROJECT_STATUS, WORK_STATUS } from '@shared/schema';
import { WIDGET_CHARTS, WIDGET_GROUPS, WIDGET_METRICS, describeSpec, metricDef, specError } from '@shared/widgetCatalog';
import { post } from '../../lib/api';
import { useApi } from '../../hooks/useApi';
import { useSession } from '../../lib/session';
import { money, num } from '../../lib/format';
import { SidePanel } from '../../components/SidePanel';
import { AiLabel, Button, Checkbox, Field, Input, Select, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';
import { CHART, legendText } from './widgets';

const PALETTE = [CHART.blue, CHART.brand, CHART.green, CHART.amber, CHART.piku, CHART.rose, CHART.sand, CHART.soft];
const KNOWN: Record<string, string> = { Red: CHART.rose, Amber: CHART.amber, Green: CHART.green, Blocked: CHART.rose, Done: CHART.green, 'In Progress': CHART.blue, 'Not Started': CHART.sand, Critical: CHART.rose, High: CHART.amber, Medium: CHART.blue, Low: CHART.sand };
const tooltipStyle = { fontSize: 12, borderRadius: 8, border: `1px solid ${CHART.line}` };

/** Default grid size for a chart type. */
export function sizeFor(chart: WidgetSpec['chart']): { w: number; h: number; minW: number; minH: number } {
  if (chart === 'kpi') return { w: 2, h: 2, minW: 2, minH: 2 };
  if (chart === 'table' || chart === 'hbar' || chart === 'line') return { w: 6, h: 5, minW: 3, minH: 3 };
  return { w: 4, h: 5, minW: 3, minH: 3 };
}

function fmt(d: WidgetData, v: number, currency?: string) {
  if (d.unit === 'money') return money(v, currency ?? d.currency);
  if (d.unit === 'percent') return `${Math.round(v)}%`;
  if (d.unit === 'hours') return `${num(Math.round(v))} h`;
  return num(v);
}

export function WidgetView({ data, compact }: { data: WidgetData; compact?: boolean }) {
  const { spec, rows } = data;
  const color = (label: string, i: number) => KNOWN[label] ?? PALETTE[i % PALETTE.length];
  if (spec.chart === 'kpi') {
    return (
      <div className="flex h-full flex-col justify-between p-4">
        <span className="truncate text-[13px] font-medium text-ink-soft">{spec.title}</span>
        {data.byCurrency ? (
          <span className="num flex flex-wrap gap-x-3 text-[18px] font-semibold leading-tight" data-testid="custom-widget-value">
            {data.byCurrency.map((c) => <span key={c.currency}>{fmt(data, c.total, c.currency)}</span>)}
          </span>
        ) : <span className="num text-[28px] font-semibold leading-none" data-testid="custom-widget-value">{fmt(data, data.total)}</span>}
        <span className="truncate text-[12px] text-ink-muted" title={data.note}>{data.byCurrency ? 'Per currency - not added up' : metricDef(spec.metric)?.description}</span>
      </div>
    );
  }
  if (!rows.length) return <p className="text-[12.5px] text-ink-muted">{data.note ?? 'No data for this widget yet.'}</p>;
  if (spec.chart === 'table' || data.byCurrency) {
    // mixed currencies: a table keeps each amount next to its currency (charts would put them on one axis)
    return (
      <>{data.byCurrency && <p className="mb-1 text-[11.5px] text-amber" role="note">{data.note}</p>}<table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[11.5px] text-ink-muted"><th className="py-1 font-medium">{WIDGET_GROUPS.find((g) => g.id === spec.groupBy)?.label.replace(/ \(.*\)$/, '')}</th><th className="py-1 text-right font-medium">{metricDef(spec.metric)?.label}</th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => <tr key={r.key}><td className="truncate py-1 pr-2">{r.label}</td><td className="num py-1 text-right font-medium">{fmt(data, r.value, r.currency)}</td></tr>)}
        </tbody>
        {!compact && !data.byCurrency && <tfoot><tr className="border-t border-line-strong"><td className="py-1 font-medium">Total</td><td className="num py-1 text-right font-semibold">{fmt(data, data.total)}</td></tr></tfoot>}
      </table></>
    );
  }
  const yTick = (v: number) => (data.unit === 'money' ? money(v, data.currency) : String(v));
  if (spec.chart === 'pie') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="label" innerRadius="50%" outerRadius="80%" paddingAngle={2} stroke="none" isAnimationActive={!compact}>
            {rows.map((r, i) => <Cell key={r.key} fill={color(r.label, i)} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(data, v)} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (spec.chart === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.line} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={yTick} width={56} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} allowDecimals={data.unit !== 'count'} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(data, v)} />
          <Line type="monotone" dataKey="value" name={metricDef(spec.metric)?.label} stroke={CHART.brand} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={!compact} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  const horizontal = spec.chart === 'hbar';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: horizontal ? 4 : -12, bottom: 0 }}>
        <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke={CHART.line} />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={yTick} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} allowDecimals={data.unit !== 'count'} />
            <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11.5, fill: CHART.soft }} axisLine={false} tickLine={false} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: CHART.soft }} axisLine={false} tickLine={false} interval={0} />
            <YAxis tickFormatter={yTick} tick={{ fontSize: 11, fill: CHART.muted }} axisLine={false} tickLine={false} allowDecimals={data.unit !== 'count'} />
          </>
        )}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: CHART.track }} formatter={(v: number) => fmt(data, v)} />
        <Bar dataKey="value" name={metricDef(spec.metric)?.label} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 16 : 40} isAnimationActive={!compact}>
          {rows.map((r, i) => <Cell key={r.key} fill={KNOWN[r.label] ?? (spec.groupBy === 'project' || spec.groupBy === 'assignee' || spec.groupBy === 'stage_owner' ? CHART.soft : color(r.label, i))} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Fetch widget data for a spec (re-fetches when the spec or `version` changes). */
export function useWidgetData(spec: WidgetSpec | null, version = 0) {
  // the title does not change the numbers, so typing a title does not refetch
  const key = spec ? JSON.stringify({ ...spec, title: '' }) : '';
  const [state, setState] = useState<{ data: WidgetData | null; error: string; loading: boolean }>({ data: null, error: '', loading: !!spec });
  useEffect(() => {
    if (!spec || specError(spec)) { setState({ data: null, error: spec ? specError(spec)! : '', loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    const t = setTimeout(() => {
      post<WidgetData>('/dashboard/widget-data', { spec })
        .then((d) => { if (live) setState({ data: d, error: '', loading: false }); })
        .catch((e) => { if (live) setState({ data: null, error: e?.message ?? 'Could not load', loading: false }); });
    }, 150);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  // always show the current title on the (title-independent) data
  const data = state.data && spec ? { ...state.data, spec: { ...state.data.spec, title: spec.title } } : state.data;
  return { ...state, data };
}

/** A custom widget inside the dashboard grid. */
export function CustomWidgetBody({ spec, version }: { spec: WidgetSpec; version: number }) {
  const { data, error, loading } = useWidgetData(spec, version);
  if (error) return <p className="flex items-start gap-1.5 p-1 text-[12.5px] text-rose"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>;
  if (!data) return loading ? <div className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-ink-muted" /></div> : null;
  return <WidgetView data={data} />;
}

const blankSpec = (): WidgetSpec => ({ title: 'Overdue tasks by project', metric: 'overdue_tasks', groupBy: 'project', chart: 'hbar', filter: {} });

export function WidgetBuilder({ open, initial, onClose, onSave }: { open: boolean; initial?: WidgetSpec | null; onClose: () => void; onSave: (spec: WidgetSpec) => void }) {
  const { session, can } = useSession();
  const toast = useToast();
  const finance = can('finance.view');
  const client = session?.persona.code === 'CLIENT';
  const [tab, setTab] = useState<'ai' | 'manual'>('ai');
  const [spec, setSpec] = useState<WidgetSpec>(blankSpec);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<WidgetSuggestResponse | null>(null);
  const [asked, setAsked] = useState(false);
  const projects = useApi<ProjectListItem[]>(open ? '/projects' : null, [open]);

  useEffect(() => {
    if (!open) return;
    setSpec(initial ?? blankSpec()); setTab(initial ? 'manual' : 'ai'); setText(''); setAi(null); setAsked(false);
  }, [open, initial]);

  const metric = metricDef(spec.metric)!;
  const metrics = WIDGET_METRICS.filter((m) => finance || !m.finance);
  const groups = WIDGET_GROUPS.filter((g) => g.entities.includes(metric.entity) && !(client && g.people));
  const err = specError(spec);
  const preview = useWidgetData(open && !err ? spec : null);
  const set = (p: Partial<WidgetSpec>) => setSpec((s) => {
    const n = { ...s, ...p };
    const m = metricDef(n.metric)!;
    if (!WIDGET_GROUPS.find((g) => g.id === n.groupBy)?.entities.includes(m.entity)) n.groupBy = 'none';
    if (n.groupBy === 'none' && n.chart !== 'table') n.chart = 'kpi';
    if (n.groupBy !== 'none' && n.chart === 'kpi') n.chart = n.groupBy === 'month' ? 'line' : 'bar';
    if (n.chart === 'line' && n.groupBy !== 'month') n.chart = 'bar';
    return n;
  });
  const setFilter = (p: Partial<NonNullable<WidgetSpec['filter']>>) => setSpec((s) => {
    const f = { ...(s.filter ?? {}), ...p } as Record<string, unknown>;
    for (const k of Object.keys(f)) if (f[k] === '' || f[k] === false || f[k] === undefined) delete f[k];
    return { ...s, filter: f };
  });
  const statuses = metric.entity === 'task' ? WORK_STATUS : PROJECT_STATUS;

  async function askAi() {
    if (!text.trim()) return;
    setBusy(true); setAi(null); setAsked(false);
    try {
      const r = await post<WidgetSuggestResponse>('/dashboard/widgets/suggest', { text: text.trim() });
      setAi(r);
      if (r.possible) setSpec(r.spec);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function askTeam() {
    try {
      await post('/dashboard/widgets/request', { text: text.trim() });
      setAsked(true);
      toast.success('Request sent to the analytics team (demo)');
    } catch (e) { toast.error(e); }
  }

  const tabBtn = (k: 'ai' | 'manual', label: string, icon: JSX.Element) => (
    <button type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
      className={clsx('inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium', tab === k ? 'bg-surface text-ink shadow-card' : 'text-ink-soft hover:text-ink')}>{icon}{label}</button>
  );

  return (
    <SidePanel open={open} onClose={onClose} width="xl" title={initial ? 'Edit widget' : 'New widget'}
      subtitle="Widgets are built from a safe catalogue of measures. Numbers respect your role (finance only with finance access)."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(spec)} disabled={!!err} disabledReason={err ?? undefined}>{initial ? 'Save widget' : 'Add to dashboard'}</Button></>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex gap-1 rounded-lg bg-sunken p-1" role="tablist" aria-label="How to build the widget">
            {tabBtn('ai', 'Describe it (AI)', <Sparkles size={13} />)}
            {tabBtn('manual', 'Build it', <Wand2 size={13} />)}
          </div>
          {tab === 'ai' ? (
            <div className="space-y-3">
              <Field label="What do you want to see?">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. overdue tasks by workstream lead for my at-risk deals" aria-label="Describe the widget"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) askAi(); }} />
              </Field>
              <Button variant="primary" icon={<Sparkles size={14} />} onClick={askAi} loading={busy} disabled={!text.trim()}>Suggest widget</Button>
              {ai && ai.possible && (
                <div className="rounded-lg border border-piku/25 bg-piku-soft/50 p-3 text-[12.5px]" data-testid="widget-ai-result">
                  <div className="mb-1 flex items-center gap-2"><AiLabel mode={ai.mode} /></div>
                  <p className="text-ink-soft">{ai.explanation}</p>
                  <p className="mt-1 text-ink-muted">Preview on the right. Adjust it in <button type="button" className="link" onClick={() => setTab('manual')}>Build it</button> or add it as it is.</p>
                </div>
              )}
              {ai && !ai.possible && (
                <div className="rounded-lg border border-amber/30 bg-amber-soft/50 p-3 text-[12.5px]" data-testid="widget-ai-impossible">
                  <div className="mb-1 flex items-center gap-2"><AlertTriangle size={14} className="text-amber" /><span className="font-semibold">This widget cannot be built here</span><AiLabel mode={ai.mode} /></div>
                  <p className="text-ink-soft">{ai.reason}</p>
                  {ai.closestAlternatives.length > 0 && (
                    <>
                      <p className="mt-2 font-medium">Closest widgets you can add:</p>
                      <ul className="mt-1 space-y-1">
                        {ai.closestAlternatives.map((a) => (
                          <li key={a.spec.title}><button type="button" className="link text-left" onClick={() => { setSpec(a.spec); setTab('manual'); }}>{a.spec.title}</button><span className="text-ink-muted"> - {a.explanation}</span></li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className="mt-3">
                    {asked ? <p className="text-green">Sent. The analytics team will follow up (demo).</p>
                      : <Button size="sm" icon={<Send size={13} />} onClick={askTeam}>{ai.suggestion || 'Ask the analytics team'}</Button>}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title" className="col-span-2"><Input value={spec.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} aria-label="Widget title" /></Field>
              <Field label="Measure" className="col-span-2">
                <Select value={spec.metric} onChange={(e) => set({ metric: e.target.value as WidgetSpec['metric'] })} aria-label="Measure">
                  {metrics.map((m) => <option key={m.id} value={m.id}>{m.label}{m.finance ? ' (finance)' : ''}</option>)}
                </Select>
              </Field>
              <Field label="Group by"><Select value={spec.groupBy} onChange={(e) => set({ groupBy: e.target.value as WidgetSpec['groupBy'] })} aria-label="Group by">
                {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </Select></Field>
              <Field label="Chart"><Select value={spec.chart} onChange={(e) => set({ chart: e.target.value as WidgetSpec['chart'] })} aria-label="Chart type">
                {WIDGET_CHARTS.filter((c) => (spec.groupBy === 'none' ? c.id === 'kpi' || c.id === 'table' : c.id !== 'kpi' && (c.id !== 'line' || spec.groupBy === 'month'))).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select></Field>
              <Field label="Status filter"><Select value={spec.filter?.status ?? ''} onChange={(e) => setFilter({ status: e.target.value })} aria-label="Status filter">
                <option value="">Any status</option>{statuses.map((s) => <option key={s}>{s}</option>)}
              </Select></Field>
              <Field label="Project"><Select value={spec.filter?.projectId ?? ''} onChange={(e) => setFilter({ projectId: e.target.value })} aria-label="Project filter">
                <option value="">All my projects</option>{(projects.data ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.code_name}</option>)}
              </Select></Field>
              <div className="col-span-2 flex flex-wrap gap-4">
                <Checkbox checked={!!spec.filter?.mine} onChange={(v) => setFilter({ mine: v })} label={metric.entity === 'task' ? 'Only tasks assigned to me' : 'Only projects I am on'} />
                <Checkbox checked={!!spec.filter?.atRisk} onChange={(v) => setFilter({ atRisk: v })} label="Only at-risk projects" />
              </div>
              {err && <p className="col-span-2 text-[12.5px] text-rose">{err}</p>}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1 text-[12.5px] font-medium text-ink-soft">Live preview</p>
          <div className="card flex h-[300px] flex-col overflow-hidden" data-testid="widget-preview">
            {spec.chart !== 'kpi' && <h3 className="px-4 pt-3 text-[14px] font-semibold">{spec.title || 'Untitled widget'}</h3>}
            <div className={clsx('min-h-0 flex-1', spec.chart === 'kpi' ? '' : 'overflow-auto px-4 pb-3 pt-2')}>
              {err ? <p className="p-4 text-[12.5px] text-ink-muted">{err}</p>
                : preview.error ? <p className="p-4 text-[12.5px] text-rose">{preview.error}</p>
                  : preview.data && !preview.loading ? <WidgetView data={preview.data} compact />
                    : <div className="flex h-full items-center justify-center" aria-live="polite"><Loader2 size={16} className="animate-spin text-ink-muted" /><span className="sr-only">Loading preview</span></div>}
            </div>
          </div>
          {!err && <p className="mt-2 text-[12px] text-ink-muted">{describeSpec(spec)}</p>}
        </div>
      </div>
    </SidePanel>
  );
}

