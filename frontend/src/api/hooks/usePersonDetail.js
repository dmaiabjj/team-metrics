import { useQueries } from '@tanstack/react-query';
import { api, buildUrl } from '../client';
import { aggregateByPerson, PERSON_METRICS, fmtPerson } from './useCrossTeamAnalysis';
import { computePeriods, computeYearPeriods } from './usePerformanceAnalysis';

// ─── WORK ITEMS QUERY ───────────────────────────────────────────────────────

function workItemsQuery(teamId, start, end) {
  return {
    queryKey: ['work-items', teamId, start, end, { limit: 500 }],
    queryFn: ({ signal }) =>
      api(buildUrl(`/teams/${teamId}/work-items`, { start_date: start, end_date: end, limit: 500 }), { signal }),
    enabled: !!teamId && !!start && !!end,
    staleTime: 2 * 60 * 1000,
  };
}

// ─── usePersonDetail HOOK ───────────────────────────────────────────────────

export function usePersonDetail(personName, teamId, field, metricKeys, interval = 'monthly') {
  const { current, previous } = computePeriods(interval, null, null);
  const historicalPeriods = computeYearPeriods('monthly');

  // 2 comparison queries + N historical queries
  const queries = useQueries({
    queries: [
      workItemsQuery(teamId, current.start, current.end),
      workItemsQuery(teamId, previous.start, previous.end),
      ...historicalPeriods.map(p => workItemsQuery(teamId, p.start, p.end)),
    ],
  });

  const isLoading = queries.some(q => q.isLoading);
  const error = queries.find(q => q.error)?.error || null;
  const allReady = queries.every(q => q.data);

  let personData = null;
  if (!isLoading && allReady) {
    const currentItems = queries[0].data?.items || [];
    const previousItems = queries[1].data?.items || [];

    // Aggregate by person for current and previous
    const currentPersons = aggregateByPerson(currentItems, field, teamId);
    const previousPersons = aggregateByPerson(previousItems, field, teamId);

    const currPerson = currentPersons.find(p => p.name === personName);
    const prevPerson = previousPersons.find(p => p.name === personName);

    // Build metrics comparison
    const metrics = {};
    for (const mk of metricKeys) {
      const currVal = currPerson?.[mk] ?? null;
      const prevVal = prevPerson?.[mk] ?? null;
      const delta = (currVal != null && prevVal != null) ? currVal - prevVal : null;
      const meta = PERSON_METRICS[mk];
      const improved = delta != null && delta !== 0
        ? (meta?.lower_better ? delta < 0 : delta > 0) : null;
      metrics[mk] = { currVal, prevVal, delta, improved };
    }

    // Build historical data with work items per period
    const historicalData = historicalPeriods.map((p, i) => {
      const items = queries[2 + i].data?.items || [];
      const persons = aggregateByPerson(items, field, teamId);
      const person = persons.find(pp => pp.name === personName);
      const periodMetrics = {};
      for (const mk of metricKeys) {
        periodMetrics[mk] = person?.[mk] ?? null;
      }
      const workItems = items.filter(wi => wi[field] === personName);
      return { period: p.label, start: p.start, end: p.end, workItems, ...periodMetrics };
    });

    personData = {
      name: personName,
      teamId,
      currTotal: currPerson?.total ?? 0,
      prevTotal: prevPerson?.total ?? 0,
      metrics,
      historicalData,
    };
  }

  return { personData, isLoading, error, periods: { current, previous } };
}
