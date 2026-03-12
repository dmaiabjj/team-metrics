import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

/**
 * Fetch a single work item by ID directly from the API.
 * This works for any work item type — deliverables, epics, features, bugs.
 */
export function useWorkItem(teamId, itemId, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['work-item', teamId, itemId, periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(
        buildUrl(`/teams/${teamId}/work-items/${itemId}`, {
          start_date: periodStart,
          end_date: periodEnd,
        }),
        { signal },
      ),
    enabled: !!teamId && !!itemId && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
