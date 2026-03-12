import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

export function useKpiDetail(teamId, kpiSlug, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['kpi-detail', teamId, kpiSlug, periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(
        buildUrl(`/teams/${teamId}/kpis/${kpiSlug}`, { start_date: periodStart, end_date: periodEnd }),
        { signal },
      ),
    enabled: !!teamId && !!kpiSlug && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
