import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Routes, Route, useLocation } from 'react-router';
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
const DeveloperAnalysisPage = lazy(() => import('./pages/DeveloperAnalysisPage'));
const WorkItemsPage = lazy(() => import('./pages/WorkItemsPage'));
const WorkItemDetailPage = lazy(() => import('./pages/WorkItemDetailPage'));
const CrossPerformancePage = lazy(() => import('./pages/CrossPerformancePage'));
const CrossDevelopersPage = lazy(() => import('./pages/CrossDevelopersPage'));
const CrossQAPage = lazy(() => import('./pages/CrossQAPage'));
const PersonDetailPage = lazy(() => import('./pages/PersonDetailPage'));

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

export default function App() {
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Close drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const toggleMenu = useCallback(() => setMobileMenuOpen(o => !o), []);
  const closeMenu = useCallback(() => setMobileMenuOpen(false), []);

  return (
    <>
      <a className="skip-to-content" href="#main-content">Skip to content</a>
      <div className="shell">
        {isMobile && (
          <div
            className={`sidebar-overlay${mobileMenuOpen ? ' visible' : ''}`}
            onClick={closeMenu}
          />
        )}
        <Sidebar
          isMobile={isMobile}
          mobileOpen={mobileMenuOpen}
          onClose={closeMenu}
        />
        <div className="main" id="main-content">
          <Topbar onMenuToggle={toggleMenu} isMobile={isMobile} />
          <ErrorBoundary>
            <Suspense fallback={<div style={{ padding: 32 }}><Loader /></div>}>
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/performance" element={<PerformanceAnalysisPage />} />
              <Route path="/developers" element={<DeveloperAnalysisPage />} />
              <Route path="/cross-performance" element={<CrossPerformancePage />} />
              <Route path="/cross-developers" element={<CrossDevelopersPage />} />
              <Route path="/cross-developers/:personKey" element={<PersonDetailPage personField="developer" />} />
              <Route path="/cross-qa" element={<CrossQAPage />} />
              <Route path="/cross-qa/:personKey" element={<PersonDetailPage personField="qa" />} />
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
    </>
  );
}
