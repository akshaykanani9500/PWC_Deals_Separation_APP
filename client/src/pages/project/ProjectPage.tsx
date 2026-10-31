/**
 * Project page (sketch 3): header, Chrome-style stage tabs, activity sub-tabs, task table + right panel.
 * Routes: /projects/:projectId[/stages/:stageId[/activities/:activityId]]  and ?task=TSK-… opens the task panel.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { ProjectDetail } from '@shared/types';
import { useApi } from '../../hooks/useApi';
import { Skeleton } from '../../components/ui';
import { ForbiddenPage, NotFoundPage } from '../StatusPages';
import ProjectHeader from './ProjectHeader';
import StageTabs from './StageTabs';
import StageView from './StageView';
import TaskPanel from './TaskPanel';
import { StageEditorPanel } from './StageEditorPanel';
import { EditProjectPanel, TeamPanel, FinancePanel } from './ProjectPanels';
import CloseoutPanel from './CloseoutPanel';

type PanelName = 'edit' | 'team' | 'finance' | 'closeout' | 'stages' | null;

export default function ProjectPage() {
  const { projectId = '', stageId, activityId } = useParams();
  const [search, setSearch] = useSearchParams();
  const loc = useLocation();
  const { data, error, loading, reload } = useApi<ProjectDetail>(`/projects/${projectId}`, [projectId]);
  const [panel, setPanel] = useState<PanelName>(null);
  /** Bumped after any write so every part re-reads (roll-ups change % everywhere). */
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => { setVersion((v) => v + 1); reload(); }, [reload]);

  useEffect(() => { setPanel(null); }, [projectId]);

  if (error?.status === 403) return <ForbiddenPage reason="You are not staffed on this project, or your role cannot see it." />;
  if (error?.status === 404) return <NotFoundPage what="project" />;
  if (error) return <div className="card px-4 py-6 text-rose">Could not load the project: {error.message}</div>;
  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }
  if (!data) return null;

  const stages = [...data.stages].sort((a, b) => a.sort_order - b.sort_order);
  const fallbackStage = stages.find((s) => s.stage_id === data.project.current_stage_id) ?? stages[0];
  if (!stageId && fallbackStage) {
    return <Navigate replace to={`/projects/${projectId}/stages/${fallbackStage.stage_id}${loc.search}`} />;
  }
  const activeStage = stages.find((s) => s.stage_id === stageId);
  const taskId = search.get('task');

  return (
    <div>
      <ProjectHeader detail={data} onOpen={setPanel} />

      <StageTabs projectId={projectId} stages={stages} activeId={activeStage?.stage_id} currentId={data.project.current_stage_id ?? undefined}
        canEdit={data.perms.canEditStages} onEdit={() => setPanel('stages')} />

      {stageId && !activeStage ? (
        <div className="card rounded-t-none px-4 py-10"><NotFoundPage what="stage" /></div>
      ) : activeStage ? (
        <StageView key={activeStage.stage_id} projectId={projectId} stage={activeStage} detail={data} activityId={activityId}
          version={version} onChanged={bump} />
      ) : (
        <div className="card rounded-t-none px-6 py-12 text-center text-ink-soft">
          This project has no stages yet.{data.perms.canEditStages ? ' Use the pencil tab to add stages or get an AI suggestion.' : ''}
        </div>
      )}

      <TaskPanel taskId={taskId} projectId={projectId} version={version}
        onClose={() => { search.delete('task'); setSearch(search, { replace: true }); }} onChanged={bump} />

      <EditProjectPanel open={panel === 'edit'} detail={data} onClose={() => setPanel(null)} onSaved={bump} />
      <TeamPanel open={panel === 'team'} detail={data} onClose={() => setPanel(null)} onSaved={bump} />
      <FinancePanel open={panel === 'finance'} detail={data} onClose={() => setPanel(null)} />
      <CloseoutPanel open={panel === 'closeout'} detail={data} onClose={() => setPanel(null)} onClosed={bump} />
      <StageEditorPanel open={panel === 'stages'} detail={data} onClose={() => setPanel(null)} onSaved={bump} />
    </div>
  );
}
