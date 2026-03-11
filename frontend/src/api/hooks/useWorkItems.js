import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useWorkItems(teamId, periodStart, periodEnd, filters = {}) {
  const params = new URLSearchParams({
    start_date: periodStart,
    end_date: periodEnd,
  });
  if (filters.skip) params.set('skip', String(filters.skip));
  if (filters.limit) params.set('limit', String(filters.limit));

  return useQuery({
    queryKey: ['work-items', teamId, periodStart, periodEnd, filters],
    queryFn: () => api(`/teams/${teamId}/work-items?${params.toString()}`),
    enabled: !!teamId && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
