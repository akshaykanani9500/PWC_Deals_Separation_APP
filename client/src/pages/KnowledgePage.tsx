/** Knowledge hub: redacted learnings from closed projects. KM / Risk approve items before AI may use them. */
import { useMemo, useState } from 'react';
import { Search, BookOpen, Check, X, ChevronRight } from 'lucide-react';
import type { KnowledgeItem } from '@shared/types';
import { KNOWLEDGE_TYPES, KNOWLEDGE_STATUS, INDUSTRIES, DEAL_TYPES } from '@shared/schema';
import { useApi } from '../hooks/useApi';
import { useSession } from '../lib/session';
import { patch } from '../lib/api';
import { SidePanel } from '../components/SidePanel';
import { Button, EmptyState, Input, Pill, Select, Skeleton } from '../components/ui';
import { useToast } from '../components/toast';
import { dateTime } from '../lib/format';

function parsePayload(raw?: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function PayloadView({ value }: { value: unknown }) {
  if (value == null) return null;
  if (typeof value === 'string') return <p className="whitespace-pre-wrap text-[12.5px]">{value}</p>;
  const v = value as Record<string, unknown>;
  const acts = (Array.isArray(v.activities) ? v.activities : Array.isArray(value) ? value : null) as Record<string, unknown>[] | null;
  if (acts) {
    return (
      <ol className="space-y-2">
        {acts.map((a, i) => (
          <li key={i} className="rounded-md border border-line p-2.5">
            <div className="text-[13px] font-medium">{String(a.name ?? a.title ?? `Item ${i + 1}`)}</div>
            {a.description ? <p className="text-[12px] text-ink-muted">{String(a.description)}</p> : null}
            {Array.isArray(a.tasks) && a.tasks.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-soft">
                {(a.tasks as Record<string, unknown>[]).map((t, j) => <li key={j}>{String(t.title ?? t.name)}{t.day1_critical === 'Y' ? ' (Day-1 critical)' : ''}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    );
  }
  if (Array.isArray(v.tasks)) {
    return <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">{(v.tasks as Record<string, unknown>[]).map((t, j) => <li key={j}>{String(t.title ?? t.name)}</li>)}</ul>;
  }
  return (
    <dl className="grid grid-cols-2 gap-2">
      {Object.entries(v).map(([k, val]) => (
        <div key={k} className="rounded bg-sunken px-2 py-1"><dt className="text-[11px] text-ink-muted">{k.replace(/_/g, ' ')}</dt><dd className="num text-[13px]">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</dd></div>
      ))}
    </dl>
  );
}

export default function KnowledgePage() {
  const { can } = useSession();
  const toast = useToast();
  const { data, loading, error, setData } = useApi<KnowledgeItem[]>('/knowledge');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [industry, setIndustry] = useState('');
  const [deal, setDeal] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canReview = can('knowledge.edit') || can('closeout.approve');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((k) => (!type || k.item_type === type) && (!status || k.review_status === status) && (!industry || k.industry === industry) && (!deal || k.deal_type === deal)
      && (!s || [k.title, k.body, k.tags, k.stage_name, k.source_label].some((v) => v?.toLowerCase().includes(s))))
      .sort((a, b) => (a.review_status === 'Pending Review' ? -1 : 0) - (b.review_status === 'Pending Review' ? -1 : 0) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  }, [data, q, type, status, industry, deal]);
  const pending = (data ?? []).filter((k) => k.review_status === 'Pending Review').length;
  const item = data?.find((k) => k.knowledge_id === openId);

  async function review(k: KnowledgeItem, review_status: 'Approved' | 'Rejected') {
    setBusy(review_status);
    try {
      const upd = await patch<KnowledgeItem>(`/knowledge/${k.knowledge_id}`, { review_status });
      setData((d) => d && d.map((x) => (x.knowledge_id === k.knowledge_id ? { ...x, ...upd } : x)));
      toast.success(review_status === 'Approved' ? 'Approved. AI suggestions can now use this item.' : 'Rejected. It will not be used.');
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[24px] font-semibold leading-tight">Knowledge hub</h1>
        <p className="max-w-[80ch] text-[13px] text-ink-soft">Redacted, consent-checked learnings from closed projects: stage and activity templates, lessons, risks and metrics. Approved items feed AI suggestions when teams plan new work.{canReview && pending ? ` ${pending} item${pending === 1 ? ' is' : 's are'} waiting for your review.` : ''}</p>
      </div>
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search knowledge" className="w-60 pl-8" aria-label="Search knowledge" />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-40" aria-label="Type"><option value="">All types</option>{KNOWLEDGE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Review status"><option value="">Any review status</option>{KNOWLEDGE_STATUS.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-48" aria-label="Industry"><option value="">All industries</option>{INDUSTRIES.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select value={deal} onChange={(e) => setDeal(e.target.value)} className="w-44" aria-label="Deal type"><option value="">All deal types</option>{DEAL_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          <span className="num ml-auto text-[12px] text-ink-muted">{rows.length} items</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead><tr><th className="th">Title</th><th className="th">Type</th><th className="th">Stage</th><th className="th">Industry</th><th className="th">Deal type</th><th className="th">Source</th><th className="th">Review</th><th className="th text-right">Used</th><th className="th w-10"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {loading && !data && Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={9} className="td"><Skeleton className="h-5" /></td></tr>)}
              {rows.map((k) => (
                <tr key={k.knowledge_id} className="row-action" onClick={() => setOpenId(k.knowledge_id)}>
                  <td className="td"><button type="button" className="link text-left text-[13.5px]" onClick={(e) => { e.stopPropagation(); setOpenId(k.knowledge_id); }}>{k.title}</button>{k.tags && <div className="text-[11.5px] text-ink-muted">{k.tags}</div>}</td>
                  <td className="td"><Pill tone="bg-blue-soft text-blue">{k.item_type}</Pill></td>
                  <td className="td text-ink-soft">{k.stage_name || '–'}</td>
                  <td className="td text-ink-soft">{k.industry || '–'}</td>
                  <td className="td whitespace-nowrap text-ink-soft">{k.deal_type || '–'}</td>
                  <td className="td text-ink-soft">{k.source_label || '–'}</td>
                  <td className="td"><Pill>{k.review_status}</Pill></td>
                  <td className="td num text-right">{k.times_used ?? 0}</td>
                  <td className="td pr-4 text-right"><ChevronRight size={16} className="row-chevron ml-auto" aria-hidden /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p className="px-4 py-6 text-rose">{error.message}</p>}
          {data && !rows.length && <EmptyState icon={<BookOpen size={26} />} title="No knowledge items match" body="Items appear here when projects are closed with client consent." />}
        </div>
      </section>

      <SidePanel open={!!item} onClose={() => setOpenId(null)} width="lg" title={item?.title ?? ''}
        subtitle={item && <span className="flex flex-wrap items-center gap-2"><Pill tone="bg-blue-soft text-blue">{item.item_type}</Pill><Pill>{item.review_status}</Pill>{item.consent_status && <span>Consent: {item.consent_status}</span>}</span>}
        footer={item && (
          <>
            <Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button>
            {canReview && item.review_status !== 'Rejected' && <Button variant="danger" icon={<X size={14} />} onClick={() => review(item, 'Rejected')} loading={busy === 'Rejected'}>Reject</Button>}
            {canReview && item.review_status !== 'Approved' && <Button variant="primary" icon={<Check size={14} />} onClick={() => review(item, 'Approved')} loading={busy === 'Approved'}>Approve for reuse</Button>}
          </>
        )}>
        {item && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-[12.5px] md:grid-cols-3">
              {([['Source', item.source_label], ['Industry', item.industry], ['Deal type', item.deal_type], ['Stage', item.stage_name], ['Reviewed', item.reviewed_at ? dateTime(item.reviewed_at) : 'Not yet'], ['Times used by AI', String(item.times_used ?? 0)]] as [string, string | undefined][]).map(([k, v]) => (
                <div key={k}><dt className="text-[11.5px] text-ink-muted">{k}</dt><dd>{v || '–'}</dd></div>
              ))}
            </dl>
            {item.body && <section><h4 className="mb-1 text-[13px] font-semibold">Content</h4><p className="max-w-[78ch] whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{item.body}</p></section>}
            {item.payload && <section><h4 className="mb-1 text-[13px] font-semibold">Template</h4><PayloadView value={parsePayload(item.payload)} /></section>}
            {!canReview && item.review_status === 'Pending Review' && <p className="rounded-md bg-sunken px-3 py-2 text-[12.5px] text-ink-soft">A knowledge manager or Risk & DPO reviewer must approve this item before AI can use it.</p>}
          </div>
        )}
      </SidePanel>
    </div>
  );
}
