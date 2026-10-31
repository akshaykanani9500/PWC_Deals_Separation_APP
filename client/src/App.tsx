import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from './lib/session';
import type { Action } from '@shared/permissions';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ProjectPage from './pages/project/ProjectPage';
import KnowledgePage from './pages/KnowledgePage';
import AuditPage from './pages/AuditPage';
import AdminPage from './pages/AdminPage';
import { ForbiddenPage, NotFoundPage } from './pages/StatusPages';
import { Spinner } from './components/ui';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const loc = useLocation();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-ink-muted"><Spinner className="mr-2" /> Loading your workspace</div>;
  }
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function RequireAction({ action, children }: { action: Action; children: ReactNode }) {
  const { can, session } = useSession();
  if (!can(action)) return <ForbiddenPage reason={`Your role (${session?.persona.name}) cannot open this page.`} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="projects/:projectId" element={<ProjectPage />} />
        <Route path="projects/:projectId/stages/:stageId" element={<ProjectPage />} />
        <Route path="projects/:projectId/stages/:stageId/activities/:activityId" element={<ProjectPage />} />
        <Route path="knowledge" element={<RequireAction action="knowledge.view"><KnowledgePage /></RequireAction>} />
        <Route path="audit" element={<RequireAction action="audit.view"><AuditPage /></RequireAction>} />
        <Route path="admin/data" element={<RequireAction action="admin.data"><AdminPage /></RequireAction>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
