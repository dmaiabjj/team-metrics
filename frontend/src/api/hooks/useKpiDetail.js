import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useKpiDetail(teamId, kpiSlug, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['kpi-detail', teamId, kpiSlug, periodStart, periodEnd],
    queryFn: () =>
      api(
        `/teams/${teamId}/kpis/${kpiSlug}?start_date=${periodStart}&end_date=${periodEnd}`
      ),
    enabled: !!teamId && !!kpiSlug && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
