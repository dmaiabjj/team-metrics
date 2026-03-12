import { useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, BarChart3, Clock } from 'lucide-react';
import { usePerformanceComparison, useHistoricalTrend } from '../api/hooks/usePerformanceAnalysis';
import { TEAMS, TEAM_LABELS, TEAM_COLORS, KPI_META, ALL_KPI_KEYS, KPI_KEYS, DORA_KEYS } from '../lib/constants';
import { fmt, fmtDate, ragColor, valFromKpis, ragFromKpis } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';
import Breadcrumb from '../components/shared/Breadcrumb';

// ─── SHARED SUB-COMPONENTS ───────────────────────────────────────────────────

const CARD = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 18, boxShadow: 'var(--shadow-sm)',
};

function Divider({ label, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 16px' }}>
      <div style={{ width: 3, height: 18, background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
      {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function TrendArrow({ improved, delta, kpiKey }) {
  if (improved == null || delta == null || delta === 0) {
    return <span style={{ color: 'var(--muted)', fontSize: 11 }}><Minus size={11} /></span>;
  }
  const color = improved ? '#10b981' : '#ef4444';
  const Icon = improved ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color, fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
      <Icon size={12} strokeWidth={2.5} />
      {fmt(kpiKey, Math.abs(delta))}
    </span>
  );
}

function ModeTab({ active, label, icon, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 20px', borderRadius: 12, border: 'none',
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--muted)',
      fontSize: 13, fontWeight: 700, cursor: 'pointer',
      transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {icon} {label}
    </button>
  );
}

function PillSelector({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 12, padding: 3 }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          padding: '7px 14px', borderRadius: 10, border: 'none',
          background: value === o.id ? 'var(--accent)' : 'transparent',
          color: value === o.id ? '#fff' : 'var(--muted)',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── COMPARISON MODE ──────────────────────────────────────────────────────────

const INTERVALS = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'custom', label: 'Custom' },
];

function ComparisonMode() {
  const [interval, setInterval] = useState('monthly');
  const [customCurrent, setCustomCurrent] = useState({ start: '', end: '' });
  const [customPrevious, setCustomPrevious] = useState({ start: '', end: '' });
  const [appliedCustom, setAppliedCustom] = useState(null);

  const effectiveCustomCurrent = interval === 'custom' ? (appliedCustom?.current || null) : null;
  const effectiveCustomPrevious = interval === 'custom' ? (appliedCustom?.previous || null) : null;

  const { mergedData, isLoading, error, periods } = usePerformanceComparison(
    interval, effectiveCustomCurrent, effectiveCustomPrevious
  );

  const [chartKpi, setChartKpi] = useState('rework_rate');

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

      {isLoading && <Loader message="Loading comparison data…" />}
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
          </div>

          {/* KPI Trend Grid */}
          <Divider label="KPI Trends" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 8 }}>
            {mergedData.averages.map(({ kpiKey, currVal, prevVal, currRag, delta, improved }) => {
              const meta = KPI_META[kpiKey];
              return (
                <div key={kpiKey} style={{ ...CARD, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: ragColor(currRag) }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                      <span style={{ marginRight: 5 }}>{meta?.icon}</span>{meta?.label}
                    </div>
                    <TrendArrow improved={improved} delta={delta} kpiKey={kpiKey} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: ragColor(currRag), fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                      {fmt(kpiKey, currVal)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      was {fmt(kpiKey, prevVal)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Team Comparison Table */}
          <Divider label="Team Comparison" />
          <div style={{ ...CARD, overflow: 'auto', marginBottom: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Team</th>
                  {ALL_KPI_KEYS.map(k => (
                    <th key={k} style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {KPI_META[k]?.icon} {KPI_META[k]?.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mergedData.teams.map(({ teamId, kpis }) => (
                  <tr key={teamId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[teamId], flexShrink: 0 }} />
                        {TEAM_LABELS[teamId]}
                      </div>
                    </td>
                    {kpis.map(({ kpiKey, currVal, currRag, delta, improved }) => (
                      <td key={kpiKey} style={{ padding: '8px', textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: ragColor(currRag) }}>
                          {fmt(kpiKey, currVal)}
                        </div>
                        <TrendArrow improved={improved} delta={delta} kpiKey={kpiKey} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bar Chart */}
          <Divider label="Visual Comparison" icon={<BarChart3 size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px' }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={ALL_KPI_KEYS.map(k => ({ id: k, label: KPI_META[k]?.label }))}
                value={chartKpi}
                onChange={setChartKpi}
              />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mergedData.teams.map(t => {
                const kpi = t.kpis.find(k => k.kpiKey === chartKpi);
                return { name: TEAM_LABELS[t.teamId] || t.teamId, current: kpi?.currVal, previous: kpi?.prevVal };
              })}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmt(chartKpi, v)} />
                <Tooltip
                  formatter={(v) => fmt(chartKpi, v)}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                />
                <Legend />
                <Bar dataKey="current" name="Current" fill="var(--accent)" radius={[4, 4, 0, 0]} barSize={24} />
                <Bar dataKey="previous" name="Previous" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </>
  );
}

// ─── HISTORICAL TREND MODE ────────────────────────────────────────────────────

const GRANULARITIES = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
];

function HistoricalTrendMode() {
  const [granularity, setGranularity] = useState('monthly');
  const [chartKpi, setChartKpi] = useState('rework_rate');
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

      {isLoading && <Loader message="Loading historical data…" />}
      {error && <ErrorBox message={error.message} />}

      {timeSeriesData && !isLoading && (
        <>
          {/* Line Chart */}
          <Divider label="Trend Chart" icon={<TrendingUp size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px', marginBottom: 8 }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={ALL_KPI_KEYS.map(k => ({ id: k, label: KPI_META[k]?.label }))}
                value={chartKpi}
                onChange={setChartKpi}
              />
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={timeSeriesData.chartData[chartKpi] || []}>
                <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--muted)', fontWeight: 600 }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmt(chartKpi, v)} />
                <Tooltip
                  formatter={(v) => fmt(chartKpi, v)}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                />
                <Legend />
                {TEAMS.map(teamId => (
                  <Line
                    key={teamId}
                    type="monotone"
                    dataKey={teamId}
                    name={TEAM_LABELS[teamId]}
                    stroke={TEAM_COLORS[teamId]}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: TEAM_COLORS[teamId] }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Historical Table */}
          <Divider label="Period-over-Period Detail" icon={<Clock size={15} strokeWidth={2} />} />
          {ALL_KPI_KEYS.map(kpiKey => {
            const meta = KPI_META[kpiKey];
            return (
              <div key={kpiKey} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{meta?.icon}</span> {meta?.label}
                </div>
                <div style={{ ...CARD, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
                            <td style={{ padding: '8px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: TEAM_COLORS[teamId], flexShrink: 0 }} />
                                {TEAM_LABELS[teamId]}
                              </div>
                            </td>
                            {series.map((entry, i) => {
                              const prevEntry = i > 0 ? series[i - 1] : null;
                              const delta = (entry.value != null && prevEntry?.value != null)
                                ? entry.value - prevEntry.value : null;
                              const improved = delta != null && delta !== 0
                                ? (meta?.lower_better ? delta < 0 : delta > 0) : null;
                              return (
                                <td key={entry.period} style={{ padding: '6px 10px', textAlign: 'center' }}>
                                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: ragColor(entry.rag) }}>
                                    {fmt(kpiKey, entry.value)}
                                  </div>
                                  {i > 0 && <TrendArrow improved={improved} delta={delta} kpiKey={kpiKey} />}
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

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function PerformanceAnalysisPage() {
  const [mode, setMode] = useState('comparison');

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <Breadcrumb items={[{ label: 'Overview', to: '/' }, { label: 'Performance Analysis' }]} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em' }}>Performance Analysis</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Compare team metrics across periods and track trends</div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 14, padding: 4 }}>
          <ModeTab active={mode === 'comparison'} label="Comparison" icon={<BarChart3 size={14} />} onClick={() => setMode('comparison')} />
          <ModeTab active={mode === 'historical'} label="Historical Trend" icon={<TrendingUp size={14} />} onClick={() => setMode('historical')} />
        </div>
      </div>

      {mode === 'comparison' ? <ComparisonMode /> : <HistoricalTrendMode />}
    </div>
  );
}
