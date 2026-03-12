import { useQueries } from '@tanstack/react-query';
import { api, buildUrl } from '../client';
import { computePeriods, computeYearPeriods } from './usePerformanceAnalysis';
import { TEAMS } from '../../lib/constants';

// ─── PERSON METRICS DEFINITION ──────────────────────────────────────────────

export const PERSON_METRICS = {
  throughput:    { label: 'Throughput',   unit: '',  lower_better: false, icon: '✅' },
  avgCycleTime:  { label: 'Cycle Time',  unit: 'd', lower_better: true,  icon: '⏱' },
  reworkRate:    { label: 'Rework Rate',  unit: '%', lower_better: true,  icon: '↩' },
  bugsCount:     { label: 'Bugs',         unit: '',  lower_better: true,  icon: '🐛' },
  deliveryRate:  { label: 'Delivery Rate', unit: '%', lower_better: false, icon: '🎯' },
};

export const ALL_PERSON_METRIC_KEYS = Object.keys(PERSON_METRICS);

// ─── COLOR PALETTE FOR PERSONS ──────────────────────────────────────────────

const PALETTE = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
  '#a855f7', '#84cc16',
];

export function personColor(index) {
  return PALETTE[index % PALETTE.length];
}

// ─── FORMAT PERSON METRIC ───────────────────────────────────────────────────

export function fmtPerson(metricKey, value) {
  if (value == null) return '—';
  const m = PERSON_METRICS[metricKey];
  if (!m) return String(value);
  if (m.unit === '%') return `${(value * 100).toFixed(0)}%`;
  if (m.unit === 'd') return `${value.toFixed(1)}d`;
  return String(Math.round(value * 10) / 10);
}

// ─── RATE COLOR ─────────────────────────────────────────────────────────────

export function personRateColor(rate) {
  if (rate == null) return '#64748b';
  if (rate >= 0.85) return '#10b981';
  if (rate >= 0.6)  return '#f59e0b';
  return '#ef4444';
}

// ─── AGGREGATE WORK ITEMS BY PERSON ─────────────────────────────────────────
// Generic version: field = 'developer' | 'qa'

export function aggregateByPerson(items, field, teamId) {
  const map = new Map();
  for (const wi of items) {
    const name = wi[field] || 'Unassigned';
    if (!map.has(name)) {
      map.set(name, {
        name,
        teamId,
        total: 0,
        throughput: 0,
        reworkCount: 0,
        bugsCount: 0,
        deliveryDaysSum: 0,
        deliveryDaysCount: 0,
      });
    }
    const d = map.get(name);
    d.total++;
    if (wi.canonical_status === 'Delivered') d.throughput++;
    if (wi.is_rework_item || wi.has_rework) d.reworkCount++;
    if (wi.work_item_type === 'Bug' || (wi.child_bugs && wi.child_bugs.length > 0)) d.bugsCount++;
    if (wi.delivery_days != null) {
      d.deliveryDaysSum += wi.delivery_days;
      d.deliveryDaysCount++;
    }
  }

  return Array.from(map.values())
    .map(d => ({
      ...d,
      avgCycleTime: d.deliveryDaysCount > 0 ? d.deliveryDaysSum / d.deliveryDaysCount : null,
      reworkRate: d.total > 0 ? d.reworkCount / d.total : 0,
      deliveryRate: d.total > 0 ? d.throughput / d.total : 0,
    }))
    .filter(d => d.name !== 'Unassigned')
    .sort((a, b) => b.throughput - a.throughput || b.total - a.total);
}

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

// ─── MERGE CROSS-TEAM PERSON PERIODS ────────────────────────────────────────

function mergeCrossPersonPeriods(currentTeamResults, previousTeamResults, field, metricKeys) {
  // Aggregate each team's items by person
  const allCurrentPersons = [];
  const allPreviousPersons = [];

  for (const { teamId, items } of currentTeamResults) {
    allCurrentPersons.push(...aggregateByPerson(items, field, teamId));
  }
  for (const { teamId, items } of previousTeamResults) {
    allPreviousPersons.push(...aggregateByPerson(items, field, teamId));
  }

  // Unique key = name + teamId
  const key = (p) => `${p.name}::${p.teamId}`;
  const allKeys = new Set([...allCurrentPersons.map(key), ...allPreviousPersons.map(key)]);

  const persons = Array.from(allKeys).map(k => {
    const curr = allCurrentPersons.find(p => key(p) === k) || null;
    const prev = allPreviousPersons.find(p => key(p) === k) || null;
    const name = curr?.name || prev?.name;
    const teamId = curr?.teamId || prev?.teamId;

    const metrics = {};
    for (const mk of metricKeys) {
      const currVal = curr?.[mk] ?? null;
      const prevVal = prev?.[mk] ?? null;
      const delta = (currVal != null && prevVal != null) ? currVal - prevVal : null;
      const meta = PERSON_METRICS[mk];
      const improved = delta != null && delta !== 0
        ? (meta.lower_better ? delta < 0 : delta > 0)
        : null;
      metrics[mk] = { currVal, prevVal, delta, improved };
    }

    return {
      name,
      teamId,
      metrics,
      currTotal: curr?.total ?? 0,
      prevTotal: prev?.total ?? 0,
      currThroughput: curr?.throughput ?? 0,
    };
  }).sort((a, b) => b.currThroughput - a.currThroughput || b.currTotal - a.currTotal);

  const primaryKey = metricKeys[0]; // throughput
  const totalImproved = persons.filter(d => d.metrics[primaryKey]?.improved === true).length;
  const totalDeclined = persons.filter(d => d.metrics[primaryKey]?.improved === false).length;
  const totalUnchanged = persons.length - totalImproved - totalDeclined;

  return { persons, totalImproved, totalDeclined, totalUnchanged };
}

// ─── useCrossTeamComparison HOOK ────────────────────────────────────────────

export function useCrossTeamComparison(field, metricKeys, interval, customCurrent, customPrevious) {
  const { current, previous } = computePeriods(interval, customCurrent, customPrevious);

  // 2 periods x N teams = 2N parallel queries
  const queries = useQueries({
    queries: [
      ...TEAMS.map(t => workItemsQuery(t, current.start, current.end)),
      ...TEAMS.map(t => workItemsQuery(t, previous.start, previous.end)),
    ],
  });

  const n = TEAMS.length;
  const currentQueries = queries.slice(0, n);
  const previousQueries = queries.slice(n, n * 2);

  const isLoading = queries.some(q => q.isLoading);
  const error = queries.find(q => q.error)?.error || null;
  const allReady = queries.every(q => q.data);

  let mergedData = null;
  if (!isLoading && allReady) {
    const currentTeamResults = TEAMS.map((teamId, i) => ({
      teamId,
      items: currentQueries[i].data?.items || [],
    }));
    const previousTeamResults = TEAMS.map((teamId, i) => ({
      teamId,
      items: previousQueries[i].data?.items || [],
    }));
    mergedData = mergeCrossPersonPeriods(currentTeamResults, previousTeamResults, field, metricKeys);
  }

  return { mergedData, isLoading, error, periods: { current, previous } };
}

// ─── MERGE CROSS-TEAM PERSON HISTORICAL ─────────────────────────────────────

function mergeCrossPersonHistorical(periodTeamResults, periods, field, metricKeys) {
  // periodTeamResults: array of { teamResults: [{ teamId, items }] } per period
  const periodPersons = periodTeamResults.map(({ teamResults }) => {
    const all = [];
    for (const { teamId, items } of teamResults) {
      all.push(...aggregateByPerson(items, field, teamId));
    }
    return all;
  });

  // Collect all unique person keys
  const allKeys = new Set();
  periodPersons.forEach(persons => persons.forEach(p => allKeys.add(`${p.name}::${p.teamId}`)));
  const personKeys = Array.from(allKeys).sort();

  // Build time-series per person per metric
  const personsData = personKeys.map(pk => {
    const [name, teamId] = pk.split('::');
    const metricSeries = {};
    metricKeys.forEach(mk => {
      metricSeries[mk] = periods.map((p, i) => {
        const person = periodPersons[i]?.find(pp => `${pp.name}::${pp.teamId}` === pk);
        return { period: p.label, value: person?.[mk] ?? null };
      });
    });
    return { name, teamId, key: pk, metricSeries };
  });

  // Build Recharts-friendly data
  const chartData = {};
  metricKeys.forEach(mk => {
    chartData[mk] = periods.map((p, i) => {
      const point = { period: p.label };
      personKeys.forEach(pk => {
        const person = periodPersons[i]?.find(pp => `${pp.name}::${pp.teamId}` === pk);
        point[pk] = person?.[mk] ?? null;
      });
      return point;
    });
  });

  return { personsData, chartData, personKeys };
}

// ─── useCrossTeamHistorical HOOK ────────────────────────────────────────────

export function useCrossTeamHistorical(field, metricKeys, granularity) {
  const periods = computeYearPeriods(granularity);

  // N periods x M teams queries
  const queries = useQueries({
    queries: periods.flatMap(p =>
      TEAMS.map(t => workItemsQuery(t, p.start, p.end))
    ),
  });

  const n = TEAMS.length;
  const isLoading = queries.some(q => q.isLoading);
  const error = queries.find(q => q.error)?.error || null;
  const allReady = queries.every(q => q.data);

  let timeSeriesData = null;
  if (!isLoading && allReady) {
    const periodTeamResults = periods.map((_, pi) => ({
      teamResults: TEAMS.map((teamId, ti) => ({
        teamId,
        items: queries[pi * n + ti].data?.items || [],
      })),
    }));
    timeSeriesData = mergeCrossPersonHistorical(periodTeamResults, periods, field, metricKeys);
  }

  return { timeSeriesData, isLoading, error, periods };
}
