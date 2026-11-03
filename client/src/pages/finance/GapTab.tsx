/**
 * v1.4 funding need analysis: the "Funding gap" card on Overview and the full "Gap & split" tab.
 * Every number comes from the server (GET /projects/:id/finance -> gap, computed by services/financeGap.ts analyseGap()).
 */
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, History, Lightbulb, Scale, Settings2, Sparkles } from 'lucide-react';
import type { FinanceWorkspace, GapScenario, GapSummary } from '@shared/types';
import { post } from '../../lib/api';
import { AiLabel, Button, Pill, Skeleton } from '../../components/ui';
import { money } from '../../lib/format';
import { Card, Tile, cur } from './tabs';

type Go = (t: any, extra?: Record<string, string>) => void;

/** Banner shown when a project has no cost lines, funding or invoices yet. */
export function SetupBanner({ w, onSetup }: { w: FinanceWorkspace; onSetup: () => void }) {
  const st = w.setup;
  return (
    <section className="rounded-xl border border-blue/30 bg-blue-soft/40 px-4 py-3.5" aria-label="Set up finance">
      <div className="flex flex-wrap items-start gap-3">
        <Settings2 size={18} className="mt-[2px] shrink-0 text-blue" />
        <div className="min-w-[240px] flex-1">
          <h2 className="text-[14.5px] font-semibold">Set up finance</h2>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {st.isEmpty ? 'This project has no cost lines, funding lines or invoices yet, so the funding gap and the cost split cannot be worked out.'
              : 'Some finance data is missing, so the cost split cannot be modelled yet.'}
            {st.missing.length > 0 && <> Missing: {st.missing.join(', ')}.</>}
          </p>
          {!w.perms.canEdit && <p className="mt-1 text-[12.5px] text-ink-muted">{st.setupBy}</p>}
        </div>
        {w.perms.canEdit && <Button variant="primary" icon={<Settings2 size={14} />} onClick={onSetup}>Set up finance</Button>}
      </div>
    </section>
  );
}

function ScenarioRow({ s, c, rec }: { s: GapScenario; c: string; rec: boolean }) {
  return (
    <tr className={clsx(rec && 'bg-green-soft/40')}>
      <td className="td font-medium">{s.name}{rec && <Pill className="ml-2" tone="bg-green-soft text-green">Recommended</Pill>}</td>
      <td className="td num text-right">{money(s.sellerShare, c)}</td>
      <td className="td num text-right">{money(s.buyerShare, c)}</td>
      <td className="td num text-right">{money(s.sellerGap, c)}</td>
      <td className="td num text-right">{money(s.buyerGap, c)}</td>
      <td className="td num text-right">{s.capExcess ? <span className="text-amber">{money(s.capExcess, c)}</span> : '–'}</td>
    </tr>
  );
}

function ScenarioTable({ w, compact }: { w: FinanceWorkspace; compact?: boolean }) {
  const g = w.gap; const c = cur(w);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]" aria-label="Cost-sharing scenarios">
        <thead><tr>
          <th className="th">Basis</th><th className="th text-right">Seller share</th><th className="th text-right">Buyer share</th>
          <th className="th text-right">Seller still funds</th><th className="th text-right">Buyer still funds</th><th className="th text-right">{compact ? 'Over cap' : 'Moved by SPA cap'}</th>
        </tr></thead>
        <tbody>{g.scenarios.map((s) => <ScenarioRow key={s.key} s={s} c={c} rec={g.recommendation?.key === s.key} />)}</tbody>
      </table>
    </div>
  );
}

/** Top of Overview: the funding position in one card. */
export function GapOverviewCard({ w, go, onSetup }: { w: FinanceWorkspace; go: Go; onSetup: () => void }) {
  const g = w.gap; const c = cur(w);
  if (g.state === 'no-data') {
    return (
      <Card title="Funding gap">
        <p className="text-[13px] text-ink-soft">Not enough finance data — set up finance to see the funding need and how it could be split between buyer and seller.</p>
        {w.perms.canEdit ? <Button className="mt-2" size="sm" variant="primary" icon={<Settings2 size={14} />} onClick={onSetup}>Set up finance</Button>
          : <p className="mt-1 text-[12.5px] text-ink-muted">{w.setup.setupBy}</p>}
      </Card>
    );
  }
  const open = <button className="text-[12.5px] font-medium text-link hover:underline" onClick={() => go('gap')}>Gap &amp; split</button>;
  if (g.state === 'funded') {
    return (
      <Card title={<span className="inline-flex items-center gap-1.5"><CheckCircle2 size={16} className="text-green" /> Fully funded</span>} right={open}>
        <p className="text-[13px]">{g.headline}</p>
        {g.watch.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-soft">{g.watch.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>}
      </Card>
    );
  }
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><AlertTriangle size={16} className="text-amber" /> Funding gap {money(g.gap, c)}</span>} right={open}>
      <p className="text-[13px]">{g.headline}</p>
      {g.state === 'estimate-only' ? (
        <p className="mt-1.5 text-[12.5px] text-ink-muted">Add cost lines with who pays to compare the four ways of splitting the cost.{w.perms.canEdit && <> <button className="font-medium text-link hover:underline" onClick={onSetup}>Set up finance</button></>}</p>
      ) : (
        <>
          <div className="mt-2.5"><ScenarioTable w={w} compact /></div>
          {g.recommendation && <p className="mt-2 text-[12.5px] text-ink-soft"><b className="text-ink">Recommended: {g.recommendation.name}.</b> {g.recommendation.reasons[0]}</p>}
        </>
      )}
    </Card>
  );
}

function AiSummary({ w }: { w: FinanceWorkspace }) {
  const [s, setS] = useState<GapSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setS(await post<GapSummary>(`/projects/${w.project.project_id}/finance/gap/summary`)); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load the summary.'); } finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [w.gap.gap, w.gap.uses, w.gap.secured, w.gap.recommendation?.key]);
  return (
    <section className="rounded-xl border border-piku/25 bg-piku-soft/40 px-4 py-3" aria-label="AI summary">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Sparkles size={15} className="text-piku" /><h2 className="text-[13.5px] font-semibold">AI summary</h2>{s && <AiLabel mode={s.mode} />}
        <Button size="sm" variant="ghost" className="ml-auto" loading={busy} onClick={run}>Refresh</Button>
      </div>
      {err ? <p className="text-[13px] text-rose">{err}</p> : s ? <p className="text-[13px] leading-relaxed">{s.text}</p> : <Skeleton className="h-10" />}
      <p className="mt-1.5 text-[11.5px] text-ink-muted">Written only from the figures computed on this page. Check before sharing.</p>
    </section>
  );
}

export function GapTab({ w, go, onSetup }: { w: FinanceWorkspace; go: Go; onSetup: () => void }) {
  const g = w.gap; const c = cur(w);
  const [pick, setPick] = useState(g.recommendation?.key ?? 'beneficiary');
  useEffect(() => { if (g.recommendation) setPick(g.recommendation.key); }, [g.recommendation?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (g.state === 'no-data') {
    return (
      <div className="space-y-4">
        <SetupBanner w={w} onSetup={onSetup} />
        <Card title="Funding gap"><p className="text-[13px] text-ink-soft">Not enough finance data — set up finance. Once there is a one-time cost estimate and cost lines with who pays, this tab shows the gap, four ways to split it and what to do next.</p></Card>
      </div>
    );
  }
  const sc = g.scenarios.find((s) => s.key === pick) ?? g.scenarios[0];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="One-time cost (uses)" value={money(g.uses, c)} sub={g.state === 'estimate-only' ? 'Estimate, no cost lines yet' : `${w.costItems.length} cost lines`} />
        <Tile label="Secured" value={money(g.secured, c)} tone="green" sub={`Seller ${money(g.securedSeller, c)} · buyer ${money(g.securedBuyer, c)}`} />
        <Tile label="Funding gap" value={money(g.gap, c)} tone={g.gap ? 'amber' : 'green'} sub="Uses minus secured" />
        <Tile label="In the pipeline" value={money(g.pipeline, c)} sub="Not yet secured; shown separately" />
        <Tile label="No source yet" value={money(g.gapAfterPipeline, c)} tone={g.gapAfterPipeline ? 'rose' : undefined} sub="Gap minus pipeline" />
        <Tile label="SPA seller cap" value={g.spa.cap != null ? money(g.spa.cap, c) : <span className="text-[16px] font-medium text-ink-muted">Not set</span>} sub={g.spa.clause || 'No clause recorded'} />
      </div>

      {g.state === 'estimate-only' ? (
        <SetupBanner w={w} onSetup={onSetup} />
      ) : (
        <>
          <AiSummary w={w} />
          {g.state === 'funded' && (
            <Card title={<span className="inline-flex items-center gap-1.5"><CheckCircle2 size={16} className="text-green" /> Fully funded</span>}>
              <p className="text-[13px]">{g.headline} The scenarios below still show how the cost would be shared if it changes.</p>
            </Card>
          )}
          <Card title={<span className="inline-flex items-center gap-1.5"><Scale size={16} /> Four ways to split the cost</span>}>
            <ScenarioTable w={w} />
            <p className="mt-2 text-[11.5px] text-ink-muted">Seller share + buyer share = the one-time cost. "Still funds" splits the {money(g.gap, c)} gap: each side's share minus what it has already secured, after the SPA cap.</p>
          </Card>

          {g.recommendation && (
            <Card title={<span className="inline-flex items-center gap-1.5"><Lightbulb size={16} className="text-amber" /> Recommendation: {g.recommendation.name}</span>}>
              <ul className="list-disc space-y-1 pl-5 text-[13px]">{g.recommendation.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <p className="mt-2 text-[11.5px] text-ink-muted">Rules-based: beneficiary pays when 70%+ of cost is tagged; usage-based when 30%+ is shared and usage is recorded; otherwise avoided-cost credit when there is a TSA run-rate, else an even split.</p>
            </Card>
          )}

          <Card title="Evidence: what drives each number" right={(
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Scenario for the evidence">
              {g.scenarios.map((s) => (
                <button key={s.key} role="radio" aria-checked={pick === s.key} onClick={() => setPick(s.key)}
                  className={clsx('rounded px-2 py-1 text-[12px] font-medium', pick === s.key ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sunken')}>{s.name}</button>
              ))}
            </div>
          )}>
            <p className="mb-2 text-[12.5px] text-ink-soft">{sc.basis}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead><tr><th className="th">Cost line / rule</th><th className="th">Who pays</th><th className="th">Rule applied</th><th className="th text-right">Amount</th><th className="th text-right">Seller</th><th className="th text-right">Buyer</th></tr></thead>
                <tbody>
                  {sc.evidence.map((e, i) => (
                    <tr key={e.cost_id ?? `${e.label}-${i}`} className={clsx(!e.cost_id && 'bg-amber-soft/40')}>
                      <td className="td">{e.cost_id
                        ? <button className="text-left font-medium text-link hover:underline" onClick={() => go('funding', { cost: e.cost_id! })} title="Open this cost line">{e.label}</button>
                        : <span className="font-medium">{e.label}</span>}</td>
                      <td className="td">{e.cost_id ? (e.payer || <span className="text-amber">Not agreed</span>) : '–'}</td>
                      <td className="td text-ink-soft">{e.rule}</td>
                      <td className="td num text-right">{money(e.amount, c)}</td>
                      <td className="td num text-right">{money(e.seller, c)}</td>
                      <td className="td num text-right">{money(e.buyer, c)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="td" colSpan={3}>Total</td><td className="td num text-right">{money(g.uses, c)}</td><td className="td num text-right">{money(sc.sellerShare, c)}</td><td className="td num text-right">{money(sc.buyerShare, c)}</td></tr>
                </tbody>
              </table>
            </div>
            {sc.notes.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-soft">{sc.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
          </Card>
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {g.routes.length > 0 && (
          <Card title="Recommended funding routes" right={<button className="text-[12.5px] font-medium text-link hover:underline" onClick={() => go('options')}>Ask a bank <ArrowRight size={12} className="inline" /></button>}>
            <ul className="space-y-2.5">
              {g.routes.map((r) => (
                <li key={r.type + r.funder} className="text-[12.5px]">
                  <div className="flex flex-wrap items-baseline gap-2"><span className="text-[13px] font-semibold">{r.type}</span><Pill>{`${r.funder} side`}</Pill><span className="num ml-auto font-medium">{money(r.amount, c)}</span></div>
                  <p className="text-ink-soft">{r.why}</p>
                  <p className="text-ink-muted">Terms: {r.terms} Watch: {r.watch}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title={<span className="inline-flex items-center gap-1.5"><ClipboardList size={16} /> Next steps</span>}>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px]">
            {g.nextSteps.map((s) => <li key={s.text}>{s.text} <span className="text-[12px] text-ink-muted">— {s.owner} ({s.role})</span></li>)}
          </ol>
        </Card>
        {g.watch.length > 0 && (
          <Card title="What to watch"><ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-soft">{g.watch.map((x) => <li key={x}>{x}</li>)}</ul></Card>
        )}
        {g.lessons.length > 0 && (
          <Card title={<span className="inline-flex items-center gap-1.5"><History size={16} /> How similar past deals handled it</span>}>
            <ul className="space-y-2">
              {g.lessons.map((l) => (
                <li key={l.title} className="text-[12.5px]">
                  <div className="font-medium text-ink">{l.title} <span className="text-[11.5px] font-normal text-ink-muted">({l.item_type})</span></div>
                  <p className="text-ink-soft">{l.body}</p>
                  <p className="text-[11.5px] text-ink-muted">From: {l.sources.join('; ')}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-ink-muted">Approved, anonymised learnings from closed deals in the knowledge hub.</p>
          </Card>
        )}
      </div>
      {g.assumptions.length > 0 && <p className="text-[11.5px] text-ink-muted">Assumptions: {g.assumptions.join(' ')}</p>}
    </div>
  );
}
