/** v1.4 "Set up finance" side panel (finance.edit). POST /projects/:id/finance/setup; the server re-checks the permission. */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { COST_CATEGORIES, COST_PAYERS } from '@shared/schema';
import type { FinanceWorkspace } from '@shared/types';
import { post } from '../../lib/api';
import { useToast } from '../../components/toast';
import { SidePanel } from '../../components/SidePanel';
import { Button, Field, Input, Select } from '../../components/ui';
import { money } from '../../lib/format';

interface Line { category: string; amount: string; payer: string; usage: string; description: string }
const blankLine = (category = 'IT infrastructure', payer = 'Seller'): Line => ({ category, amount: '', payer, usage: '', description: '' });
const numOrNull = (v: string) => (v === '' ? null : Number(v));

export default function SetupPanel({ w, onClose, onSaved }: { w: FinanceWorkspace; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const t = w.totals;
  const [f, setF] = useState({
    currency: w.project.currency || 'USD', fee_budget: t.fee_budget ? String(t.fee_budget) : '', one_time_cost: t.one_time_cost_estimate ? String(t.one_time_cost_estimate) : '',
    tsa_monthly_cost: t.tsa_run_rate && !t.tsa_services_active ? String(t.tsa_run_rate) : '', spa_seller_cap: w.setup.spa_seller_cap != null ? String(w.setup.spa_seller_cap) : '',
    spa_clause_ref: w.setup.spa_clause_ref ?? '', seller_committed: '', buyer_committed: '',
  });
  const [lines, setLines] = useState<Line[]>(w.setup.hasCostLines ? [] : [blankLine('IT infrastructure', 'Seller'), blankLine('Applications and licences', 'Buyer'), blankLine('Network and sites', 'Shared')]);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const setLine = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const filled = lines.filter((l) => Number(l.amount) > 0);
  const linesTotal = filled.reduce((s, l) => s + Number(l.amount), 0);
  const est = Number(f.one_time_cost) || 0;
  const c = f.currency || 'USD';

  const save = async () => {
    setSaving(true);
    try {
      await post(`/projects/${w.project.project_id}/finance/setup`, {
        currency: f.currency || null, fee_budget: numOrNull(f.fee_budget), one_time_cost: numOrNull(f.one_time_cost), tsa_monthly_cost: numOrNull(f.tsa_monthly_cost),
        spa_seller_cap: numOrNull(f.spa_seller_cap), spa_clause_ref: f.spa_clause_ref || null,
        seller_committed: numOrNull(f.seller_committed), buyer_committed: numOrNull(f.buyer_committed),
        ...(filled.length ? { cost_lines: filled.map((l) => ({ category: l.category, amount: Number(l.amount), payer: l.payer || null, buyer_usage_pct: l.payer === 'Shared' || !l.payer ? numOrNull(l.usage) : null, description: l.description || null })) } : {}),
      });
      toast.success('Finance set up: figures saved');
      onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };

  return (
    <SidePanel open onClose={onClose} width="lg" title="Set up finance" subtitle={`${w.project.code_name} · every change is recorded in the audit log`} onSave={save} saving={saving} saveLabel="Save finance set-up">
      <p className="mb-3 text-[12.5px] text-ink-soft">Enter what you know; everything is optional and can be changed later. With cost lines and who pays, the Gap &amp; split tab compares four ways to share the cost.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency"><Select value={f.currency} onChange={(e) => set('currency', e.target.value)}>{['USD', 'INR', 'EUR', 'GBP'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label={`PwC fee budget (${c})`}><Input type="number" min={0} value={f.fee_budget} onChange={(e) => set('fee_budget', e.target.value)} /></Field>
        <Field label={`One-time separation cost estimate (${c})`}><Input type="number" min={0} value={f.one_time_cost} onChange={(e) => set('one_time_cost', e.target.value)} /></Field>
        <Field label={`Client TSA run-rate per month (${c})`} hint={t.tsa_services_active ? 'Itemised TSA services exist; their total is used' : undefined}><Input type="number" min={0} value={f.tsa_monthly_cost} onChange={(e) => set('tsa_monthly_cost', e.target.value)} /></Field>
        <Field label={`Seller cap from the SPA (${c})`} hint="Most the seller pays towards separation cost"><Input type="number" min={0} value={f.spa_seller_cap} onChange={(e) => set('spa_seller_cap', e.target.value)} /></Field>
        <Field label="SPA clause reference"><Input value={f.spa_clause_ref} onChange={(e) => set('spa_clause_ref', e.target.value)} placeholder="e.g. SPA cl. 7.4" /></Field>
        {!w.setup.hasFunding && <>
          <Field label={`Seller contribution committed (${c})`}><Input type="number" min={0} value={f.seller_committed} onChange={(e) => set('seller_committed', e.target.value)} /></Field>
          <Field label={`Buyer cash committed (${c})`}><Input type="number" min={0} value={f.buyer_committed} onChange={(e) => set('buyer_committed', e.target.value)} /></Field>
        </>}
      </div>

      <div className="mt-5 rounded-xl border border-line">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <h3 className="text-[13.5px] font-semibold">Initial cost lines</h3>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setLines((ls) => [...ls, blankLine('Data migration', 'Buyer')])}>Add line</Button>
        </div>
        <div className="space-y-2 px-3 py-2.5">
          {w.setup.hasCostLines && <p className="text-[12.5px] text-ink-muted">This project already has {w.costItems.length} cost lines; lines added here are added to them.</p>}
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1fr_0.9fr_0.7fr_auto] items-end gap-2">
              <Field label={i === 0 ? 'Category' : ''}><Select aria-label={`Category, line ${i + 1}`} value={l.category} onChange={(e) => setLine(i, 'category', e.target.value)}>{COST_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
              <Field label={i === 0 ? `Amount (${c})` : ''}><Input aria-label={`Amount, line ${i + 1}`} type="number" min={0} value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} /></Field>
              <Field label={i === 0 ? 'Who pays' : ''}><Select aria-label={`Who pays, line ${i + 1}`} value={l.payer} onChange={(e) => setLine(i, 'payer', e.target.value)}>
                <option value="">Not agreed</option>{COST_PAYERS.map((x) => <option key={x}>{x}</option>)}
              </Select></Field>
              <Field label={i === 0 ? 'Buyer use %' : ''}><Input aria-label={`Buyer use %, line ${i + 1}`} type="number" min={0} max={100} disabled={l.payer === 'Seller' || l.payer === 'Buyer'} value={l.usage} placeholder="50" onChange={(e) => setLine(i, 'usage', e.target.value)} /></Field>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
            </div>
          ))}
          <p className="num pt-1 text-[12.5px] text-ink-soft">Lines total {money(linesTotal, c, false)}{est ? ` · estimate ${money(est, c, false)}${linesTotal && Math.abs(linesTotal - est) >= 1 ? ` (difference ${money(linesTotal - est, c, false)})` : ''}` : ''}. Once there are cost lines, they are the one-time cost used in the analysis.</p>
        </div>
      </div>
    </SidePanel>
  );
}
