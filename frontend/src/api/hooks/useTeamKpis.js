import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

export function useTeamKpis(teamId, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['team-kpis', teamId, periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(buildUrl(`/teams/${teamId}/kpis`, { start_date: periodStart, end_date: periodEnd }), { signal }),
    enabled: !!teamId && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
