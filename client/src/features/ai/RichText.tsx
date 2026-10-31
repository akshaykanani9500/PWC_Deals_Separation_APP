/** Markdown-lite renderer for AI text: **bold**, bullet lines (- or •), numbered lines, [n] citations, line breaks. */
import { Fragment, type ReactNode } from 'react';

function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${keyPrefix}-${i}`} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
    if (/^\[\d+\]$/.test(p)) return <sup key={`${keyPrefix}-${i}`} className="ml-0.5 text-[10px] font-semibold text-piku">{p}</sup>;
    return <Fragment key={`${keyPrefix}-${i}`}>{p}</Fragment>;
  });
}

export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  const lines = (text || '').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (k: number) => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${k}`} className={`${list.ordered ? 'list-decimal' : 'list-disc'} my-1 space-y-0.5 pl-5 marker:text-ink-muted`}>
        {list.items.map((it, i) => <li key={i}>{inline(it, `li${k}-${i}`)}</li>)}
      </Tag>,
    );
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(i); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      return;
    }
    flush(i);
    if (!line.trim()) { blocks.push(<div key={`s${i}`} className="h-2" />); return; }
    blocks.push(<p key={`p${i}`} className="leading-relaxed">{inline(line, `p${i}`)}</p>);
  });
  flush(lines.length);
  return <div className={`text-sm text-ink-soft ${className}`}>{blocks}</div>;
}
