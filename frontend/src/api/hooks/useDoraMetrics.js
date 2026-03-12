import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

export function useDoraMetrics(teamId, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['dora', teamId, periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(
        buildUrl(`/teams/${teamId}/dora`, { start_date: periodStart, end_date: periodEnd }),
        { signal },
      ),
    enabled: !!teamId && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDoraDetail(teamId, metric, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['dora-detail', teamId, metric, periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(
        buildUrl(`/teams/${teamId}/dora/${metric}`, { start_date: periodStart, end_date: periodEnd }),
        { signal },
      ),
    enabled: !!teamId && !!metric && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
