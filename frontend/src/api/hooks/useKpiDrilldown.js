import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useKpiDrilldown(teamId, kpiSlug, metric, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['kpi-drilldown', teamId, kpiSlug, metric, periodStart, periodEnd],
    queryFn: () =>
      api(
        `/teams/${teamId}/kpis/${kpiSlug}/drilldown/${metric}?start_date=${periodStart}&end_date=${periodEnd}`
      ),
    enabled: !!teamId && !!kpiSlug && !!metric && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
