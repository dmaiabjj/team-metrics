import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

export function useDashboard(periodStart, periodEnd) {
  return useQuery({
    queryKey: ['dashboard', periodStart, periodEnd],
    queryFn: () =>
      api(`/dashboard?start_date=${periodStart}&end_date=${periodEnd}`),
    enabled: !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
