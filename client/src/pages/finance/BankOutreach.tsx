/**
 * v1.4 bank outreach ("Ask a bank" on the Funding options tab): demo bank cards with the relationship manager,
 * a request panel with a server-side AI draft, and a tracker. Nothing is sent from the app.
 * Server enforces: Partner/Manager with finance.view draft; finance.edit (Partner) marks sent / term sheet / declined.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { Plus, Copy, Landmark, Mail, Phone, Send, Sparkles, FileCheck2, XCircle, MessageSquareReply, Pencil, Undo2 } from 'lucide-react';
import type { BankCard, FinanceWorkspace, FinancingRequestRow } from '@shared/types';
import { FINANCING_REQUEST_STATUS } from '@shared/schema';
import { patch, post } from '../../lib/api';
import { useToast } from '../../components/toast';
import { SidePanel } from '../../components/SidePanel';
import { AiLabel, Button, Field, Input, Pill, Select, Textarea } from '../../components/ui';
import { date } from '../../lib/format';
import { money } from './fmt';
import { Card, cur } from './tabs';

const STEPS = ['Draft', 'Sent', 'RM replied', 'Term sheet'] as const;
const statusTone: Record<string, string> = {
  Draft: 'bg-sunken text-ink-soft', Sent: 'bg-blue-soft text-blue', 'RM replied': 'bg-piku-soft text-piku', 'Term sheet': 'bg-green-soft text-green',
  Declined: 'bg-rose-soft text-rose', Withdrawn: 'bg-sunken text-ink-muted',
};

function Stepper({ status }: { status: string }) {
  const idx = STEPS.indexOf(status as (typeof STEPS)[number]);
  const ended = status === 'Declined' || status === 'Withdrawn';
  return (
    <ol className="flex items-center gap-1" aria-label={`Progress: ${status}`}>
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span className={clsx('h-1.5 w-6 rounded-full', !ended && i <= idx ? 'bg-green' : 'bg-line')} title={s} aria-hidden />
        </li>
      ))}
    </ol>
  );
}

interface Draft { request_id?: string; bank_code: string; product: string; amount: string; purpose: string; email_subject: string; email_body: string; next_follow_up: string; mode?: string; notes?: string[] }

function RequestPanel({ w, bank, row, onClose, onChanged }: { w: FinanceWorkspace; bank: BankCard; row?: FinancingRequestRow | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const c = cur(w);
  const pid = w.project.project_id;
  // Suggest only what still has no source once the pipeline is counted; when the pipeline covers the gap, suggest nothing.
  const suggested = Math.round(w.gap.gapAfterPipeline / 1000) * 1000;
  const amountHint = suggested
    ? `Suggested ${money(suggested, c)}: the part of the gap with no source after the options already in the pipeline`
    : w.gap.gap > 0
      ? `The pipeline (${money(w.gap.pipeline, c)}) already covers the ${money(w.gap.gap, c)} gap. Enter an amount only to compare a cheaper option.`
      : 'The one-time cost is fully funded. Enter an amount only if you need headroom.';
  const [f, setF] = useState<Draft>(() => row ? {
    request_id: row.request_id, bank_code: row.bank_code, product: row.product, amount: String(row.amount ?? ''), purpose: row.purpose ?? '',
    email_subject: row.email_subject ?? '', email_body: row.email_body ?? '', next_follow_up: row.next_follow_up ?? '',
  } : { bank_code: bank.code, product: bank.products[0], amount: suggested ? String(suggested) : '', purpose: '', email_subject: '', email_body: '', next_follow_up: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: keyof Draft, v: string) => setF((s) => ({ ...s, [k]: v }));
  const amount = Number(f.amount) || 0;
  const readOnly = !!row && !row.can.edit;

  const draftAi = async () => {
    setBusy('ai');
    try {
      const d = await post<{ subject: string; body: string; mode: string; notes: string[] }>(`/projects/${pid}/finance/bank-requests/draft-email`, { bank_code: f.bank_code, product: f.product, amount, purpose: f.purpose || null });
      setF((s) => ({ ...s, email_subject: d.subject, email_body: d.body, mode: d.mode, notes: d.notes }));
      toast.info('Email drafted. Check it before saving.');
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const save = async (): Promise<FinancingRequestRow | null> => {
    const body = { product: f.product, amount, purpose: f.purpose || null, email_subject: f.email_subject || null, email_body: f.email_body || null, next_follow_up: f.next_follow_up || null };
    return f.request_id
      ? patch<FinancingRequestRow>(`/projects/${pid}/finance/bank-requests/${f.request_id}`, body)
      : post<FinancingRequestRow>(`/projects/${pid}/finance/bank-requests`, { ...body, bank_code: f.bank_code });
  };
  const saveDraft = async () => {
    setBusy('save');
    try { const r = await save(); if (r) setF((s) => ({ ...s, request_id: r.request_id })); toast.success('Financing request saved as draft'); onChanged(); onClose(); }
    catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const markSent = async () => {
    setBusy('send');
    try {
      const r = await save();
      await post(`/projects/${pid}/finance/bank-requests/${r!.request_id}/status`, { status: 'Sent' });
      toast.success(`Marked as sent to ${bank.rm.name}; logged in the project emails`);
      onChanged(); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const mailto = `mailto:${bank.rm.email}?subject=${encodeURIComponent(f.email_subject)}&body=${encodeURIComponent(f.email_body)}`;
  const copy = async () => { try { await navigator.clipboard.writeText(`Subject: ${f.email_subject}\n\n${f.email_body}`); toast.info('Email copied'); } catch { toast.error('Copy is blocked by the browser; select the text instead.'); } };
  const ready = amount > 0 && f.product;

  return (
    <SidePanel open onClose={onClose} width="lg" title={row ? 'Financing request' : 'Request financing'} subtitle={`${w.project.code_name} · ${bank.name}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && w.bankPerms.canDraft && <Button loading={busy === 'save'} disabled={!ready} disabledReason="Enter an amount" onClick={saveDraft}>Save as draft</Button>}
          {!readOnly && w.bankPerms.canSend && <Button variant="primary" icon={<Send size={14} />} loading={busy === 'send'} disabled={!ready || !f.email_body} disabledReason="Draft the email first" onClick={markSent}>Mark as sent</Button>}
        </>
      )}>
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-sunken/60 px-3 py-2.5 text-[12.5px]">
          <div className="font-medium">{bank.rm.name}, {bank.rm.title}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-ink-soft">
            <a className="text-link hover:underline" href={`mailto:${bank.rm.email}`}>{bank.rm.email}</a>
            <a className="text-link hover:underline" href={`tel:${bank.rm.phone.replace(/\s/g, '')}`}>{bank.rm.phone}</a>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Amount (${c}) *`} hint={row ? undefined : amountHint}>
            <Input type="number" min={0} value={f.amount} disabled={readOnly} onChange={(e) => set('amount', e.target.value)} />
          </Field>
          <Field label="Product *">
            <Select value={f.product} disabled={readOnly} onChange={(e) => set('product', e.target.value)}>{bank.products.map((p) => <option key={p}>{p}</option>)}</Select>
          </Field>
          <Field label="Purpose" className="col-span-2"><Input value={f.purpose} disabled={readOnly} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. Day-1 licences and test equipment" /></Field>
          <Field label="Follow up on" className="col-span-1"><Input type="date" value={f.next_follow_up} disabled={readOnly} onChange={(e) => set('next_follow_up', e.target.value)} /></Field>
        </div>
        {amount > 0 && (amount < bank.minTicket || amount > bank.maxTicket) && (
          <p className="text-[12.5px] text-amber">This bank usually lends {money(bank.minTicket, c)} – {money(bank.maxTicket, c)}.</p>
        )}

        <div className="rounded-lg border border-amber/40 bg-amber-soft/40 px-3 py-2.5 text-[12.5px] text-ink-soft">
          <ul className="list-disc space-y-0.5 pl-4">
            {(f.notes ?? [
              'Share only anonymised, aggregated cost needs: no client name, no cost-line detail, no client contacts.',
              'Independence: if the client is a PwC audit client, PwC cannot arrange or broker finance. Check with Risk & Quality before sending.',
              ...(w.project.clean_team_required === 'Y' ? ['Clean team: competitively sensitive data stays inside the clean team until close.'] : []),
              'Nothing is sent from this app. Send it from your own mail client, then mark it as sent here.',
            ]).map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold">Email</h3>
            {f.mode && <AiLabel mode={f.mode} />}
            {!readOnly && w.bankPerms.canDraft && <Button size="sm" className="ml-auto" icon={<Sparkles size={14} />} loading={busy === 'ai'} disabled={!ready} disabledReason="Enter an amount" onClick={draftAi}>Draft email with AI</Button>}
          </div>
          <Field label="Subject"><Input value={f.email_subject} disabled={readOnly} onChange={(e) => set('email_subject', e.target.value)} /></Field>
          <Field label="Body" className="mt-2"><Textarea rows={14} value={f.email_body} disabled={readOnly} onChange={(e) => set('email_body', e.target.value)} /></Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" icon={<Copy size={14} />} disabled={!f.email_body} onClick={copy}>Copy</Button>
            <a className={clsx('inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium shadow-card hover:bg-sunken', !f.email_body && 'pointer-events-none opacity-50')} href={mailto}><Mail size={14} /> Open in mail app</a>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium shadow-card hover:bg-sunken" href={`tel:${bank.rm.phone.replace(/\s/g, '')}`}><Phone size={14} /> Call {bank.rm.name.split(' ')[0]}</a>
          </div>
        </div>
      </div>
    </SidePanel>
  );
}

function TermSheetPanel({ w, row, onClose, onChanged }: { w: FinanceWorkspace; row: FinancingRequestRow; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: String(row.amount ?? ''), rate: '', tenor: '', expected: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post(`/projects/${w.project.project_id}/finance/bank-requests/${row.request_id}/status`, {
        status: 'Term sheet', term: { amount: Number(f.amount) || undefined, interest_rate_pct: f.rate === '' ? null : Number(f.rate), tenor_months: f.tenor === '' ? null : Number(f.tenor), expected_date: f.expected || null },
      });
      toast.success('Term sheet recorded: funding line added to Costs & funding');
      onChanged(); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <SidePanel open onClose={onClose} title="Term sheet received" subtitle={`${row.bank_name} · ${row.product}`} onSave={save} saving={busy} saveLabel="Record term sheet" saveDisabled={!(Number(f.amount) > 0)}>
      <p className="mb-3 text-[12.5px] text-ink-soft">Creates (or updates) a funding line with status "Term sheet". It counts as pipeline, not secured, until it is committed.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${cur(w)}) *`}><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Interest rate %"><Input type="number" step="0.1" min={0} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label="Tenor (months)"><Input type="number" min={0} value={f.tenor} onChange={(e) => setF({ ...f, tenor: e.target.value })} /></Field>
        <Field label="Expected date"><Input type="date" value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} /></Field>
      </div>
    </SidePanel>
  );
}

export function AskABank({ w, onChanged, onAddToPlan }: { w: FinanceWorkspace; onChanged: () => void; onAddToPlan?: (bank: BankCard) => void }) {
  const toast = useToast();
  const c = cur(w);
  const [open, setOpen] = useState<{ bank: BankCard; row?: FinancingRequestRow } | null>(null);
  const [term, setTerm] = useState<FinancingRequestRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const bp = w.bankPerms;
  const bankOf = (code: string) => w.banks.find((b) => b.code === code)!;
  const status = async (r: FinancingRequestRow, s: string, msg: string) => {
    setBusy(r.request_id + s);
    try { await post(`/projects/${w.project.project_id}/finance/bank-requests/${r.request_id}/status`, { status: s }); toast.success(msg); onChanged(); }
    catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const rows = w.bankRequests.filter((r) => !filter || r.status === filter);

  return (
    <>
      <Card title="Ask a bank" right={<span className="text-[12px] text-ink-muted">{bp.canSend ? 'You can draft, send and track requests' : bp.canDraft ? 'You can draft; the Partner sends' : 'Read-only'}</span>}>
        <p className="mb-3 text-[12.5px] text-ink-soft">
          Draft a financing enquiry to a relationship manager. <b>Nothing is sent from this app</b>: copy the email or open it in your mail app, send it yourself, then mark it as sent.
          All banks and people below are fictional demo data.{bp.reason ? ` ${bp.reason}` : ''}
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {w.banks.map((b) => (
            <article key={b.code} className="flex flex-col rounded-lg border border-line px-3.5 py-3" aria-label={b.name}>
              <div className="flex items-start gap-2"><Landmark size={16} className="mt-[2px] shrink-0 text-ink-muted" /><h3 className="text-[13.5px] font-semibold leading-snug">{b.name}</h3></div>
              <div className="mt-0.5 text-[12px] text-ink-muted">{b.kind} · {b.region}</div>
              <div className="mt-2 flex flex-wrap gap-1">{b.products.map((o) => <span key={o} className="rounded bg-sunken px-1.5 py-[1px] text-[11.5px]">{o}</span>)}</div>
              <p className="mt-2 text-[12.5px] text-ink-soft">{b.terms}</p>
              <p className="num mt-1 text-[12px] text-ink-muted">Ticket {money(b.minTicket, c)} – {money(b.maxTicket, c)}</p>
              <div className="mt-2 border-t border-line pt-2 text-[12.5px]">
                <div className="font-medium">{b.rm.name}</div>
                <div className="text-[12px] text-ink-muted">{b.rm.title}</div>
                <div className="mt-1 flex flex-col gap-0.5">
                  <a className="inline-flex items-center gap-1 text-link hover:underline" href={`mailto:${b.rm.email}`}><Mail size={12} />{b.rm.email}</a>
                  <a className="inline-flex items-center gap-1 text-link hover:underline" href={`tel:${b.rm.phone.replace(/\s/g, '')}`}><Phone size={12} />{b.rm.phone}</a>
                </div>
              </div>
              <div className="flex-1" />
              <div className="mt-3 flex flex-wrap gap-2">
                {bp.canDraft && <Button size="sm" variant="primary" icon={<Send size={14} />} onClick={() => setOpen({ bank: b })} aria-label={`Request financing from ${b.name}`}>Request financing</Button>}
                {w.perms.canEdit && onAddToPlan && <Button size="sm" icon={<Plus size={14} />} onClick={() => onAddToPlan(b)} title={`Add ${b.name} to the funding plan`}>Add to funding plan</Button>}
              </div>
            </article>
          ))}
        </div>
      </Card>

      <Card title={`Financing requests (${w.bankRequests.length})`} right={(
        <Select className="h-8 w-40 text-[12.5px]" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter requests by status">
          <option value="">All statuses</option>{FINANCING_REQUEST_STATUS.map((s) => <option key={s}>{s}</option>)}
        </Select>
      )}>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[12.5px]">
            <colgroup><col className="w-[30%]" /><col className="w-[12%]" /><col className="w-[16%]" /><col className="w-[14%]" /><col className="w-[28%]" /></colgroup>
            <thead><tr><th className="th">Request</th><th className="th text-right">Amount</th><th className="th">Status</th><th className="th">Dates</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.request_id} aria-label={`Request ${r.request_id} to ${r.bank_name}`}>
                  <td className="td align-top">
                    <div className="truncate font-medium" title={r.bank_name}>{r.bank_name}</div>
                    <div className="truncate text-[11.5px] text-ink-muted">{r.product} · {r.rm_name}{r.owner_name ? ` · by ${r.owner_name}` : ''}</div>
                    {r.funding_id && <div className="text-[11.5px] text-green">Funding line: {r.funding_status ?? 'linked'}</div>}
                    {r.outdated && <div className="mt-1 rounded bg-amber-soft px-1.5 py-1 text-[11.5px] text-amber" role="note">{r.outdated}</div>}
                  </td>
                  <td className="td num align-top text-right font-medium">{money(r.amount, c)}</td>
                  <td className="td align-top"><Pill tone={statusTone[r.status]}>{r.status}</Pill><div className="mt-1.5"><Stepper status={r.status} /></div></td>
                  <td className="td num align-top text-[11.5px]">
                    <div><span className="text-ink-muted">Sent on </span>{r.sent_at ? date(r.sent_at) : '–'}</div>
                    <div><span className="text-ink-muted">Follow up </span>{r.next_follow_up ? date(r.next_follow_up) : '–'}</div>
                  </td>
                  <td className="td align-top">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setOpen({ bank: bankOf(r.bank_code), row: r })}>{r.can.edit ? 'Edit' : 'View'}</Button>
                      {r.can.markSent && <Button size="sm" variant="ghost" icon={<Send size={14} />} loading={busy === r.request_id + 'Sent'} disabled={!r.email_body} disabledReason="Draft the email first" onClick={() => status(r, 'Sent', `Marked as sent to ${r.rm_name}; logged in the project emails`)}>Mark sent</Button>}
                      {r.can.reply && <Button size="sm" variant="ghost" icon={<MessageSquareReply size={14} />} loading={busy === r.request_id + 'RM replied'} onClick={() => status(r, 'RM replied', 'Status updated: RM replied')}>RM replied</Button>}
                      {r.can.termSheet && <Button size="sm" variant="ghost" icon={<FileCheck2 size={14} />} onClick={() => setTerm(r)}>Term sheet received</Button>}
                      {r.can.decline && <Button size="sm" variant="ghost" icon={<XCircle size={14} />} loading={busy === r.request_id + 'Declined'} onClick={() => status(r, 'Declined', 'Status updated: declined')}>Declined</Button>}
                      {r.can.withdraw && <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} loading={busy === r.request_id + 'Withdrawn'} onClick={() => status(r, 'Withdrawn', 'Request withdrawn')}>Withdraw</Button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="td text-ink-muted">No financing requests{filter ? ` with status ${filter}` : ' yet'}.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {open && <RequestPanel w={w} bank={open.bank} row={open.row} onClose={() => setOpen(null)} onChanged={onChanged} />}
      {term && <TermSheetPanel w={w} row={term} onClose={() => setTerm(null)} onChanged={onChanged} />}
    </>
  );
}
