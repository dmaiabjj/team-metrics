import { useQueries } from '@tanstack/react-query';
import { api, buildUrl } from '../client';
import { ALL_KPI_KEYS, KPI_META } from '../../lib/constants';
import { valFromKpis, ragFromKpis } from '../../lib/formatters';

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

// ─── PERIOD COMPARISON: compute current vs previous ───────────────────────────

export function computePeriods(interval, customCurrent, customPrevious) {
  const today = new Date();

  if (interval === 'custom') {
    return {
      current: customCurrent || { start: toISO(today), end: toISO(today) },
      previous: customPrevious || { start: toISO(today), end: toISO(today) },
    };
  }

  if (interval === 'weekly') {
    const day = today.getDay(); // 0=Sun
    const diffToMon = day === 0 ? 6 : day - 1;
    const curStart = new Date(today);
    curStart.setDate(today.getDate() - diffToMon);
    const prevEnd = new Date(curStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - 6);
    return {
      current: { start: toISO(curStart), end: toISO(today) },
      previous: { start: toISO(prevStart), end: toISO(prevEnd) },
    };
  }

  if (interval === 'monthly') {
    const curStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
    return {
      current: { start: toISO(curStart), end: toISO(today) },
      previous: { start: toISO(prevStart), end: toISO(prevEnd) },
    };
  }

  if (interval === 'quarterly') {
    const curQ = Math.floor(today.getMonth() / 3);
    const curStart = new Date(today.getFullYear(), curQ * 3, 1);
    const prevQEnd = new Date(curStart);
    prevQEnd.setDate(prevQEnd.getDate() - 1);
    const prevQ = Math.floor(prevQEnd.getMonth() / 3);
    const prevStart = new Date(prevQEnd.getFullYear(), prevQ * 3, 1);
    return {
      current: { start: toISO(curStart), end: toISO(today) },
      previous: { start: toISO(prevStart), end: toISO(prevQEnd) },
    };
  }

  return { current: { start: toISO(today), end: toISO(today) }, previous: { start: toISO(today), end: toISO(today) } };
}

// ─── MERGE two dashboard responses into comparison data ───────────────────────

function buildKpiComparison(currKpis, prevKpis) {
  return ALL_KPI_KEYS.map(kpiKey => {
    const currVal = valFromKpis(currKpis, kpiKey);
    const prevVal = valFromKpis(prevKpis, kpiKey);
    const currRag = ragFromKpis(currKpis, kpiKey);
    const prevRag = ragFromKpis(prevKpis, kpiKey);
    const delta = (currVal != null && prevVal != null) ? currVal - prevVal : null;
    const meta = KPI_META[kpiKey];
    const improved = delta != null && delta !== 0
      ? (meta?.lower_better ? delta < 0 : delta > 0)
      : null;
    return { kpiKey, currVal, prevVal, currRag, prevRag, delta, improved };
  });
}

function mergePeriods(currentData, previousData) {
  const curAvgKpis = [...(currentData.kpis || []), ...(currentData.dora || [])];
  const prevAvgKpis = [...(previousData.kpis || []), ...(previousData.dora || [])];

  const averages = buildKpiComparison(curAvgKpis, prevAvgKpis);

  const teams = (currentData.teams || []).map(curTeam => {
    const prevTeam = (previousData.teams || []).find(t => t.team_id === curTeam.team_id);
    const curKpis = [...(curTeam.kpis || []), ...(curTeam.dora || [])];
    const prevKpis = prevTeam ? [...(prevTeam.kpis || []), ...(prevTeam.dora || [])] : [];
    return { teamId: curTeam.team_id, kpis: buildKpiComparison(curKpis, prevKpis) };
  });

  const totalImproved = averages.filter(a => a.improved === true).length;
  const totalDeclined = averages.filter(a => a.improved === false).length;
  const totalUnchanged = averages.length - totalImproved - totalDeclined;

  return { averages, teams, totalImproved, totalDeclined, totalUnchanged };
}

// ─── usePerformanceComparison hook ────────────────────────────────────────────

export function usePerformanceComparison(interval, customCurrent, customPrevious) {
  const { current, previous } = computePeriods(interval, customCurrent, customPrevious);

  const queries = useQueries({
    queries: [
      {
        queryKey: ['dashboard', current.start, current.end],
        queryFn: ({ signal }) =>
          api(buildUrl('/dashboard', { start_date: current.start, end_date: current.end }), { signal }),
        enabled: !!current.start && !!current.end,
        staleTime: 2 * 60 * 1000,
      },
      {
        queryKey: ['dashboard', previous.start, previous.end],
        queryFn: ({ signal }) =>
          api(buildUrl('/dashboard', { start_date: previous.start, end_date: previous.end }), { signal }),
        enabled: !!previous.start && !!previous.end,
        staleTime: 2 * 60 * 1000,
      },
    ],
  });

  const [currentQ, previousQ] = queries;
  const isLoading = currentQ.isLoading || previousQ.isLoading;
  const error = currentQ.error || previousQ.error;

  const mergedData = (!isLoading && currentQ.data && previousQ.data)
    ? mergePeriods(currentQ.data, previousQ.data)
    : null;

  return { mergedData, isLoading, error, periods: { current, previous } };
}

// ─── HISTORICAL TREND: all periods within current year ────────────────────────

export function computeYearPeriods(granularity) {
  const today = new Date();
  const year = today.getFullYear();
  const periods = [];

  if (granularity === 'monthly') {
    const currentMonth = today.getMonth(); // 0-based
    for (let m = 0; m <= currentMonth; m++) {
      const start = new Date(year, m, 1);
      const end = m === currentMonth ? today : lastDayOfMonth(year, m);
      const label = start.toLocaleDateString('en-US', { month: 'short' });
      periods.push({ start: toISO(start), end: toISO(end), label });
    }
  } else {
    // quarterly
    const currentQ = Math.floor(today.getMonth() / 3);
    for (let q = 0; q <= currentQ; q++) {
      const start = new Date(year, q * 3, 1);
      const end = q === currentQ ? today : lastDayOfMonth(year, q * 3 + 2);
      periods.push({ start: toISO(start), end: toISO(end), label: `Q${q + 1}` });
    }
  }

  return periods;
}

function mergeHistorical(periodResults, periods) {
  // Build time-series: for each team, for each KPI, array of { period, label, value, rag }
  const teamIds = periodResults[0]?.teams?.map(t => t.team_id) || [];

  const teamsData = teamIds.map(teamId => {
    const kpiSeries = {};
    ALL_KPI_KEYS.forEach(kpiKey => {
      kpiSeries[kpiKey] = periods.map((p, i) => {
        const data = periodResults[i];
        const team = data?.teams?.find(t => t.team_id === teamId);
        const kpis = team ? [...(team.kpis || []), ...(team.dora || [])] : [];
        const value = valFromKpis(kpis, kpiKey);
        const rag = ragFromKpis(kpis, kpiKey);
        return { period: p.label, start: p.start, end: p.end, value, rag };
      });
    });
    return { teamId, kpiSeries };
  });

  // Also build averages time-series
  const avgSeries = {};
  ALL_KPI_KEYS.forEach(kpiKey => {
    avgSeries[kpiKey] = periods.map((p, i) => {
      const data = periodResults[i];
      const kpis = [...(data?.kpis || []), ...(data?.dora || [])];
      return { period: p.label, value: valFromKpis(kpis, kpiKey), rag: ragFromKpis(kpis, kpiKey) };
    });
  });

  // Build Recharts-friendly data: one array per KPI where each item = { period, team1: val, team2: val, ... }
  const chartData = {};
  ALL_KPI_KEYS.forEach(kpiKey => {
    chartData[kpiKey] = periods.map((p, i) => {
      const point = { period: p.label };
      teamIds.forEach(teamId => {
        const team = periodResults[i]?.teams?.find(t => t.team_id === teamId);
        const kpis = team ? [...(team.kpis || []), ...(team.dora || [])] : [];
        point[teamId] = valFromKpis(kpis, kpiKey);
      });
      return point;
    });
  });

  return { teamsData, avgSeries, chartData, teamIds };
}

// ─── useHistoricalTrend hook ──────────────────────────────────────────────────

export function useHistoricalTrend(granularity) {
  const periods = computeYearPeriods(granularity);

  const queries = useQueries({
    queries: periods.map(p => ({
      queryKey: ['dashboard', p.start, p.end],
      queryFn: ({ signal }) =>
        api(buildUrl('/dashboard', { start_date: p.start, end_date: p.end }), { signal }),
      staleTime: 2 * 60 * 1000,
    })),
  });

  const isLoading = queries.some(q => q.isLoading);
  const error = queries.find(q => q.error)?.error || null;
  const allReady = queries.every(q => q.data);

  const timeSeriesData = (!isLoading && allReady)
    ? mergeHistorical(queries.map(q => q.data), periods)
    : null;

  return { timeSeriesData, isLoading, error, periods };
}
