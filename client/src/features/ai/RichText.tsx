/**
 * Markdown-lite renderer for AI text. Handles **bold**, *italic*, `code`, headings (#, ##, ###), bullet and numbered
 * lists (incl. one level of nesting), "Label:" lines, [n] citations and line breaks. Unbalanced markers (e.g. an answer
 * that was cut short) are removed instead of being shown as stray "**".
 */
import { Fragment, type ReactNode } from 'react';

/** Remove unmatched ** and lone * so partial markdown never shows as raw symbols. */
function balance(line: string): string {
  let l = line;
  if (((l.match(/\*\*/g) ?? []).length) % 2 === 1) {
    const i = l.lastIndexOf('**');
    l = l.slice(0, i) + l.slice(i + 2);
  }
  const singles = l.replace(/\*\*/g, '').match(/(^|[^*])\*(?!\*)/g) ?? [];
  if (singles.length % 2 === 1) l = l.replace(/(^|[^*])\*(?!\*)(?!.*[^*]\*(?!\*))/, '$1');
  return l;
}

function inline(raw: string, keyPrefix: string): ReactNode[] {
  const text = balance(raw);
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[\d+\])/g).filter(Boolean);
  return parts.map((p, i) => {
    const k = `${keyPrefix}-${i}`;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={k} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={k}>{p.slice(1, -1)}</em>;
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={k} className="rounded bg-sunken px-1 font-mono text-[12px]">{p.slice(1, -1)}</code>;
    if (/^\[\d+\]$/.test(p)) return <sup key={k} className="ml-0.5 text-[10px] font-semibold text-piku">{p}</sup>;
    return <Fragment key={k}>{p}</Fragment>;
  });
}

interface Item { text: string; children: string[] }
interface ListBlock { ordered: boolean; items: Item[] }

export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: ListBlock | null = null;

  const flush = (k: number) => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    const cur = list;
    blocks.push(
      <Tag key={`l${k}`} className={`${cur.ordered ? 'list-decimal' : 'list-disc'} my-1 space-y-0.5 pl-5 marker:text-ink-muted`}>
        {cur.items.map((it, i) => (
          <li key={i}>
            {inline(it.text, `li${k}-${i}`)}
            {it.children.length > 0 && (
              <ul className="mt-0.5 list-[circle] space-y-0.5 pl-4">
                {it.children.map((c, j) => <li key={j}>{inline(c, `li${k}-${i}-${j}`)}</li>)}
              </ul>
            )}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const indent = (line.match(/^\s*/)?.[0].length ?? 0) >= 2;
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const body = (bullet ?? num)![1];
      if (indent && list && list.items.length) { list.items[list.items.length - 1].children.push(body); return; }
      const ordered = !!num;
      if (!list || list.ordered !== ordered) { flush(i); list = { ordered, items: [] }; }
      list.items.push({ text: body, children: [] });
      return;
    }
    flush(i);
    if (!line.trim()) { blocks.push(<div key={`s${i}`} className="h-1.5" />); return; }
    const heading = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(<p key={`h${i}`} className="mt-1 font-semibold text-ink">{inline(heading[2].replace(/\*\*/g, ''), `h${i}`)}</p>);
      return;
    }
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) return; // horizontal rules add nothing in a chat bubble
    blocks.push(<p key={`p${i}`} className="leading-relaxed">{inline(line, `p${i}`)}</p>);
  });
  flush(lines.length);
  return <div className={`space-y-0.5 text-sm text-ink-soft ${className}`}>{blocks}</div>;
}
