import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useTeamKpis(teamId, periodStart, periodEnd) {
  return useQuery({
    queryKey: ['team-kpis', teamId, periodStart, periodEnd],
    queryFn: () =>
      api(`/teams/${teamId}/kpis?start_date=${periodStart}&end_date=${periodEnd}`),
    enabled: !!teamId && !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
