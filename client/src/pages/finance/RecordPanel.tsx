/** Add / edit one finance record (funding source, cost line or invoice) in a side panel. Server re-checks finance.edit. */
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { COST_CATEGORIES, COST_PAYERS, COST_STATUS, FUNDING_STATUS, FUNDING_TYPES, INVOICE_STATUS } from '@shared/schema';
import type { FinanceWorkspace } from '@shared/types';
import { del, patch, post } from '../../lib/api';
import { useToast } from '../../components/toast';
import { SidePanel, ConfirmDialog } from '../../components/SidePanel';
import { Button, Field, Input, Select, Textarea } from '../../components/ui';

export type FinanceKind = 'funding' | 'costs' | 'invoices';
type FieldDef = { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'month' | 'textarea'; options?: readonly (string | { value: string; label: string })[]; required?: boolean; hint?: string; half?: boolean };

const KIND_META: Record<FinanceKind, { title: string; pk: string; noun: string }> = {
  funding: { title: 'funding source', pk: 'funding_id', noun: 'Funding source' },
  costs: { title: 'cost line', pk: 'cost_id', noun: 'Cost line' },
  invoices: { title: 'invoice', pk: 'invoice_id', noun: 'Invoice' },
};

function fieldsFor(kind: FinanceKind, ws: FinanceWorkspace, people: { value: string; label: string }[]): FieldDef[] {
  const stages = [{ value: '', label: 'Not linked to a stage' }, ...ws.effort.byStage.map((s) => ({ value: s.key, label: s.label }))];
  if (kind === 'funding') return [
    { key: 'source_type', label: 'Type of funding', type: 'select', options: FUNDING_TYPES, required: true },
    { key: 'provider', label: 'Provider / party', type: 'text', hint: 'Bank, investor, seller, vendor (demo names are fictional)' },
    { key: 'amount', label: `Amount (${ws.project.currency})`, type: 'number', required: true, half: true },
    { key: 'status', label: 'Status', type: 'select', options: FUNDING_STATUS, required: true, half: true },
    { key: 'interest_rate_pct', label: 'Interest rate %', type: 'number', half: true },
    { key: 'tenor_months', label: 'Tenor (months)', type: 'number', half: true },
    { key: 'expected_date', label: 'Expected date', type: 'date', half: true },
    { key: 'owner_user_id', label: 'Tracked by', type: 'select', options: [{ value: '', label: 'Nobody yet' }, ...people], half: true },
    { key: 'purpose', label: 'What it pays for', type: 'textarea' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ];
  if (kind === 'costs') return [
    { key: 'category', label: 'Category', type: 'select', options: COST_CATEGORIES, required: true },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'amount', label: `Amount (${ws.project.currency})`, type: 'number', required: true, half: true },
    { key: 'status', label: 'Status', type: 'select', options: COST_STATUS, required: true, half: true },
    { key: 'payer', label: 'Who pays', type: 'select', options: ['', ...COST_PAYERS].map((p) => ({ value: p, label: p || 'Not agreed yet' })), half: true },
    { key: 'stage_id', label: 'Stage', type: 'select', options: stages, half: true },
    { key: 'buyer_usage_pct', label: 'Buyer use % (shared lines)', type: 'number', half: true, hint: 'Drives the usage-based split; 50% when empty' },
    { key: 'vendor', label: 'Vendor', type: 'text', half: true },
  ];
  return [
    { key: 'invoice_no', label: 'Invoice number', type: 'text', required: true, half: true },
    { key: 'period_month', label: 'Period', type: 'month', half: true },
    { key: 'amount', label: `Amount (${ws.project.currency})`, type: 'number', required: true, half: true },
    { key: 'status', label: 'Status', type: 'select', options: INVOICE_STATUS, required: true, half: true },
    { key: 'stage_id', label: 'Stage', type: 'select', options: stages, half: true },
    { key: 'billed_by_user_id', label: 'Billed by', type: 'select', options: [{ value: '', label: '–' }, ...people], half: true },
    { key: 'issued_date', label: 'Issued', type: 'date', half: true },
    { key: 'due_date', label: 'Due', type: 'date', half: true },
    { key: 'paid_date', label: 'Paid on', type: 'date', half: true },
    { key: 'billed_to', label: 'Billed to', type: 'text', half: true },
    { key: 'description', label: 'Description', type: 'text' },
  ];
}

const NUMERIC = new Set(['amount', 'interest_rate_pct', 'tenor_months', 'buyer_usage_pct']);

export default function RecordPanel({ open, kind, row, initial, ws, people, onClose, onSaved }: {
  open: boolean; kind: FinanceKind; row?: Record<string, any> | null; initial?: Record<string, any>; ws: FinanceWorkspace;
  people: { value: string; label: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const meta = KIND_META[kind];
  const defs = fieldsFor(kind, ws, people);
  const [f, setF] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    const start: Record<string, any> = {};
    for (const d of defs) {
      const v = row?.[d.key] ?? initial?.[d.key];
      start[d.key] = v ?? (d.type === 'select' && d.required ? (typeof d.options?.[0] === 'string' ? d.options[0] : (d.options?.[0] as any)?.value) : '');
    }
    setF(start);
  }, [open, row, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = defs.filter((d) => d.required && (f[d.key] === '' || f[d.key] == null));
  const save = async () => {
    const body: Record<string, any> = {};
    for (const d of defs) {
      const v = f[d.key];
      if (v === '' || v == null) { if (row) body[d.key] = null; continue; }
      body[d.key] = NUMERIC.has(d.key) ? Number(v) : v;
    }
    setSaving(true);
    try {
      const base = `/projects/${ws.project.project_id}/finance/${kind}`;
      if (row) await patch(`${base}/${row[meta.pk]}`, body); else await post(base, body);
      toast.success(row ? `${meta.noun} saved` : `${meta.noun} added`);
      onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!row) return;
    setSaving(true);
    try { await del(`/projects/${ws.project.project_id}/finance/${kind}/${row[meta.pk]}`); toast.success(`${meta.noun} removed`); setConfirm(false); onSaved(); onClose(); }
    catch (e) { toast.error(e); } finally { setSaving(false); }
  };

  return (
    <SidePanel open={open} onClose={onClose} width="md" title={row ? `Edit ${meta.title}` : `Add ${meta.title}`} subtitle={`${ws.project.code_name} · every change is recorded in the audit log`}
      footer={(
        <>
          {row && <Button variant="danger" icon={<Trash2 size={14} />} className="mr-auto" onClick={() => setConfirm(true)}>Remove</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={missing.length > 0} disabledReason={`Fill in: ${missing.map((m) => m.label).join(', ')}`} onClick={save}>{row ? 'Save changes' : 'Add'}</Button>
        </>
      )}>
      <div className="grid grid-cols-2 gap-3">
        {defs.map((d) => {
          const set = (v: any) => setF((s) => ({ ...s, [d.key]: v }));
          const label = `${d.label}${d.required ? ' *' : ''}`;
          return (
            <Field key={d.key} label={label} hint={d.hint} className={d.half ? '' : 'col-span-2'}>
              {d.type === 'select' ? (
                <Select value={f[d.key] ?? ''} onChange={(e) => set(e.target.value)}>
                  {d.options!.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : d.type === 'textarea' ? (
                <Textarea rows={2} value={f[d.key] ?? ''} onChange={(e) => set(e.target.value)} />
              ) : (
                <Input type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : d.type === 'month' ? 'month' : 'text'} min={d.type === 'number' ? 0 : undefined}
                  step={d.key === 'interest_rate_pct' ? '0.1' : undefined} value={f[d.key] ?? ''} onChange={(e) => set(e.target.value)} />
              )}
            </Field>
          );
        })}
      </div>
      <ConfirmDialog open={confirm} title={`Remove this ${meta.title}?`} body="It disappears from the workspace; the audit log keeps the history." confirmLabel="Remove" busy={saving}
        onCancel={() => setConfirm(false)} onConfirm={remove} />
    </SidePanel>
  );
}
