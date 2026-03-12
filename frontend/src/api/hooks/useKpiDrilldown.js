import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

export function useKpiDrilldown(teamId, kpiSlug, metric, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['kpi-drilldown', teamId, kpiSlug, metric, periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(
        buildUrl(`/teams/${teamId}/kpis/${kpiSlug}/drilldown/${metric}`, {
          start_date: periodStart,
          end_date: periodEnd,
        }),
        { signal },
      ),
    enabled: !!teamId && !!kpiSlug && !!metric && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
