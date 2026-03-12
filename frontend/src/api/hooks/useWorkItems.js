import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

export function useWorkItems(teamId, periodStart, periodEnd, filters = {}) {
  return useQuery({
    queryKey: ['work-items', teamId, periodStart, periodEnd, filters],
    queryFn: ({ signal }) =>
      api(
        buildUrl(`/teams/${teamId}/work-items`, {
          start_date: periodStart,
          end_date: periodEnd,
          skip: filters.skip || undefined,
          limit: filters.limit || undefined,
        }),
        { signal },
      ),
    enabled: !!teamId && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
