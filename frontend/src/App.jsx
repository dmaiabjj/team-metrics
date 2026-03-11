import { Routes, Route } from 'react-router';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import OverviewPage from './pages/OverviewPage';
import TeamPage from './pages/TeamPage';
import KpiDetailPage from './pages/KpiDetailPage';
import DoraHealthPage from './pages/DoraHealthPage';
import WorkItemsPage from './pages/WorkItemsPage';
import WorkItemDetailPage from './pages/WorkItemDetailPage';

export default function App() {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/teams/:teamId" element={<TeamPage />} />
          <Route path="/teams/:teamId/kpis/:kpiName" element={<KpiDetailPage />} />
          <Route path="/teams/:teamId/dora" element={<DoraHealthPage />} />
          <Route path="/teams/:teamId/work-items" element={<WorkItemsPage />} />
          <Route path="/teams/:teamId/work-items/:itemId" element={<WorkItemDetailPage />} />
        </Routes>
      </div>
    </div>
  );
}
