/** One stage: gate strip, activity sub-tabs and the selected activity. */
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Pencil, ListPlus } from 'lucide-react';
import type { ProjectDetail, Stage, StageDetail } from '@shared/types';
import { useApi } from '../../hooks/useApi';
import { post } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button, Pill, Skeleton, Progress, EmptyState } from '../../components/ui';
import { useToast } from '../../components/toast';
import { date } from '../../lib/format';
import ActivityView from './ActivityView';
import { ActivityEditorPanel } from './ActivityEditorPanel';

type StageRow = ProjectDetail['stages'][number];

export default function StageView({ projectId, stage, detail, activityId, version, onChanged }: {
  projectId: string; stage: StageRow; detail: ProjectDetail; activityId?: string; version: number; onChanged: () => void;
}) {
  const loc = useLocation();
  const { data, error, loading, reload } = useApi<StageDetail>(`/stages/${stage.stage_id}`, [stage.stage_id]);
  const [editor, setEditor] = useState(false);
  useEffect(() => { if (version) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  const activities = data ? [...data.activities].sort((a, b) => a.sort_order - b.sort_order) : [];
  const first = activities[0];
  if (data && !activityId && first) {
    return <Navigate replace to={`/projects/${projectId}/stages/${stage.stage_id}/activities/${first.activity_id}${loc.search}`} />;
  }
  const active = activities.find((a) => a.activity_id === activityId);
  const canEditActivities = !!data?.perms.canEditActivities && detail.project.status !== 'Closed';

  return (
    <div className="card rounded-tl-none">
      <GateStrip stage={data?.stage ?? stage} detail={detail} onChanged={onChanged} />

      <div className="flex items-end gap-1 overflow-x-auto border-b border-line px-4 pt-3" role="tablist" aria-label="Activities">
        {loading && !data && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mb-2 h-8 w-40" />)}
        {activities.map((a) => {
          const on = a.activity_id === activityId;
          return (
            <Link key={a.activity_id} role="tab" aria-selected={on} to={`/projects/${projectId}/stages/${stage.stage_id}/activities/${a.activity_id}`}
              title={`${a.name}${a.owner_name ? ` (owner: ${a.owner_name})` : ''}`}
              className={clsx('-mb-px flex max-w-[260px] shrink-0 items-center gap-2 border-b-2 px-3 pb-2 pt-1.5 text-[13px] transition-colors',
                on ? 'border-ink font-medium text-ink' : 'border-transparent text-ink-soft hover:border-line hover:text-ink')}>
              <span className="truncate">{a.name}</span>
              <span className={clsx('num shrink-0 rounded px-1 text-[11px]', (a.percent_complete ?? 0) >= 100 ? 'bg-green-soft text-green' : 'bg-sunken text-ink-muted')}>{Math.round(a.percent_complete ?? 0)}%</span>
              {a.status === 'Blocked' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose" title="Has blocked items" />}
            </Link>
          );
        })}
        <button onClick={() => setEditor(true)} disabled={!canEditActivities}
          title={canEditActivities ? 'Add, edit, reorder or remove activities' : 'Your role cannot change activities in this stage'}
          className="mb-1 ml-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-ink-muted hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
          <Pencil size={13} /> Edit
        </button>
      </div>

      {error && <p className="px-4 py-6 text-rose">Could not load this stage: {error.message}</p>}
      {data && !activities.length && (
        <EmptyState icon={<ListPlus size={28} />} title="No activities in this stage yet"
          body={canEditActivities ? 'Add activities yourself or ask for an AI suggestion based on similar past deals.' : 'The engagement manager has not planned this stage yet.'}
          action={canEditActivities ? <Button variant="primary" onClick={() => setEditor(true)}>Plan activities</Button> : undefined} />
      )}
      {data && activityId && !active && <p className="px-4 py-8 text-center text-ink-soft">That activity is not in this stage. Pick one of the tabs above.</p>}
      {active && <ActivityView key={active.activity_id} activityId={active.activity_id} projectId={projectId} detail={detail} version={version} onChanged={() => { onChanged(); reload(); }} />}

      {data && (
        <ActivityEditorPanel open={editor} onClose={() => setEditor(false)} stageDetail={data} projectId={projectId}
          onSaved={() => { reload(); onChanged(); }} />
      )}
    </div>
  );
}

function GateStrip({ stage, detail, onChanged }: { stage: Stage; detail: ProjectDetail; onChanged: () => void }) {
  const toast = useToast();
  const { session } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = detail.perms.canEditStages;
  const canApprove = detail.perms.canApproveGate;

  async function gate(action: 'request' | 'approve' | 'reopen') {
    setBusy(action);
    try {
      await post(`/stages/${stage.stage_id}/gate`, { action });
      toast.success(action === 'approve' ? `Gate approved for ${stage.name}` : action === 'request' ? 'Approval requested from the partner' : 'Gate reopened');
      onChanged();
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  }

  const status = stage.gate_status ?? 'Not Ready';
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-canvas/70 px-4 py-3">
      <div className="min-w-[260px] flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold">{stage.name}</h2>
          <Pill>{stage.status ?? 'Not Started'}</Pill>
          {stage.start_date && <span className="num text-[12px] text-ink-muted">{date(stage.start_date, false)} to {date(stage.end_date)}</span>}
        </div>
        {stage.description && <p className="mt-0.5 max-w-[90ch] text-[12.5px] text-ink-soft">{stage.description}</p>}
      </div>
      <div className="w-40"><Progress value={stage.percent_complete} /></div>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5">
        <span className="text-[12px] text-ink-muted">Gate</span>
        <Pill>{status}</Pill>
        {stage.gate_criteria && <span className="hidden max-w-[320px] truncate text-[12px] text-ink-soft xl:inline" title={stage.gate_criteria}>{stage.gate_criteria}</span>}
        {status === 'Not Ready' && canEdit && <Button size="sm" onClick={() => gate('request')} loading={busy === 'request'}>Request approval</Button>}
        {status === 'Pending Approval' && (canApprove
          ? <Button size="sm" variant="primary" onClick={() => gate('approve')} loading={busy === 'approve'}>Approve gate</Button>
          : <span className="text-[12px] text-ink-muted" title={`${session?.persona.name ?? 'Your role'} cannot approve stage gates`}>Waiting for partner</span>)}
        {status === 'Approved' && canApprove && <Button size="sm" variant="ghost" onClick={() => gate('reopen')} loading={busy === 'reopen'}>Reopen</Button>}
      </div>
    </div>
  );
}
