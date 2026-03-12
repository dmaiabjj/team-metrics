import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, BarChart3, Clock, Scale } from 'lucide-react';
import { usePerformanceComparison, useHistoricalTrend } from '../api/hooks/usePerformanceAnalysis';
import { TEAMS, TEAM_LABELS, TEAM_COLORS, KPI_META, ALL_KPI_KEYS, KPI_KEYS, DORA_KEYS, KPI_SLUG } from '../lib/constants';
import { fmt, fmtDate, ragColor, valFromKpis, ragFromKpis } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';
import Breadcrumb from '../components/shared/Breadcrumb';
import { Divider, TrendArrow, ModeTab, PillSelector } from '../components/analysis/AnalysisComponents';
import { usePeriod } from '../context/PeriodContext';

const CARD = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 18, boxShadow: 'var(--shadow-sm)',
};

// ─── RANKING HELPERS ────────────────────────────────────────────────────────

function rankTeams(teams, kpiKey) {
  const meta = KPI_META[kpiKey];
  const ranked = teams
    .map(t => {
      const kpi = t.kpis.find(k => k.kpiKey === kpiKey);
      return { teamId: t.teamId, value: kpi?.currVal, rag: kpi?.currRag, delta: kpi?.delta, improved: kpi?.improved };
    })
    .filter(t => t.value != null)
    .sort((a, b) => meta?.lower_better ? a.value - b.value : b.value - a.value);
  return ranked;
}

// ─── COMPARISON MODE ────────────────────────────────────────────────────────

const INTERVALS = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'custom', label: 'Custom' },
];

function ComparisonMode() {
  const navigate = useNavigate();
  const { periodStart, periodEnd } = usePeriod();
  const [interval, setInterval] = useState('monthly');
  const [customCurrent, setCustomCurrent] = useState({ start: '', end: '' });
  const [customPrevious, setCustomPrevious] = useState({ start: '', end: '' });
  const [appliedCustom, setAppliedCustom] = useState(null);

  const effectiveCustomCurrent = interval === 'custom' ? (appliedCustom?.current || null) : null;
  const effectiveCustomPrevious = interval === 'custom' ? (appliedCustom?.previous || null) : null;

  const { mergedData, isLoading, error, periods } = usePerformanceComparison(
    interval, effectiveCustomCurrent, effectiveCustomPrevious, periodStart, periodEnd
  );

  const [chartKpi, setChartKpi] = useState('rework_rate');
  const [doraChartKpi, setDoraChartKpi] = useState('deploy_frequency');

  return (
    <>
      {/* Controls row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <PillSelector options={INTERVALS} value={interval} onChange={setInterval} />
      </div>

      {/* Custom date pickers */}
      {interval === 'custom' && (
        <div style={{ ...CARD, padding: '16px 20px', marginBottom: 16, display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4 }}>Current Period</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" className="date-input" value={customCurrent.start} onChange={e => setCustomCurrent(p => ({ ...p, start: e.target.value }))} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
              <input type="date" className="date-input" value={customCurrent.end} onChange={e => setCustomCurrent(p => ({ ...p, end: e.target.value }))} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Previous Period</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" className="date-input" value={customPrevious.start} onChange={e => setCustomPrevious(p => ({ ...p, start: e.target.value }))} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
              <input type="date" className="date-input" value={customPrevious.end} onChange={e => setCustomPrevious(p => ({ ...p, end: e.target.value }))} />
            </div>
          </div>
          <button className="btn" onClick={() => setAppliedCustom({ current: customCurrent, previous: customPrevious })} style={{ alignSelf: 'flex-end' }}>
            Apply
          </button>
        </div>
      )}

      {/* Period banner */}
      {periods && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--accent)10', border: '1px solid var(--accent)30', borderRadius: 12, padding: '8px 16px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Period</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fmtDate(periods.current.start)} — {fmtDate(periods.current.end)}</div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>vs</span>
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 16px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Previous Period</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{fmtDate(periods.previous.start)} — {fmtDate(periods.previous.end)}</div>
          </div>
        </div>
      )}

      {isLoading && <Loader message="Loading cross-team comparison…" />}
      {error && <ErrorBox message={error.message} />}

      {mergedData && !isLoading && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Improved', count: mergedData.totalImproved, color: '#10b981', bg: '#d1fae5', Icon: TrendingUp },
              { label: 'Declined', count: mergedData.totalDeclined, color: '#ef4444', bg: '#fee2e2', Icon: TrendingDown },
              { label: 'Unchanged', count: mergedData.totalUnchanged, color: '#64748b', bg: '#f1f5f9', Icon: Minus },
            ].map(({ label, count, color, bg, Icon }) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: bg, border: `1px solid ${color}30`, borderRadius: 14, padding: '10px 18px',
              }}>
                <Icon size={16} strokeWidth={2.5} style={{ color }} />
                <span style={{ fontSize: 20, fontWeight: 900, color }}>{count}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>
              </div>
            ))}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#ede9fe', border: '1px solid #8b5cf630', borderRadius: 14, padding: '10px 18px',
            }}>
              <Scale size={16} strokeWidth={2.5} style={{ color: '#8b5cf6' }} />
              <span style={{ fontSize: 20, fontWeight: 900, color: '#8b5cf6' }}>{mergedData.teams.length}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6' }}>Teams</span>
            </div>
          </div>

          {/* Team KPI Rankings — one row per team */}
          <Divider label="Team KPI Rankings" icon={<Scale size={15} strokeWidth={2} />} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            {mergedData.teams.map(({ teamId, kpis }) => {
              const teamColor = TEAM_COLORS[teamId];
              return (
                <div key={teamId} style={{ ...CARD, padding: '14px 18px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: teamColor, borderRadius: '2px 0 0 2px' }} />
                  {/* Team name */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 160px', paddingLeft: 4, cursor: 'pointer', transition: 'opacity 0.15s' }}
                    onClick={() => navigate(`/teams/${teamId}`)}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: teamColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{TEAM_LABELS[teamId]}</span>
                  </div>
                  {/* All KPI + DORA metrics in a single row */}
                  <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                    {kpis.filter(k => KPI_KEYS.includes(k.kpiKey)).map(({ kpiKey, currVal, currRag, delta, improved }) => {
                      const meta = KPI_META[kpiKey];
                      return (
                        <div key={kpiKey} style={{
                          flex: '1 1 0', minWidth: 80, padding: '5px 8px',
                          background: 'var(--surface2)', borderRadius: 8, textAlign: 'center',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                          onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[kpiKey]}`)}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                            {meta?.icon} {meta?.label}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: ragColor(currRag), fontFamily: 'var(--font-mono)' }}>
                            {fmt(kpiKey, currVal)}
                          </div>
                          <TrendArrow improved={improved} delta={delta} metricKey={kpiKey} formatter={fmt} />
                        </div>
                      );
                    })}
                    {kpis.filter(k => DORA_KEYS.includes(k.kpiKey)).map(({ kpiKey, currVal, currRag, delta, improved }) => {
                      const meta = KPI_META[kpiKey];
                      return (
                        <div key={kpiKey} style={{
                          flex: '1 1 0', minWidth: 80, padding: '5px 8px',
                          background: 'var(--surface2)', borderRadius: 8, textAlign: 'center',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                          onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[kpiKey]}`)}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                            {meta?.icon} {meta?.label}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: ragColor(currRag), fontFamily: 'var(--font-mono)' }}>
                            {fmt(kpiKey, currVal)}
                          </div>
                          <TrendArrow improved={improved} delta={delta} metricKey={kpiKey} formatter={fmt} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* KPI Leaderboard — same row layout as Team KPI Rankings */}
          <Divider label="KPI Leaderboard" icon={<Scale size={15} strokeWidth={2} />} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            {KPI_KEYS.map(kpiKey => {
              const meta = KPI_META[kpiKey];
              const ranked = rankTeams(mergedData.teams, kpiKey);
              return (
                <div key={kpiKey} style={{ ...CARD, padding: '14px 18px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: 'var(--accent)', borderRadius: '2px 0 0 2px' }} />
                  {/* KPI label */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 220px', paddingLeft: 4 }}>
                    <span style={{ fontSize: 14 }}>{meta?.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{meta?.label}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{meta?.lower_better ? '(lower)' : '(higher)'}</span>
                  </div>
                  {/* Ranked teams as pills */}
                  <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                    {ranked.map((t, idx) => {
                      const rankColor = idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7f32' : 'var(--muted)';
                      return (
                        <div key={t.teamId} style={{
                          flex: '1 1 0', minWidth: 100, padding: '5px 8px',
                          background: 'var(--surface2)', borderRadius: 8, textAlign: 'center',
                          border: idx === 0 ? '1px solid #f59e0b30' : '1px solid transparent',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                          onClick={() => navigate(`/teams/${t.teamId}/kpis/${KPI_SLUG[kpiKey]}`)}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 900, color: rankColor }}>#{idx + 1}</span>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: TEAM_COLORS[t.teamId] }} />
                            {TEAM_LABELS[t.teamId]}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: ragColor(t.rag), fontFamily: 'var(--font-mono)' }}>
                            {fmt(kpiKey, t.value)}
                          </div>
                          <TrendArrow improved={t.improved} delta={t.delta} metricKey={kpiKey} formatter={fmt} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* DORA Leaderboard — same row layout */}
          <Divider label="DORA Leaderboard" icon={<TrendingUp size={15} strokeWidth={2} />} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            {DORA_KEYS.map(kpiKey => {
              const meta = KPI_META[kpiKey];
              const ranked = rankTeams(mergedData.teams, kpiKey);
              return (
                <div key={kpiKey} style={{ ...CARD, padding: '14px 18px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: 'var(--accent)', borderRadius: '2px 0 0 2px' }} />
                  {/* DORA label */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 220px', paddingLeft: 4 }}>
                    <span style={{ fontSize: 14 }}>{meta?.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{meta?.label}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{meta?.lower_better ? '(lower)' : '(higher)'}</span>
                  </div>
                  {/* Ranked teams as pills */}
                  <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                    {ranked.map((t, idx) => {
                      const rankColor = idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7f32' : 'var(--muted)';
                      return (
                        <div key={t.teamId} style={{
                          flex: '1 1 0', minWidth: 100, padding: '5px 8px',
                          background: 'var(--surface2)', borderRadius: 8, textAlign: 'center',
                          border: idx === 0 ? '1px solid #f59e0b30' : '1px solid transparent',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                          onClick={() => navigate(`/teams/${t.teamId}/kpis/${KPI_SLUG[kpiKey]}`)}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 900, color: rankColor }}>#{idx + 1}</span>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: TEAM_COLORS[t.teamId] }} />
                            {TEAM_LABELS[t.teamId]}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: ragColor(t.rag), fontFamily: 'var(--font-mono)' }}>
                            {fmt(kpiKey, t.value)}
                          </div>
                          <TrendArrow improved={t.improved} delta={t.delta} metricKey={kpiKey} formatter={fmt} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* KPI Bar Chart */}
          <Divider label="KPI Visual Comparison" icon={<BarChart3 size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px', marginBottom: 8 }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={KPI_KEYS.map(k => ({ id: k, label: KPI_META[k]?.label }))}
                value={KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0]}
                onChange={setChartKpi}
              />
            </div>
            <div role="img" aria-label="Cross-team KPI comparison bar chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={mergedData.teams.map(t => {
                  const activeKpi = KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0];
                  const kpi = t.kpis.find(k => k.kpiKey === activeKpi);
                  return { name: TEAM_LABELS[t.teamId] || t.teamId, current: kpi?.currVal, previous: kpi?.prevVal };
                })}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmt(KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0], v)} />
                  <Tooltip
                    formatter={(v) => fmt(KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0], v)}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  />
                  <Legend />
                  <Bar dataKey="current" name="Current" fill="var(--accent)" radius={[4, 4, 0, 0]} barSize={24} />
                  <Bar dataKey="previous" name="Previous" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* DORA Bar Chart */}
          <Divider label="DORA Visual Comparison" icon={<BarChart3 size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px' }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={DORA_KEYS.map(k => ({ id: k, label: KPI_META[k]?.label }))}
                value={DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0]}
                onChange={setDoraChartKpi}
              />
            </div>
            <div role="img" aria-label="Cross-team DORA comparison bar chart">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={mergedData.teams.map(t => {
                  const activeKpi = DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0];
                  const kpi = t.kpis.find(k => k.kpiKey === activeKpi);
                  return { name: TEAM_LABELS[t.teamId] || t.teamId, current: kpi?.currVal, previous: kpi?.prevVal };
                })}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmt(DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0], v)} />
                  <Tooltip
                    formatter={(v) => fmt(DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0], v)}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  />
                  <Legend />
                  <Bar dataKey="current" name="Current" fill="var(--accent)" radius={[4, 4, 0, 0]} barSize={24} />
                  <Bar dataKey="previous" name="Previous" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── HISTORICAL TREND MODE ──────────────────────────────────────────────────

const GRANULARITIES = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
];

function HistoricalTrendMode() {
  const navigate = useNavigate();
  const [granularity, setGranularity] = useState('monthly');
  const [chartKpi, setChartKpi] = useState('rework_rate');
  const [doraChartKpi, setDoraChartKpi] = useState('deploy_frequency');
  const { timeSeriesData, isLoading, error, periods } = useHistoricalTrend(granularity);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <PillSelector options={GRANULARITIES} value={granularity} onChange={setGranularity} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {periods.map(p => (
            <span key={p.label} style={{
              fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
              background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)',
            }}>
              {p.label}
            </span>
          ))}
        </div>
      </div>

      {isLoading && <Loader message="Loading cross-team historical data…" />}
      {error && <ErrorBox message={error.message} />}

      {timeSeriesData && !isLoading && (
        <>
          {/* Team legend */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {TEAMS.map(teamId => (
              <div key={teamId} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 10,
                background: 'var(--surface2)', border: '1px solid var(--border)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
                onClick={() => navigate(`/teams/${teamId}`)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = TEAM_COLORS[teamId]; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[teamId] }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{TEAM_LABELS[teamId]}</span>
              </div>
            ))}
          </div>

          {/* KPI Trend Chart */}
          <Divider label="KPI Trends" icon={<TrendingUp size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px', marginBottom: 8 }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={KPI_KEYS.map(k => ({ id: k, label: KPI_META[k]?.label }))}
                value={KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0]}
                onChange={setChartKpi}
              />
            </div>
            <div role="img" aria-label="Cross-team KPI trends line chart">
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={timeSeriesData.chartData[KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0]] || []}>
                  <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--muted)', fontWeight: 600 }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmt(KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0], v)} />
                  <Tooltip
                    formatter={(v) => fmt(KPI_KEYS.includes(chartKpi) ? chartKpi : KPI_KEYS[0], v)}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  />
                  <Legend />
                  {TEAMS.map(teamId => (
                    <Line key={teamId} type="monotone" dataKey={teamId} name={TEAM_LABELS[teamId]}
                      stroke={TEAM_COLORS[teamId]} strokeWidth={2.5}
                      dot={{ r: 4, fill: TEAM_COLORS[teamId] }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* DORA Trend Chart */}
          <Divider label="DORA Trends" icon={<TrendingUp size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px', marginBottom: 8 }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={DORA_KEYS.map(k => ({ id: k, label: KPI_META[k]?.label }))}
                value={DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0]}
                onChange={setDoraChartKpi}
              />
            </div>
            <div role="img" aria-label="Cross-team DORA trends line chart">
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={timeSeriesData.chartData[DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0]] || []}>
                  <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--muted)', fontWeight: 600 }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmt(DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0], v)} />
                  <Tooltip
                    formatter={(v) => fmt(DORA_KEYS.includes(doraChartKpi) ? doraChartKpi : DORA_KEYS[0], v)}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  />
                  <Legend />
                  {TEAMS.map(teamId => (
                    <Line key={teamId} type="monotone" dataKey={teamId} name={TEAM_LABELS[teamId]}
                      stroke={TEAM_COLORS[teamId]} strokeWidth={2.5}
                      dot={{ r: 4, fill: TEAM_COLORS[teamId] }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* KPI Period-over-Period Detail */}
          <Divider label="KPI Period-over-Period Detail" icon={<Clock size={15} strokeWidth={2} />} />
          {KPI_KEYS.map(kpiKey => {
            const meta = KPI_META[kpiKey];
            return (
              <div key={kpiKey} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{meta?.icon}</span> {meta?.label}
                </div>
                <div style={{ ...CARD, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: 160 }} />
                      {periods.map(p => <col key={p.label} />)}
                    </colgroup>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Team</th>
                        {periods.map(p => (
                          <th key={p.label} style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 10 }}>
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timeSeriesData.teamsData.map(({ teamId, kpiSeries }) => {
                        const series = kpiSeries[kpiKey] || [];
                        return (
                          <tr key={teamId} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td
                              style={{ width: 140, padding: '8px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1, cursor: 'pointer', transition: 'background 0.15s' }}
                              onClick={() => navigate(`/teams/${teamId}`)}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: TEAM_COLORS[teamId], flexShrink: 0 }} />
                                {TEAM_LABELS[teamId]}
                              </div>
                            </td>
                            {series.map((entry, i) => {
                              const prevEntry = i > 0 ? series[i - 1] : null;
                              const delta = (entry.value != null && prevEntry?.value != null) ? entry.value - prevEntry.value : null;
                              const improved = delta != null && delta !== 0
                                ? (meta?.lower_better ? delta < 0 : delta > 0) : null;
                              return (
                                <td
                                  key={entry.period}
                                  style={{ padding: '6px 10px', textAlign: 'center', cursor: 'pointer', transition: 'background 0.15s' }}
                                  onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[kpiKey]}`)}
                                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                                  onMouseLeave={e => e.currentTarget.style.background = ''}
                                >
                                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: ragColor(entry.rag) }}>
                                    {fmt(kpiKey, entry.value)}
                                  </div>
                                  {i > 0 && <TrendArrow improved={improved} delta={delta} metricKey={kpiKey} formatter={fmt} />}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* DORA Period-over-Period Detail */}
          <Divider label="DORA Period-over-Period Detail" icon={<Clock size={15} strokeWidth={2} />} />
          {DORA_KEYS.map(kpiKey => {
            const meta = KPI_META[kpiKey];
            return (
              <div key={kpiKey} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{meta?.icon}</span> {meta?.label}
                </div>
                <div style={{ ...CARD, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: 160 }} />
                      {periods.map(p => <col key={p.label} />)}
                    </colgroup>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Team</th>
                        {periods.map(p => (
                          <th key={p.label} style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 10 }}>
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timeSeriesData.teamsData.map(({ teamId, kpiSeries }) => {
                        const series = kpiSeries[kpiKey] || [];
                        return (
                          <tr key={teamId} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td
                              style={{ width: 140, padding: '8px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1, cursor: 'pointer', transition: 'background 0.15s' }}
                              onClick={() => navigate(`/teams/${teamId}`)}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: TEAM_COLORS[teamId], flexShrink: 0 }} />
                                {TEAM_LABELS[teamId]}
                              </div>
                            </td>
                            {series.map((entry, i) => {
                              const prevEntry = i > 0 ? series[i - 1] : null;
                              const delta = (entry.value != null && prevEntry?.value != null) ? entry.value - prevEntry.value : null;
                              const improved = delta != null && delta !== 0
                                ? (meta?.lower_better ? delta < 0 : delta > 0) : null;
                              return (
                                <td
                                  key={entry.period}
                                  style={{ padding: '6px 10px', textAlign: 'center', cursor: 'pointer', transition: 'background 0.15s' }}
                                  onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[kpiKey]}`)}
                                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                                  onMouseLeave={e => e.currentTarget.style.background = ''}
                                >
                                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: ragColor(entry.rag) }}>
                                    {fmt(kpiKey, entry.value)}
                                  </div>
                                  {i > 0 && <TrendArrow improved={improved} delta={delta} metricKey={kpiKey} formatter={fmt} />}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

// ─── MAIN PAGE ──────────────────────────────────────────────────────────────

export default function CrossPerformancePage() {
  const [mode, setMode] = useState('comparison');

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <Breadcrumb items={[{ label: 'Overview', to: '/' }, { label: 'Cross Performance' }]} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em' }}>Cross-Team Performance</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Compare KPIs and DORA metrics across all teams with rankings</div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 14, padding: 4 }}>
          <ModeTab active={mode === 'comparison'} label="Comparison" icon={<BarChart3 size={14} />} onClick={() => setMode('comparison')} />
          <ModeTab active={mode === 'historical'} label="Historical Trend" icon={<TrendingUp size={14} />} onClick={() => setMode('historical')} />
        </div>
      </div>

      {mode === 'comparison' ? <ComparisonMode /> : <HistoricalTrendMode />}
    </div>
  );
}
