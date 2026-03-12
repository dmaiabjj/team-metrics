import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

export function useSnapshotDrilldown(teamId, metric, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['snapshot-drilldown', teamId, metric, periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(
        buildUrl(`/teams/${teamId}/delivery-snapshot/${metric}`, {
          start_date: periodStart,
          end_date: periodEnd,
        }),
        { signal },
      ),
    enabled: !!teamId && !!metric && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
