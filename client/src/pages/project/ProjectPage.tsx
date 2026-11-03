/**
 * Project page: breadcrumbs, compact header, sticky stage tabs, then the stage (overview or activity) with the
 * right-hand context panel. Routes: /projects/:projectId[/stages/:stageId[/activities/:activityId]]; ?task=TSK-… opens the task panel.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import type { ProjectDetail } from '@shared/types';
import { useApi } from '../../hooks/useApi';
import { useSession } from '../../lib/session';
import { openTab } from '../../lib/openTabs';
import { Breadcrumbs, Skeleton } from '../../components/ui';
import { ForbiddenPage, NotFoundPage } from '../StatusPages';
import ProjectHeader from './ProjectHeader';
import StageTabs from './StageTabs';
import StageView from './StageView';
import TaskPanel from './TaskPanel';
import { StageEditorPanel } from './StageEditorPanel';
import { EditProjectPanel, TeamPanel } from './ProjectPanels';
import RequestAccessPanel from '../../features/access/RequestAccessPanel';
import CloseoutPanel from './CloseoutPanel';

type PanelName = 'edit' | 'team' | 'access' | 'closeout' | 'stages' | null;

export default function ProjectPage() {
  const { projectId = '', stageId, activityId } = useParams();
  const [search, setSearch] = useSearchParams();
  const loc = useLocation();
  const { session } = useSession();
  const { data, error, loading, reload } = useApi<ProjectDetail>(`/projects/${projectId}`, [projectId]);
  const [panel, setPanel] = useState<PanelName>(null);
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const [activityName, setActivityName] = useState<string | undefined>();
  /** Bumped after any write so every part re-reads (roll-ups change % everywhere). */
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => { setVersion((v) => v + 1); reload(); }, [reload]);

  useEffect(() => { setPanel(null); }, [projectId]);
  useEffect(() => { if (!activityId) setActivityName(undefined); }, [activityId]);

  // Register / refresh this project in the open-projects tab strip (remembers where you were).
  // Only when the loaded data and the URL are the same project: while switching projects, `data` still holds the
  // previous project for a moment and must not be saved with the new project's path (that sent tabs to the wrong project).
  useEffect(() => {
    if (!data || !session) return;
    const id = data.project.project_id;
    if (id !== projectId || !loc.pathname.startsWith(`/projects/${id}`)) return;
    openTab(session.user.user_id, { id, name: data.project.code_name, rag: data.project.rag, lastPath: loc.pathname });
  }, [data, session, loc.pathname, projectId]);

  if (error?.status === 403) return <ForbiddenPage reason="You are not staffed on this project, or your role cannot see it." />;
  if (error?.status === 404) return <NotFoundPage what="project" />;
  if (error) return <div className="card px-4 py-6 text-rose">Could not load the project: {error.message}</div>;
  if (loading && !data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-5 w-72" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-14 w-full" />
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
  const stageUrl = activeStage ? `/projects/${projectId}/stages/${activeStage.stage_id}` : undefined;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Dashboard', to: '/' },
        { label: data.project.code_name, to: `/projects/${projectId}` },
        ...(activeStage ? [{ label: activeStage.name, to: stageUrl }] : []),
        ...(activityId && activityName ? [{ label: activityName }] : []),
      ]} />

      <ProjectHeader detail={data} onOpen={setPanel} />

      <StageTabs projectId={projectId} stages={stages} activeId={activeStage?.stage_id} currentId={data.project.current_stage_id ?? undefined}
        canEdit={data.perms.canEditStages && data.project.status !== 'Closed'} onEdit={() => setPanel('stages')} />

      {stageId && !activeStage ? (
        <div className="card rounded-tl-none px-4 py-10"><NotFoundPage what="stage" /></div>
      ) : activeStage ? (
        <StageView key={activeStage.stage_id} projectId={projectId} stage={activeStage} detail={data} activityId={activityId}
          version={version} onChanged={bump} onActivityName={setActivityName} />
      ) : (
        <div className="card rounded-tl-none px-6 py-12 text-center text-ink-soft">
          This project has no stages yet.{data.perms.canEditStages ? ' Use Edit stages to add stages or get an AI suggestion.' : ''}
        </div>
      )}

      <TaskPanel taskId={taskId} projectId={projectId} version={version}
        onClose={() => { search.delete('task'); setSearch(search, { replace: true }); }} onChanged={bump} />

      <EditProjectPanel open={panel === 'edit'} detail={data} onClose={() => setPanel(null)} onSaved={bump} />
      <TeamPanel open={panel === 'team'} detail={data} onClose={() => setPanel(null)} onSaved={bump} onGiveAccess={(uid) => { setAccessFor(uid); setPanel('access'); }} />
      <RequestAccessPanel open={panel === 'access'} detail={data} defaultGrantee={accessFor} onClose={() => { setPanel(null); setAccessFor(null); }} onChanged={bump} />
      <CloseoutPanel open={panel === 'closeout'} detail={data} onClose={() => setPanel(null)} onClosed={bump} />
      <StageEditorPanel open={panel === 'stages'} detail={data} onClose={() => setPanel(null)} onSaved={bump} />
    </div>
  );
}
