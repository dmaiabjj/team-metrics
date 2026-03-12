import { useQueries } from '@tanstack/react-query';
import { api, buildUrl } from '../client';
import { computePeriods, computeYearPeriods } from './usePerformanceAnalysis';

// ─── DEVELOPER METRICS DEFINITION ─────────────────────────────────────────────

export const DEV_METRICS = {
  total: { label: 'Total Items', unit: '', lower_better: false, icon: '📋' },
  throughput: { label: 'Throughput', unit: '', lower_better: false, icon: '✅' },
  avgCycleTime: { label: 'Cycle Time', unit: 'd', lower_better: true, icon: '⏱' },
  reworkRate: { label: 'Rework Rate', unit: '%', lower_better: true, icon: '↩' },
  bugsCount: { label: 'Bugs', unit: '', lower_better: true, icon: '🐛' },
};

export const DEV_METRIC_KEYS = Object.keys(DEV_METRICS);

// ─── DEVELOPER COLOR PALETTE ──────────────────────────────────────────────────

const DEV_PALETTE = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
  '#a855f7', '#84cc16',
];

export function devColor(index) {
  return DEV_PALETTE[index % DEV_PALETTE.length];
}

// ─── AGGREGATE WORK ITEMS BY DEVELOPER ────────────────────────────────────────
// Adapted from DeveloperSummary.jsx aggregateByDeveloper

export function aggregateByDeveloper(items) {
  const map = new Map();
  for (const wi of items) {
    const name = wi.developer || 'Unassigned';
    if (!map.has(name)) {
      map.set(name, { name, total: 0, throughput: 0, reworkCount: 0, bugsCount: 0, deliveryDaysSum: 0, deliveryDaysCount: 0 });
    }
    const d = map.get(name);
    d.total++;
    if (wi.canonical_status === 'Delivered') d.throughput++;
    if (wi.is_rework_item || wi.has_rework) d.reworkCount++;
    if (wi.work_item_type === 'Bug' || (wi.child_bugs && wi.child_bugs.length > 0)) d.bugsCount++;
    if (wi.delivery_days != null) { d.deliveryDaysSum += wi.delivery_days; d.deliveryDaysCount++; }
  }

  return Array.from(map.values())
    .map(d => ({
      ...d,
      avgCycleTime: d.deliveryDaysCount > 0 ? d.deliveryDaysSum / d.deliveryDaysCount : null,
      reworkRate: d.total > 0 ? d.reworkCount / d.total : 0,
    }))
    .filter(d => d.name !== 'Unassigned')
    .sort((a, b) => b.total - a.total);
}

// ─── FORMAT DEVELOPER METRIC ──────────────────────────────────────────────────

export function fmtDev(metricKey, value) {
  if (value == null) return '—';
  const m = DEV_METRICS[metricKey];
  if (!m) return String(value);
  if (m.unit === '%') return `${(value * 100).toFixed(0)}%`;
  if (m.unit === 'd') return `${value.toFixed(1)}d`;
  return String(Math.round(value * 10) / 10);
}

// ─── STATUS COLOR for delivery rate ───────────────────────────────────────────

export function devRateColor(rate) {
  if (rate == null) return '#64748b';
  if (rate >= 0.85) return '#10b981';
  if (rate >= 0.6) return '#f59e0b';
  return '#ef4444';
}

// ─── FETCH WORK ITEMS FOR A PERIOD ────────────────────────────────────────────

function workItemsQuery(teamId, start, end) {
  return {
    queryKey: ['work-items', teamId, start, end, { limit: 500 }],
    queryFn: ({ signal }) =>
      api(buildUrl(`/teams/${teamId}/work-items`, { start_date: start, end_date: end, limit: 500 }), { signal }),
    enabled: !!teamId && !!start && !!end,
    staleTime: 2 * 60 * 1000,
  };
}

// ─── COMPARISON: merge two periods of developer data ──────────────────────────

function mergeDeveloperPeriods(currentItems, previousItems) {
  const curDevs = aggregateByDeveloper(currentItems);
  const prevDevs = aggregateByDeveloper(previousItems);

  // Collect all developer names from both periods
  const allNames = new Set([...curDevs.map(d => d.name), ...prevDevs.map(d => d.name)]);

  const developers = Array.from(allNames).map(name => {
    const curr = curDevs.find(d => d.name === name) || null;
    const prev = prevDevs.find(d => d.name === name) || null;

    const metrics = {};
    for (const key of DEV_METRIC_KEYS) {
      const currVal = curr?.[key] ?? null;
      const prevVal = prev?.[key] ?? null;
      const delta = (currVal != null && prevVal != null) ? currVal - prevVal : null;
      const meta = DEV_METRICS[key];
      const improved = delta != null && delta !== 0
        ? (meta.lower_better ? delta < 0 : delta > 0)
        : null;
      metrics[key] = { currVal, prevVal, delta, improved };
    }

    return { name, metrics, currTotal: curr?.total ?? 0, prevTotal: prev?.total ?? 0 };
  }).sort((a, b) => b.currTotal - a.currTotal || b.prevTotal - a.prevTotal);

  // Summary based on throughput changes
  const totalImproved = developers.filter(d => d.metrics.throughput.improved === true).length;
  const totalDeclined = developers.filter(d => d.metrics.throughput.improved === false).length;
  const totalUnchanged = developers.length - totalImproved - totalDeclined;

  return { developers, totalImproved, totalDeclined, totalUnchanged };
}

// ─── useDeveloperComparison hook ──────────────────────────────────────────────

export function useDeveloperComparison(teamId, interval, customCurrent, customPrevious) {
  const { current, previous } = computePeriods(interval, customCurrent, customPrevious);

  const queries = useQueries({
    queries: [
      workItemsQuery(teamId, current.start, current.end),
      workItemsQuery(teamId, previous.start, previous.end),
    ],
  });

  const [currentQ, previousQ] = queries;
  const isLoading = currentQ.isLoading || previousQ.isLoading;
  const error = currentQ.error || previousQ.error;

  const mergedData = (!isLoading && currentQ.data && previousQ.data)
    ? mergeDeveloperPeriods(currentQ.data.items || [], previousQ.data.items || [])
    : null;

  return { mergedData, isLoading, error, periods: { current, previous } };
}

// ─── HISTORICAL: all periods within current year ──────────────────────────────

function mergeDeveloperHistorical(periodResults, periods) {
  // Aggregate each period
  const periodDevs = periodResults.map(r => aggregateByDeveloper(r?.items || []));

  // Collect all developer names across all periods
  const allNames = new Set();
  periodDevs.forEach(devs => devs.forEach(d => allNames.add(d.name)));
  const devNames = Array.from(allNames).sort();

  // Build time-series per developer per metric
  const devsData = devNames.map(name => {
    const metricSeries = {};
    DEV_METRIC_KEYS.forEach(metricKey => {
      metricSeries[metricKey] = periods.map((p, i) => {
        const dev = periodDevs[i]?.find(d => d.name === name);
        return { period: p.label, value: dev?.[metricKey] ?? null };
      });
    });
    return { name, metricSeries };
  });

  // Build Recharts-friendly data: one array per metric where each item = { period, devName1: val, devName2: val, ... }
  const chartData = {};
  DEV_METRIC_KEYS.forEach(metricKey => {
    chartData[metricKey] = periods.map((p, i) => {
      const point = { period: p.label };
      devNames.forEach(name => {
        const dev = periodDevs[i]?.find(d => d.name === name);
        point[name] = dev?.[metricKey] ?? null;
      });
      return point;
    });
  });

  return { devsData, chartData, devNames };
}

// ─── useDeveloperHistorical hook ──────────────────────────────────────────────

export function useDeveloperHistorical(teamId, granularity) {
  const periods = computeYearPeriods(granularity);

  const queries = useQueries({
    queries: periods.map(p => workItemsQuery(teamId, p.start, p.end)),
  });

  const isLoading = queries.some(q => q.isLoading);
  const error = queries.find(q => q.error)?.error || null;
  const allReady = queries.every(q => q.data);

  const timeSeriesData = (!isLoading && allReady)
    ? mergeDeveloperHistorical(queries.map(q => q.data), periods)
    : null;

  return { timeSeriesData, isLoading, error, periods };
}
