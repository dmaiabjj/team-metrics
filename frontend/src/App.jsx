import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import Loader from './components/shared/Loader';
import ErrorBoundary from './components/shared/ErrorBoundary';

// Code-split pages: each page bundle loads only when navigated to
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const KpiDetailPage = lazy(() => import('./pages/KpiDetailPage'));
const DoraHealthPage = lazy(() => import('./pages/DoraHealthPage'));
const PerformanceAnalysisPage = lazy(() => import('./pages/PerformanceAnalysisPage'));
const WorkItemsPage = lazy(() => import('./pages/WorkItemsPage'));
const WorkItemDetailPage = lazy(() => import('./pages/WorkItemDetailPage'));

export default function App() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        <ErrorBoundary>
          <Suspense fallback={<div style={{ padding: 32 }}><Loader /></div>}>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/performance" element={<PerformanceAnalysisPage />} />
              <Route path="/teams/:teamId" element={<TeamPage />} />
              <Route path="/teams/:teamId/kpis/:kpiName" element={<KpiDetailPage />} />
              <Route path="/teams/:teamId/dora" element={<DoraHealthPage />} />
              <Route path="/teams/:teamId/work-items" element={<WorkItemsPage />} />
              <Route path="/teams/:teamId/work-items/:itemId" element={<WorkItemDetailPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
