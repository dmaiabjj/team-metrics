import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '../client';

export function useDashboard(periodStart, periodEnd) {
  return useQuery({
    queryKey: ['dashboard', periodStart, periodEnd],
    queryFn: ({ signal }) =>
      api(buildUrl('/dashboard', { start_date: periodStart, end_date: periodEnd }), { signal }),
    enabled: !!periodStart && !!periodEnd,
    staleTime: 2 * 60 * 1000,
  });
}
