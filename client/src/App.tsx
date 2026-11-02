import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { useSession } from './lib/session';
import type { Action } from '@shared/permissions';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
// Pages are loaded on demand so the first screen (login) stays small and fast.
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const ProjectPage = lazy(() => import('./pages/project/ProjectPage'));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AccessPage = lazy(() => import('./pages/AccessPage'));
const FinancePage = lazy(() => import('./pages/finance/FinancePage'));

function PageFallback() {
  return <div className="flex h-64 items-center justify-center text-ink-muted"><Spinner className="mr-2" /> Loading</div>;
}
const page = (node: ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>;
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
        <Route index element={page(<DashboardPage />)} />
        <Route path="projects/:projectId" element={page(<ProjectPage />)} />
        <Route path="projects/:projectId/finance" element={page(<FinancePage />)} />
        <Route path="projects/:projectId/stages/:stageId" element={page(<ProjectPage />)} />
        <Route path="projects/:projectId/stages/:stageId/activities/:activityId" element={page(<ProjectPage />)} />
        <Route path="knowledge" element={<RequireAction action="knowledge.view">{page(<KnowledgePage />)}</RequireAction>} />
        <Route path="access" element={page(<AccessPage />)} />
        <Route path="audit" element={<RequireAction action="audit.view">{page(<AuditPage />)}</RequireAction>} />
        <Route path="admin/data" element={<RequireAction action="admin.data">{page(<AdminPage />)}</RequireAction>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
