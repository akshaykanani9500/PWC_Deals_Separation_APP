/** Current projects table: searchable, filterable, sortable; each row opens the project. */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, FolderOpen } from 'lucide-react';
import type { ProjectListItem } from '@shared/types';
import { PROJECT_STATUS, INDUSTRIES, RAG } from '@shared/schema';
import { useApi } from '../../hooks/useApi';
import { useSort } from '../../hooks/useSort';
import { SortHeader } from '../../components/SortHeader';
import { Checkbox, EmptyState, Input, Pill, Progress, RagDot, Select, Skeleton } from '../../components/ui';
import { date, money } from '../../lib/format';

export default function ProjectsTable({ financeVisible }: { financeVisible: boolean }) {
  const nav = useNavigate();
  const { data, loading, error } = useApi<ProjectListItem[]>('/projects?includeClosed=1');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [industry, setIndustry] = useState('');
  const [rag, setRag] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((p) =>
      (includeClosed || p.status !== 'Closed') &&
      (!status || p.status === status) && (!industry || p.industry === industry) && (!rag || p.rag === rag) &&
      (!s || [p.code_name, p.client_alias, p.deal_type, p.industry, p.partner_name, p.manager_name, p.current_stage_name, p.project_id]
        .some((v) => v?.toLowerCase().includes(s))));
  }, [data, q, status, industry, rag, includeClosed]);

  const { sorted, sort, toggle } = useSort(rows, { key: 'code_name' }, {
    open: (p) => p.open_tasks, rag: (p) => ({ Red: 0, Amber: 1, Green: 2 } as Record<string, number>)[p.rag ?? ''] ?? 3,
  });

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="mr-2 text-[15px] font-semibold">Current projects</h2>
        <span className="num text-[12px] text-ink-muted">{rows.length} shown</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project, client, people" className="w-60 pl-8" aria-label="Search projects" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-32" aria-label="Filter by status">
            <option value="">All statuses</option>{PROJECT_STATUS.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select value={industry} onChange={(e) => setIndustry(e.target.value)} className="w-44" aria-label="Filter by industry">
            <option value="">All industries</option>{INDUSTRIES.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select value={rag} onChange={(e) => setRag(e.target.value)} className="w-28" aria-label="Filter by RAG">
            <option value="">Any RAG</option>{RAG.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Checkbox checked={includeClosed} onChange={setIncludeClosed} label="Include closed" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead>
            <tr>
              <SortHeader label="Project" k="code_name" sort={sort} onSort={toggle} />
              <SortHeader label="Client" k="client_alias" sort={sort} onSort={toggle} />
              <SortHeader label="Deal type" k="deal_type" sort={sort} onSort={toggle} />
              <SortHeader label="Current stage" k="current_stage_name" sort={sort} onSort={toggle} />
              <SortHeader label="Complete" k="percent_complete" sort={sort} onSort={toggle} className="w-36" />
              <SortHeader label="Status" k="status" sort={sort} onSort={toggle} />
              <SortHeader label="RAG" k="rag" sort={sort} onSort={toggle} />
              <SortHeader label="Partner" k="partner_name" sort={sort} onSort={toggle} />
              <SortHeader label="Manager" k="manager_name" sort={sort} onSort={toggle} />
              <SortHeader label="Target close" k="target_close_date" sort={sort} onSort={toggle} />
              <SortHeader label="Open / overdue" k="open" sort={sort} onSort={toggle} align="right" />
              {financeVisible && <SortHeader label="TSA / month" k="tsa_monthly_cost" sort={sort} onSort={toggle} align="right" />}
            </tr>
          </thead>
          <tbody>
            {loading && !data && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={12} className="td"><Skeleton className="h-5 w-full" /></td></tr>
            ))}
            {sorted.map((p) => (
              <tr key={p.project_id} className="cursor-pointer hover:bg-canvas" onClick={() => nav(`/projects/${p.project_id}`)}>
                <td className="td">
                  <Link to={`/projects/${p.project_id}`} className="whitespace-nowrap font-medium text-ink underline-offset-2 hover:text-brand hover:underline" onClick={(e) => e.stopPropagation()}>{p.code_name}</Link>
                  <div className="num text-[11px] text-ink-muted">{p.project_id}</div>
                </td>
                <td className="td max-w-[200px] truncate text-ink-soft" title={p.client_alias}>{p.client_alias || '–'}</td>
                <td className="td whitespace-nowrap text-ink-soft">{p.deal_type || '–'}</td>
                <td className="td whitespace-nowrap">{p.current_stage_name || '–'}</td>
                <td className="td"><Progress value={p.percent_complete} /></td>
                <td className="td"><Pill>{p.status}</Pill></td>
                <td className="td"><RagDot rag={p.rag} withLabel /></td>
                <td className="td whitespace-nowrap">{p.partner_name || '–'}</td>
                <td className="td whitespace-nowrap">{p.manager_name || '–'}</td>
                <td className="td num whitespace-nowrap text-[12.5px]">{date(p.target_close_date)}</td>
                <td className="td num text-right text-[12.5px]">{p.open_tasks}<span className="text-ink-muted"> / </span><span className={p.overdue_tasks ? 'font-medium text-rose' : 'text-ink-muted'}>{p.overdue_tasks}</span></td>
                {financeVisible && <td className="td num text-right text-[12.5px]">{money(p.tsa_monthly_cost, p.currency)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p className="px-4 py-6 text-[13px] text-rose">Could not load projects: {error.message}</p>}
        {data && !rows.length && (
          <EmptyState icon={<FolderOpen size={28} />} title="No projects match"
            body={data.length ? 'Clear the search or filters to see more.' : 'You are not staffed on any project yet. A partner or manager can add you to a team.'} />
        )}
      </div>
    </section>
  );
}
