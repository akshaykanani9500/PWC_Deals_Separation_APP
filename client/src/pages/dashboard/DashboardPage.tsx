/** Dashboard (sketch 2): customisable widget grid on top, current projects table below. */
import { useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, RefreshCw, LayoutGrid, X, RotateCcw, Check } from 'lucide-react';
import type { DashboardData } from '@shared/types';
import { useApi } from '../../hooks/useApi';
import { useUsers } from '../../hooks/useUsers';
import { useSession } from '../../lib/session';
import { api } from '../../lib/api';
import { Button, Skeleton } from '../../components/ui';
import { useToast } from '../../components/toast';
import { WIDGETS, DEFAULT_LAYOUT_IDS, type WidgetDef, type QuickFilter } from './widgets';
import ProjectsTable from './ProjectsTable';
import NewProjectPanel from './NewProjectPanel';

const Grid = WidthProvider(GridLayout);
const COLS = 12;

interface SavedLayout { version: 1; items: Layout[] }

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

function parseSaved(raw: string | null | undefined): Layout[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SavedLayout | Layout[];
    const items = Array.isArray(v) ? v : v.items;
    return Array.isArray(items) && items.every((i) => typeof i.i === 'string') ? items : null;
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

  // Initialise layout once dashboard data tells us whether finance widgets apply.
  useEffect(() => {
    if (!data || layout) return;
    let saved = parseSaved(session?.user.dashboard_layout);
    if (!saved) { try { saved = parseSaved(localStorage.getItem(storageKey)); } catch { /* ignore */ } }
    const base = saved ?? buildLayout(DEFAULT_LAYOUT_IDS);
    setLayout(base.filter((l) => { const w = WIDGETS.find((d) => d.id === l.i); return w && allowed(w); }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function persist(items: Layout[]) {
    const payload = JSON.stringify({ version: 1, items: items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })) });
    try { localStorage.setItem(storageKey, payload); } catch { /* ignore */ }
    try { await api('/users/me/preferences', { method: 'PUT', body: { dashboard_layout: payload } }); }
    catch { /* localStorage fallback already saved */ }
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
          <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => { reload(); setTableKey((k) => k + 1); }}>Refresh</Button>
          {customize ? (
            <>
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
          <p className="text-[12.5px] text-ink-soft">Drag widgets by their title bar and resize from the bottom-right corner. Add widgets from the list below.</p>
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
            const w = WIDGETS.find((d) => d.id === l.i)!;
            const isKpi = w.id.startsWith('kpi') || w.id.startsWith('fin-');
            return (
              <div key={l.i} className={`card flex flex-col overflow-hidden ${customize ? 'ring-1 ring-brand-ring/60' : ''}`}>
                {(!isKpi || customize) && (
                  <div className={`widget-handle flex items-center justify-between px-4 pt-3 ${customize ? 'cursor-move' : ''}`}>
                    <h3 className="text-[14px] font-semibold">{w.title}</h3>
                    {customize && (
                      <button onClick={() => setLayout((s) => (s ?? []).filter((x) => x.i !== l.i))} onMouseDown={(e) => e.stopPropagation()}
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
    </div>
  );
}
