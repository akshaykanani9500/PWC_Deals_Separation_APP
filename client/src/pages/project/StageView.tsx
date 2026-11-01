/**
 * One stage: gate strip, sticky activity tabs (with a Stage overview entry), then either the stage overview
 * (clickable activity cards) or the selected activity. Both show the right-hand context panel.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Pencil, ListPlus, LayoutGrid, Ban, CalendarDays, ChevronRight, Users, MessagesSquare } from 'lucide-react';
import type { Communication, Contact, ProjectDetail, Stage, StageDetail } from '@shared/types';
import { useApi } from '../../hooks/useApi';
import { post } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Avatar, Button, Pill, Skeleton, Progress, EmptyState, onTabListKey } from '../../components/ui';
import { useToast } from '../../components/toast';
import { date, isOverdue } from '../../lib/format';
import AiSummaryCard from '../../features/ai/AiSummaryCard';
import AiActions from '../../features/ai/AiActions';
import ActivityView, { CommList } from './ActivityView';
import ScrollTabs from '../../components/ScrollTabs';
import { ActivityEditorPanel } from './ActivityEditorPanel';
import { ContactList, PanelSection, ProjectSnapshot, WithRightPanel } from './RightPanel';

type StageRow = ProjectDetail['stages'][number];

export default function StageView({ projectId, stage, detail, activityId, version, onChanged, onActivityName }: {
  projectId: string; stage: StageRow; detail: ProjectDetail; activityId?: string; version: number; onChanged: () => void;
  onActivityName?: (name: string | undefined) => void;
}) {
  const { data, error, loading, reload } = useApi<StageDetail>(`/stages/${stage.stage_id}`, [stage.stage_id]);
  const [editor, setEditor] = useState(false);
  useEffect(() => { if (version) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [version]);

  const activities = data ? [...data.activities].sort((a, b) => a.sort_order - b.sort_order) : [];
  const active = activities.find((a) => a.activity_id === activityId);
  useEffect(() => { onActivityName?.(active?.name); }, [active?.name, onActivityName]);
  const canEditActivities = !!data?.perms.canEditActivities && detail.project.status !== 'Closed';
  const base = `/projects/${projectId}/stages/${stage.stage_id}`;

  return (
    <div className="card rounded-tl-none">
      <GateStrip stage={data?.stage ?? stage} detail={detail} onChanged={onChanged} />

      <div className="sticky top-[161px] z-20 flex items-center gap-2 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
        <Link to={base} aria-current={!activityId ? 'page' : undefined}
          className={clsx('inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors',
            !activityId ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink hover:bg-sunken')}>
          <LayoutGrid size={14} aria-hidden /> Stage overview
        </Link>
        <span className="h-6 w-px shrink-0 bg-line" aria-hidden />
        <ScrollTabs label="Activities" onKeyDown={onTabListKey} fadeFrom="from-surface">
          {loading && !data && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-40 shrink-0" />)}
          {activities.map((a, i) => {
            const on = a.activity_id === activityId;
            const pct = Math.round(a.percent_complete ?? 0);
            return (
              <Link key={a.activity_id} role="tab" aria-selected={on} tabIndex={on || (!activityId && i === 0) ? 0 : -1}
                aria-label={`${a.name}, ${pct}% complete${a.status === 'Blocked' ? ', has blocked tasks' : ''}`}
                to={`${base}/activities/${a.activity_id}`}
                title={`${a.name}${a.owner_name ? ` (owner: ${a.owner_name})` : ''}`}
                className={clsx('inline-flex h-9 max-w-[280px] shrink-0 items-center gap-2 rounded-md border px-3 text-[13px] transition-colors',
                  on ? 'border-brand bg-brand-soft font-semibold text-brand-dark' : 'border-line-strong/70 bg-surface text-ink hover:border-ink-muted hover:bg-sunken')}>
                <span className="truncate">{a.name}</span>
                <span className={clsx('num shrink-0 rounded px-1.5 text-[11.5px] font-medium', pct >= 100 ? 'bg-green-soft text-green' : on ? 'bg-surface text-brand-dark' : 'bg-sunken text-ink-soft')}>{pct}%</span>
                {a.status === 'Blocked' && <Ban size={13} className="shrink-0 text-rose" aria-label="Has blocked tasks" />}
              </Link>
            );
          })}
        </ScrollTabs>
        <button onClick={() => setEditor(true)} disabled={!canEditActivities}
          title={canEditActivities ? 'Add, edit, reorder or remove activities' : 'Your role cannot change activities in this stage'}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium shadow-card hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-45">
          <Pencil size={14} aria-hidden /> Edit activities
        </button>
      </div>

      {error && <p className="px-4 py-6 text-rose">Could not load this stage: {error.message}</p>}
      {data && activityId && !active && <p className="px-4 py-8 text-center text-ink-soft">That activity is not in this stage. Pick one of the activities above.</p>}
      {data && !activityId && (
        <StageOverview data={data} detail={detail} base={base} version={version} canEdit={canEditActivities} onPlan={() => setEditor(true)} />
      )}
      {active && <ActivityView key={active.activity_id} activityId={active.activity_id} projectId={projectId} detail={detail} version={version} onChanged={() => { onChanged(); reload(); }} />}

      {data && (
        <ActivityEditorPanel open={editor} onClose={() => setEditor(false)} stageDetail={data} projectId={projectId}
          onSaved={() => { reload(); onChanged(); }} />
      )}
    </div>
  );
}

function StageOverview({ data, detail, base, version, canEdit, onPlan }: {
  data: StageDetail; detail: ProjectDetail; base: string; version: number; canEdit: boolean; onPlan: () => void;
}) {
  const activities = [...data.activities].sort((a, b) => a.sort_order - b.sort_order);
  const total = activities.reduce((n, a) => n + a.task_count, 0);
  const done = activities.reduce((n, a) => n + a.done_count, 0);
  const main = (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Activities in this stage</h3>
        <span className="num text-[12.5px] text-ink-muted">{activities.length} activities, {done} of {total} tasks done</span>
      </div>
      {!activities.length ? (
        <EmptyState icon={<ListPlus size={22} />} title="No activities in this stage yet"
          body={canEdit ? 'Add activities yourself or ask for an AI suggestion based on similar past deals.' : 'The engagement manager has not planned this stage yet.'}
          action={canEdit ? <Button variant="primary" icon={<ListPlus size={14} />} onClick={onPlan}>Plan activities</Button> : undefined} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {activities.map((a) => {
            const late = isOverdue(a.due_date, a.status);
            return (
              <li key={a.activity_id}>
                <Link to={`${base}/activities/${a.activity_id}`} className="card-action group flex h-full flex-col gap-2.5 p-3.5"
                  aria-label={`Open activity ${a.name}`}>
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-ink group-hover:text-link">{a.name}</span>
                    <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-link" aria-hidden />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill>{a.status ?? 'Not Started'}</Pill>
                    {a.priority && <Pill>{a.priority}</Pill>}
                  </div>
                  <Progress value={a.percent_complete} />
                  <div className="mt-auto flex items-center justify-between gap-2 text-[12.5px] text-ink-soft">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {a.owner_name ? <><Avatar name={a.owner_name} size={20} /><span className="truncate">{a.owner_name}</span></> : <span className="text-ink-muted">No owner</span>}
                    </span>
                    <span className={clsx('num inline-flex shrink-0 items-center gap-1', late && 'font-medium text-rose')}>
                      <CalendarDays size={13} aria-hidden />{date(a.due_date)}{late && ' (late)'}
                    </span>
                  </div>
                  <div className="num text-[12px] text-ink-muted">{a.done_count} of {a.task_count} tasks done</div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
  return (
    <WithRightPanel label="Stage context" main={main} panel={<StagePanel detail={detail} stage={data.stage} version={version} />} />
  );
}

function StagePanel({ detail, stage, version }: { detail: ProjectDetail; stage: Stage; version: number }) {
  const pid = detail.project.project_id;
  const contacts = useApi<Contact[]>(`/projects/${pid}/contacts`, [pid]);
  const comms = useApi<Communication[]>(`/projects/${pid}/communications?stageId=${stage.stage_id}`, [pid, stage.stage_id, version]);
  return (
    <>
      <ProjectSnapshot detail={detail} version={version} />
      <AiSummaryCard scope="stage" id={stage.stage_id} />
      <AiActions scope="stage" id={stage.stage_id} />
      {(contacts.data?.length ?? 0) > 0 && (
        <PanelSection title="Contacts" icon={<Users size={14} />}>
          <ContactList contacts={contacts.data!.slice(0, 5)} />
        </PanelSection>
      )}
      <PanelSection title="Recent communications" icon={<MessagesSquare size={14} />}>
        {comms.loading && !comms.data ? <Skeleton className="h-16" /> : <CommList comms={(comms.data ?? []).slice(0, 5)} />}
      </PanelSection>
    </>
  );
}

function GateStrip({ stage, detail, onChanged }: { stage: Stage; detail: ProjectDetail; onChanged: () => void }) {
  const toast = useToast();
  const { session } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const canEdit = detail.perms.canEditStages && detail.project.status !== 'Closed';
  const canApprove = detail.perms.canApproveGate && detail.project.status !== 'Closed';

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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-3">
      <div className="min-w-[260px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-semibold">{stage.name}</h2>
          <Pill>{stage.status ?? 'Not Started'}</Pill>
          {stage.start_date && <span className="num text-[12.5px] text-ink-muted">{date(stage.start_date, false)} to {date(stage.end_date)}</span>}
        </div>
        {stage.description && <p className="mt-0.5 max-w-[90ch] text-[13px] text-ink-soft">{stage.description}</p>}
      </div>
      <div className="w-44"><Progress value={stage.percent_complete} /></div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-1.5">
        <span className="text-[12.5px] font-medium text-ink-soft">Stage gate</span>
        <Pill>{status}</Pill>
        {stage.gate_criteria && <span className="hidden max-w-[300px] truncate text-[12.5px] text-ink-soft 2xl:inline" title={stage.gate_criteria}>{stage.gate_criteria}</span>}
        {status === 'Not Ready' && canEdit && <Button size="sm" onClick={() => gate('request')} loading={busy === 'request'}>Request approval</Button>}
        {status === 'Pending Approval' && (canApprove
          ? <Button size="sm" variant="primary" onClick={() => gate('approve')} loading={busy === 'approve'}>Approve gate</Button>
          : <span className="text-[12.5px] text-ink-muted" title={`${session?.persona.name ?? 'Your role'} cannot approve stage gates`}>Waiting for partner</span>)}
        {status === 'Approved' && canApprove && <Button size="sm" variant="ghost" onClick={() => gate('reopen')} loading={busy === 'reopen'}>Reopen</Button>}
      </div>
    </div>
  );
}
