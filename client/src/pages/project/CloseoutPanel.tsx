/** Close-out wizard: metrics, reuse consent, redactions, lessons learned, knowledge items -> knowledge hub. */
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { CloseoutPreview, ConsentStatus, ProjectDetail } from '@shared/types';
import { CONSENT_STATUS } from '@shared/schema';
import { get, post } from '../../lib/api';
import { SidePanel } from '../../components/SidePanel';
import { AiLabel, Pill, Select, Skeleton, Textarea } from '../../components/ui';
import { useToast } from '../../components/toast';

type Item = CloseoutPreview['proposedItems'][number] & { pick: boolean };

function Step({ n, title, children, hint }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="relative border-l border-line pb-6 pl-6 last:pb-0">
      <span className="num absolute -left-[11px] top-0 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ink text-[11px] text-white">{n}</span>
      <h3 className="text-[14px] font-semibold leading-[22px]">{title}</h3>
      {hint && <p className="mb-2 text-[12.5px] text-ink-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function CloseoutPanel({ open, detail, onClose, onClosed }: { open: boolean; detail: ProjectDetail; onClose: () => void; onClosed: () => void }) {
  const toast = useToast();
  const [preview, setPreview] = useState<CloseoutPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentStatus>('Pending');
  const [lessons, setLessons] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null); setError(null);
    get<CloseoutPreview>(`/projects/${detail.project.project_id}/closeout/preview`)
      .then((p) => {
        setPreview(p); setLessons(p.lessonsDraft ?? '');
        setItems((p.proposedItems ?? []).map((i) => ({ ...i, pick: true })));
        setConsent((p.project.reuse_consent as ConsentStatus) || 'Pending');
      })
      .catch((e) => setError(e.message));
  }, [open, detail.project.project_id]);

  async function submit() {
    setSaving(true);
    try {
      const res = await post<{ knowledgeItems: unknown[] }>(`/projects/${detail.project.project_id}/closeout`, {
        consent, lessons, items: consent === 'Granted' ? items.filter((i) => i.pick).map(({ pick: _p, ...rest }) => rest) : [],
      });
      const n = res?.knowledgeItems?.length ?? 0;
      toast.success(consent === 'Granted' ? `Project closed. ${n} item${n === 1 ? '' : 's'} sent to the knowledge hub for review.` : 'Project closed and archived. Nothing was shared because reuse consent was not granted.');
      onClosed(); onClose();
    } catch (e) { toast.error(e); } finally { setSaving(false); }
  }

  const picked = items.filter((i) => i.pick).length;

  return (
    <SidePanel open={open} onClose={onClose} width="xl" title={`Close ${detail.project.code_name}`}
      subtitle="Closing makes the project read-only. With client consent, redacted learnings go to the knowledge hub, where a knowledge manager approves them before AI can use them."
      onSave={submit} saving={saving} saveDisabled={!preview} saveLabel={consent === 'Granted' ? `Close and send ${picked} item${picked === 1 ? '' : 's'} for review` : 'Close and archive only'}>
      {error && <p className="rounded-md bg-rose-soft px-3 py-2 text-rose">{error}</p>}
      {!preview && !error && <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-40" /></div>}
      {preview && (
        <div className="pl-3">
          <Step n={1} title="Close-out metrics" hint="Captured for every deal so PwC can build its own benchmarks.">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {Object.entries(preview.metrics).map(([k, v]) => (
                <div key={k} className="rounded-md bg-sunken px-2.5 py-1.5">
                  <div className="text-[11px] text-ink-muted">{k.replace(/_/g, ' ')}</div>
                  <div className="num text-[14px] font-medium">{typeof v === 'number' ? v.toLocaleString() : v}</div>
                </div>
              ))}
            </div>
          </Step>
          <Step n={2} title="Client consent for reuse" hint="No content leaves this project without the client's permission recorded here.">
            <div className="flex items-center gap-3">
              <Select value={consent} onChange={(e) => setConsent(e.target.value as ConsentStatus)} className="w-48" aria-label="Reuse consent">
                {CONSENT_STATUS.map((c) => <option key={c}>{c}</option>)}
              </Select>
              <Pill>{consent}</Pill>
              {consent !== 'Granted' && <span className="text-[12.5px] text-ink-soft">Project will be archived only. No knowledge items are created.</span>}
            </div>
          </Step>
          <Step n={3} title="Automatic redactions" hint="Client names, people, emails, phone numbers and client money figures are masked before anything is shared.">
            {preview.redactions.length ? (
              <div className="max-h-56 overflow-auto rounded-lg border border-line">
                <table className="w-full text-[12.5px]">
                  <thead><tr><th className="th">Where</th><th className="th">Original</th><th className="th">Shared as</th></tr></thead>
                  <tbody>{preview.redactions.map((r, i) => (
                    <tr key={i}><td className="td text-ink-muted">{r.field}</td><td className="td"><span className="rounded bg-rose-soft px-1 text-rose line-through decoration-rose/50">{r.original}</span></td><td className="td"><span className="rounded bg-green-soft px-1 text-green">{r.redacted}</span></td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="flex items-center gap-1.5 text-[12.5px] text-ink-soft"><ShieldCheck size={14} className="text-green" /> Nothing identifying was found.</p>}
          </Step>
          <Step n={4} title="Lessons learned" hint="Drafted from the project's history. Edit it before closing.">
            <div className="mb-1.5"><AiLabel mode={preview.mode} /></div>
            <Textarea value={lessons} onChange={(e) => setLessons(e.target.value)} rows={10} style={{ minHeight: 200 }} aria-label="Lessons learned" />
          </Step>
          <Step n={5} title="Knowledge items to share" hint="Each item becomes a reusable template or lesson once approved in the knowledge hub.">
            <ul className={`space-y-1.5 ${consent !== 'Granted' ? 'pointer-events-none opacity-40' : ''}`}>
              {items.map((it, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md border border-line px-2.5 py-2">
                  <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[#D04A02]" checked={it.pick} onChange={(e) => setItems((s) => s.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))} aria-label={`Share ${it.title}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium">{it.title}</span><Pill>{it.item_type}</Pill>{it.stage_name && <span className="text-[11.5px] text-ink-muted">{it.stage_name}</span>}</div>
                    {it.body && <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-soft">{it.body}</p>}
                  </div>
                </li>
              ))}
              {!items.length && <li className="text-[12.5px] text-ink-muted">No items proposed.</li>}
            </ul>
          </Step>
        </div>
      )}
    </SidePanel>
  );
}
