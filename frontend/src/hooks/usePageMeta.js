import { useLocation, useParams } from 'react-router';
import { TEAM_LABELS, KPI_META, SLUG_TO_KPI } from '../lib/constants';

const TITLES = {
  '/': 'Overview',
  '/performance': 'Performance Analysis',
  '/developers': 'Developer Analysis',
  '/cross-performance': 'Cross Performance',
  '/cross-developers': 'Cross Developers',
  '/cross-qa': 'Cross QA',
};

const NAV_IDS = {
  '/': 'overview',
  '/performance': 'performance',
  '/developers': 'developers',
  '/cross-performance': 'cross-performance',
  '/cross-developers': 'cross-developers',
  '/cross-qa': 'cross-qa',
};

export function usePageMeta() {
  const location = useLocation();
  const { teamId, kpiName, itemId } = useParams();

  let title = TITLES[location.pathname];
  if (!title) {
    if (itemId) title = `#${itemId}`;
    else if (location.pathname.includes('/work-items')) title = 'Work Items';
    else if (location.pathname.includes('/dora')) title = 'DORA Health';
    else if (kpiName) {
      const kpiKey = SLUG_TO_KPI[kpiName];
      title = KPI_META[kpiKey]?.label || kpiName;
    }
    else if (teamId) title = TEAM_LABELS[teamId] || teamId;
    else title = 'Dashboard';
  }

  let activeId = NAV_IDS[location.pathname];
  if (!activeId) {
    if (location.pathname.includes('/dora')) activeId = 'dora';
    else activeId = 'team';
  }

  return { title, activeId, teamId };
}
