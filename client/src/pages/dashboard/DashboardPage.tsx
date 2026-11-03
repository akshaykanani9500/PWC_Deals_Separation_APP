/** Dashboard (sketch 2): customisable widget grid on top, current projects table below. */
import { useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, RefreshCw, LayoutGrid, X, RotateCcw, Check, Pencil, Sparkles } from 'lucide-react';
import type { DashboardData, WidgetSpec } from '@shared/types';
import { metricDef, specError } from '@shared/widgetCatalog';
import { useApi } from '../../hooks/useApi';
import { useUsers } from '../../hooks/useUsers';
import { useSession } from '../../lib/session';
import { api } from '../../lib/api';
import { Button, Skeleton } from '../../components/ui';
import { useToast } from '../../components/toast';
import { WIDGETS, DEFAULT_LAYOUT_IDS, type WidgetDef, type QuickFilter } from './widgets';
import ProjectsTable from './ProjectsTable';
import NewProjectPanel from './NewProjectPanel';
import { CustomWidgetBody, WidgetBuilder, sizeFor } from './CustomWidget';

const Grid = WidthProvider(GridLayout);
const COLS = 12;

/** Saved per user in users.dashboard_layout. v1.4: `custom` holds custom widget specs by grid id ("cw-..."); older layouts have none. */
interface SavedLayout { version: 1; items: Layout[]; custom?: Record<string, WidgetSpec> }
const isCustom = (id: string) => id.startsWith('cw-');

/** Place widgets left-to-right, top-to-bottom in a 12-column grid. */
function buildLayout(ids: string[]): Layout[] {
  let x = 0, y = 0, rowH = 0;
  const out: Layout[] = [];
  for (const id of ids) {
    const w = WIDGETS.find((d) => d.id === id);
    if (!w) continue;
    if (x + w.w > COLS) { x = 0; y += rowH; rowH = 0; }
    out.push({ i: id, x, y, w: w.w, h: w.h, minW: w.minW, minH: w.minH });
    x += w.w; rowH = Math.max(rowH, w.h);
  }
  return out;
}

function parseSaved(raw: string | null | undefined): { items: Layout[]; custom: Record<string, WidgetSpec> } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SavedLayout | Layout[];
    const items = Array.isArray(v) ? v : v.items;
    const custom: Record<string, WidgetSpec> = {};
    if (!Array.isArray(v) && v.custom && typeof v.custom === 'object') {
      for (const [k, spec] of Object.entries(v.custom)) if (isCustom(k) && !specError(spec)) custom[k] = spec;
    }
    return Array.isArray(items) && items.every((i) => typeof i.i === 'string') ? { items, custom } : null;
  } catch { return null; }
}

export default function DashboardPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const users = useUsers();
  const userMap = useMemo(() => new Map(users.map((u) => [u.user_id, u.full_name])), [users]);
  const { data, error, loading, reload } = useApi<DashboardData>('/dashboard');
  const [customize, setCustomize] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [tableKey, setTableKey] = useState(0);
  const [quick, setQuick] = useState<QuickFilter | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const applyQuick = (f: QuickFilter) => {
    setQuick(f === 'active' ? null : f);
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  const financeVisible = !!data && data.kpis.feeBudget !== null;
  const allowed = (w: WidgetDef) => !w.finance || financeVisible;
  const storageKey = `dsh.layout.${session?.user.user_id}`;

  const [layout, setLayout] = useState<Layout[] | null>(null);
  const [custom, setCustom] = useState<Record<string, WidgetSpec>>({});
  const [builder, setBuilder] = useState<{ open: boolean; id?: string }>({ open: false });
  const [version, setVersion] = useState(0);
  const allowedCustom = (spec?: WidgetSpec) => !!spec && (!metricDef(spec.metric)?.finance || financeVisible);

  // Initialise layout once dashboard data tells us whether finance widgets apply.
  useEffect(() => {
    if (!data || layout) return;
    let saved = parseSaved(session?.user.dashboard_layout);
    if (!saved) { try { saved = parseSaved(localStorage.getItem(storageKey)); } catch { /* ignore */ } }
    const base = saved?.items ?? buildLayout(DEFAULT_LAYOUT_IDS);
    const specs = saved?.custom ?? {};
    setCustom(specs);
    setLayout(base.filter((l) => {
      if (isCustom(l.i)) return allowedCustom(specs[l.i]);
      const w = WIDGETS.find((d) => d.id === l.i); return w && allowed(w);
    }).map((l) => (isCustom(l.i) ? { ...l, minW: sizeFor(specs[l.i].chart).minW, minH: sizeFor(specs[l.i].chart).minH } : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function persist(items: Layout[], specs: Record<string, WidgetSpec> = custom) {
    const keep = Object.fromEntries(Object.entries(specs).filter(([k]) => items.some((l) => l.i === k)));
    const payload = JSON.stringify({ version: 1, items: items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })), custom: keep });
    try { localStorage.setItem(storageKey, payload); } catch { /* ignore */ }
    try { await api('/users/me/preferences', { method: 'PUT', body: { dashboard_layout: payload } }); }
    catch { /* localStorage fallback already saved */ }
  }

  /** Add a new custom widget (or update an existing one) and save straight away. */
  async function saveCustom(spec: WidgetSpec) {
    const editing = builder.id;
    const id = editing ?? `cw-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const specs = { ...custom, [id]: spec };
    const sz = sizeFor(spec.chart);
    let items = layout ?? [];
    if (editing) items = items.map((l) => (l.i === id ? { ...l, minW: sz.minW, minH: sz.minH, w: Math.max(l.w, sz.minW), h: Math.max(l.h, sz.minH) } : l));
    else items = [...items, { i: id, x: 0, y: Math.max(0, ...items.map((l) => l.y + l.h)), ...sz }];
    setCustom(specs); setLayout(items); setBuilder({ open: false });
    await persist(items, specs);
    toast.success(editing ? 'Widget saved' : `Widget "${spec.title}" added to your dashboard`);
  }
  async function removeWidget(id: string, title: string) {
    const items = (layout ?? []).filter((x) => x.i !== id);
    setLayout(items);
    if (isCustom(id)) {
      const specs = { ...custom }; delete specs[id]; setCustom(specs);
      await persist(items, specs);
      toast.success(`Widget "${title}" removed`);
    } else toast.info(`"${title}" removed. Press Save layout to keep the change.`);
  }

  function addWidget(id: string) {
    const w = WIDGETS.find((d) => d.id === id)!;
    const maxY = Math.max(0, ...(layout ?? []).map((l) => l.y + l.h));
    setLayout((l) => [...(l ?? []), { i: id, x: 0, y: maxY, w: w.w, h: w.h, minW: w.minW, minH: w.minH }]);
  }

  const present = new Set((layout ?? []).map((l) => l.i));
  const catalog = WIDGETS.filter((w) => allowed(w) && !present.has(w.id));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight">Dashboard</h1>
          <p className="text-[13.5px] text-ink-soft">
            {session?.scope === 'all' ? 'All separation projects across the practice.' : 'Separation projects you are staffed on.'}
            {!financeVisible && data && ' Finance figures are hidden for your role.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { reload(); setTableKey((k) => k + 1); setVersion((v) => v + 1); }}>Refresh</Button>
          {customize ? (
            <>
              <Button icon={<Sparkles size={14} />} onClick={() => setBuilder({ open: true })}>New widget</Button>
              <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setLayout(buildLayout(DEFAULT_LAYOUT_IDS).filter((l) => allowed(WIDGETS.find((w) => w.id === l.i)!)))}>Reset to default</Button>
              <Button variant="primary" icon={<Check size={14} />} onClick={async () => { setCustomize(false); if (layout) { await persist(layout); toast.success('Dashboard layout saved'); } }}>Save layout</Button>
            </>
          ) : (
            <Button icon={<LayoutGrid size={14} />} onClick={() => setCustomize(true)}>Customize widgets</Button>
          )}
          {can('project.create') && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setNewOpen(true)}>New project</Button>}
        </div>
      </div>

      {customize && (
        <div className="mb-3 rounded-xl border border-dashed border-brand-ring bg-brand-soft/40 px-4 py-3">
          <p className="text-[12.5px] text-ink-soft">Drag widgets by their title bar and resize from the bottom-right corner. Add widgets from the list below, or create your own with <button type="button" className="link" onClick={() => setBuilder({ open: true })}>New widget</button>.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {catalog.length ? catalog.map((w) => (
              <button key={w.id} onClick={() => addWidget(w.id)} title={w.description}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] hover:border-brand-ring">
                <Plus size={12} /> {w.title}
              </button>
            )) : <span className="text-[12px] text-ink-muted">All widgets are on the dashboard.</span>}
          </div>
        </div>
      )}

      {error && <div className="card mb-4 px-4 py-3 text-[13px] text-rose">Could not load the dashboard: {error.message}</div>}

      {loading && !data ? (
        <div className="grid grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)}</div>
      ) : data && layout ? (
        <Grid
          className="-mx-[6px]"
          layout={layout}
          cols={COLS}
          rowHeight={44}
          margin={[12, 12]}
          containerPadding={[6, 0]}
          isDraggable={customize}
          isResizable={customize}
          draggableHandle=".widget-handle"
          compactType="vertical"
          onLayoutChange={(l) => setLayout(l)}
        >
          {layout.map((l) => {
            if (isCustom(l.i)) {
              const spec = custom[l.i];
              const kpi = spec.chart === 'kpi';
              return (
                <div key={l.i} className={`card flex flex-col overflow-hidden ${customize ? 'ring-1 ring-brand-ring/60' : ''}`} data-testid="custom-widget" aria-label={spec.title}>
                  {(!kpi || customize) && (
                    <div className={`widget-handle flex items-center justify-between gap-2 px-4 pt-3 ${customize ? 'cursor-move' : ''}`}>
                      <h3 className="truncate text-[14px] font-semibold">{spec.title}</h3>
                      {customize && (
                        <span className="flex shrink-0 gap-0.5">
                          <button onClick={() => setBuilder({ open: true, id: l.i })} onMouseDown={(e) => e.stopPropagation()} className="rounded p-0.5 text-ink-muted hover:bg-sunken hover:text-ink" aria-label={`Edit ${spec.title}`}><Pencil size={13} /></button>
                          <button onClick={() => removeWidget(l.i, spec.title)} onMouseDown={(e) => e.stopPropagation()} className="rounded p-0.5 text-ink-muted hover:bg-sunken hover:text-rose" aria-label={`Remove ${spec.title}`}><X size={14} /></button>
                        </span>
                      )}
                    </div>
                  )}
                  <div className={`min-h-0 flex-1 ${kpi && !customize ? '' : 'overflow-auto px-4 pb-3 pt-2'}`}><CustomWidgetBody spec={spec} version={version} /></div>
                </div>
              );
            }
            const w = WIDGETS.find((d) => d.id === l.i)!;
            const isKpi = w.id.startsWith('kpi') || w.id.startsWith('fin-');
            return (
              <div key={l.i} className={`card flex flex-col overflow-hidden ${customize ? 'ring-1 ring-brand-ring/60' : ''}`}>
                {(!isKpi || customize) && (
                  <div className={`widget-handle flex items-center justify-between px-4 pt-3 ${customize ? 'cursor-move' : ''}`}>
                    <h3 className="text-[14px] font-semibold">{w.title}</h3>
                    {customize && (
                      <button onClick={() => removeWidget(l.i, w.title)} onMouseDown={(e) => e.stopPropagation()}
                        className="rounded p-0.5 text-ink-muted hover:bg-sunken hover:text-rose" aria-label={`Remove ${w.title}`}><X size={14} /></button>
                    )}
                  </div>
                )}
                <div className={`min-h-0 flex-1 ${isKpi && !customize ? '' : 'overflow-auto px-4 pb-3 pt-2'}`}>
                  {w.render(data, userMap, { onFilter: applyQuick, userName: session?.user.full_name, customizing: customize })}
                </div>
              </div>
            );
          })}
        </Grid>
      ) : null}

      <div ref={tableRef} className="scroll-mt-28">
        <ProjectsTable key={tableKey} financeVisible={financeVisible} quick={quick} onClearQuick={() => setQuick(null)} />
      </div>

      <NewProjectPanel open={newOpen} onClose={() => setNewOpen(false)} />
      <WidgetBuilder open={builder.open} initial={builder.id ? custom[builder.id] : null} onClose={() => setBuilder({ open: false })} onSave={saveCustom} />
    </div>
  );
}
