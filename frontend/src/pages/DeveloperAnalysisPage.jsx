import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, BarChart3, Clock, Users } from 'lucide-react';
import {
  useDeveloperComparison,
  useDeveloperHistorical,
} from '../api/hooks/useDeveloperAnalysis';
import {
  DEV_METRICS, DEV_METRIC_KEYS, devColor, fmtDev, devRateColor,
} from '../api/hooks/useDeveloperAnalysis';
import { TEAMS, TEAM_LABELS, TEAM_COLORS } from '../lib/constants';
import { fmtDate } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';
import Breadcrumb from '../components/shared/Breadcrumb';
import Avatar from '../components/shared/Avatar';
import { Divider, TrendArrow, ModeTab, PillSelector } from '../components/analysis/AnalysisComponents';

const CARD = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 18, boxShadow: 'var(--shadow-sm)',
};

function TeamSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 12, padding: 3, flexWrap: 'wrap' }}>
      {TEAMS.map(t => (
        <button key={t} onClick={() => onChange(t)} style={{
          padding: '7px 14px', borderRadius: 10, border: 'none',
          background: value === t ? TEAM_COLORS[t] : 'transparent',
          color: value === t ? '#fff' : 'var(--muted)',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          {value !== t && <div style={{ width: 6, height: 6, borderRadius: '50%', background: TEAM_COLORS[t] }} />}
          {TEAM_LABELS[t]}
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

// All metrics shown on developer comparison cards
const CARD_METRICS = DEV_METRIC_KEYS;

function devUrl(name, teamId) {
  return `/cross-developers/${encodeURIComponent(`${name}::${teamId}`)}`;
}

function ComparisonMode({ teamId }) {
  const navigate = useNavigate();
  const [interval, setInterval] = useState('monthly');
  const [customCurrent, setCustomCurrent] = useState({ start: '', end: '' });
  const [customPrevious, setCustomPrevious] = useState({ start: '', end: '' });
  const [appliedCustom, setAppliedCustom] = useState(null);

  const effectiveCustomCurrent = interval === 'custom' ? (appliedCustom?.current || null) : null;
  const effectiveCustomPrevious = interval === 'custom' ? (appliedCustom?.previous || null) : null;

  const { mergedData, isLoading, error, periods } = useDeveloperComparison(
    teamId, interval, effectiveCustomCurrent, effectiveCustomPrevious
  );

  const [chartMetric, setChartMetric] = useState('throughput');

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
              <input type="date" className="date-input" aria-label="Current period start date" value={customCurrent.start} onChange={e => setCustomCurrent(p => ({ ...p, start: e.target.value }))} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
              <input type="date" className="date-input" aria-label="Current period end date" value={customCurrent.end} onChange={e => setCustomCurrent(p => ({ ...p, end: e.target.value }))} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Previous Period</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" className="date-input" aria-label="Previous period start date" value={customPrevious.start} onChange={e => setCustomPrevious(p => ({ ...p, start: e.target.value }))} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
              <input type="date" className="date-input" aria-label="Previous period end date" value={customPrevious.end} onChange={e => setCustomPrevious(p => ({ ...p, end: e.target.value }))} />
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

      {isLoading && <Loader message="Loading developer comparison…" />}
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
              <Users size={16} strokeWidth={2.5} style={{ color: '#8b5cf6' }} />
              <span style={{ fontSize: 20, fontWeight: 900, color: '#8b5cf6' }}>{mergedData.developers.length}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6' }}>Developers</span>
            </div>
          </div>

          {/* Developer Metric Cards */}
          <Divider label="Developer Metrics" icon={<Users size={15} strokeWidth={2} />} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14, marginBottom: 8 }}>
            {mergedData.developers.map((dev, idx) => {
              const tp = dev.metrics.throughput;
              const accentColor = devColor(idx);
              return (
                <div key={dev.name} style={{ ...CARD, padding: '16px 18px', position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.15s' }}
                  onClick={() => navigate(devUrl(dev.name, teamId))}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08))'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accentColor }} />
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Avatar name={dev.name} size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: TEAM_COLORS[teamId] }} />
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{TEAM_LABELS[teamId]}</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
                          {dev.currTotal} items (was {dev.prevTotal})
                        </span>
                      </div>
                    </div>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: accentColor, flexShrink: 0 }} />
                  </div>
                  {/* Throughput big number */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: accentColor, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                      {fmtDev('throughput', tp.currVal)} delivered
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      was {fmtDev('throughput', tp.prevVal)}
                    </span>
                    <TrendArrow improved={tp.improved} delta={tp.delta} metricKey="throughput" formatter={fmtDev} />
                  </div>
                  {/* All metrics row */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {CARD_METRICS.filter(k => k !== 'throughput').map(metricKey => {
                      const m = dev.metrics[metricKey];
                      const meta = DEV_METRICS[metricKey];
                      return (
                        <div key={metricKey} style={{
                          flex: '1 1 60px', minWidth: 60, padding: '6px 8px',
                          background: 'var(--surface2)', borderRadius: 8, textAlign: 'center',
                        }}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                            {meta.label}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                            {fmtDev(metricKey, m.currVal)}
                          </div>
                          <TrendArrow improved={m.improved} delta={m.delta} metricKey={metricKey} formatter={fmtDev} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Developer Comparison Table */}
          <Divider label="Developer Comparison Table" />
          <div style={{ ...CARD, overflow: 'auto', marginBottom: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Developer</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Team</th>
                  {DEV_METRIC_KEYS.map(k => (
                    <th key={k} style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {DEV_METRICS[k].icon} {DEV_METRICS[k].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mergedData.developers.map((dev, idx) => (
                  <tr key={dev.name} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onClick={() => navigate(devUrl(dev.name, teamId))}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                  >
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={dev.name} size={24} />
                        <span>{dev.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: TEAM_COLORS[teamId] }} />
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>{TEAM_LABELS[teamId]}</span>
                      </div>
                    </td>
                    {DEV_METRIC_KEYS.map(metricKey => {
                      const m = dev.metrics[metricKey];
                      const color = metricKey === 'reworkRate' ? devRateColor(1 - (m.currVal ?? 0)) : 'var(--text)';
                      return (
                        <td key={metricKey} style={{ padding: '8px', textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color }}>
                            {fmtDev(metricKey, m.currVal)}
                          </div>
                          <TrendArrow improved={m.improved} delta={m.delta} metricKey={metricKey} formatter={fmtDev} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Developer Bar Chart */}
          <Divider label="Visual Comparison" icon={<BarChart3 size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px' }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={DEV_METRIC_KEYS.map(k => ({ id: k, label: DEV_METRICS[k].label }))}
                value={DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0]}
                onChange={setChartMetric}
              />
            </div>
            <div role="img" aria-label="Developer metrics comparison bar chart">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mergedData.developers.map(d => {
                const activeMetric = DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0];
                const m = d.metrics[activeMetric];
                return { name: d.name.split(' ')[0], current: m.currVal, previous: m.prevVal };
              })}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmtDev(DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0], v)} />
                <Tooltip
                  formatter={(v) => fmtDev(DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0], v)}
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

// ─── HISTORICAL TREND MODE ────────────────────────────────────────────────────

const GRANULARITIES = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
];

function HistoricalTrendMode({ teamId }) {
  const navigate = useNavigate();
  const [granularity, setGranularity] = useState('monthly');
  const [chartMetric, setChartMetric] = useState('throughput');
  const { timeSeriesData, isLoading, error, periods } = useDeveloperHistorical(teamId, granularity);

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

      {isLoading && <Loader message="Loading historical developer data…" />}
      {error && <ErrorBox message={error.message} />}

      {timeSeriesData && !isLoading && (
        <>
          {/* Developer legend */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {timeSeriesData.devNames.map((name, idx) => (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 10,
                background: 'var(--surface2)', border: '1px solid var(--border)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
                onClick={() => navigate(devUrl(name, teamId))}
                onMouseEnter={e => { e.currentTarget.style.borderColor = devColor(idx); e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = ''; }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: devColor(idx) }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{name}</span>
              </div>
            ))}
          </div>

          {/* Trend Chart */}
          <Divider label="Developer Trends" icon={<TrendingUp size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px', marginBottom: 8 }}>
            <div style={{ marginBottom: 16 }}>
              <PillSelector
                options={DEV_METRIC_KEYS.map(k => ({ id: k, label: DEV_METRICS[k].label }))}
                value={DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0]}
                onChange={setChartMetric}
              />
            </div>
            <div role="img" aria-label="Developer historical trends line chart">
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={timeSeriesData.chartData[DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0]] || []}>
                <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--muted)', fontWeight: 600 }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmtDev(DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0], v)} />
                <Tooltip
                  formatter={(v, name) => [fmtDev(DEV_METRIC_KEYS.includes(chartMetric) ? chartMetric : DEV_METRIC_KEYS[0], v), name]}
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                />
                <Legend />
                {timeSeriesData.devNames.map((name, idx) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    name={name}
                    stroke={devColor(idx)}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: devColor(idx) }}
                    activeDot={{ r: 6 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            </div>
          </div>

          {/* Period-over-Period Detail Tables */}
          <Divider label="Period-over-Period Detail" icon={<Clock size={15} strokeWidth={2} />} />
          {DEV_METRIC_KEYS.map(metricKey => {
            const meta = DEV_METRICS[metricKey];
            return (
              <div key={metricKey} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{meta.icon}</span> {meta.label}
                </div>
                <div style={{ ...CARD, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: 160 }} />
                      <col style={{ width: 120 }} />
                      {periods.map(p => <col key={p.label} />)}
                    </colgroup>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>Developer</th>
                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>Team</th>
                        {periods.map(p => (
                          <th key={p.label} style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 10 }}>
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timeSeriesData.devsData.map(({ name, metricSeries }, idx) => {
                        const series = metricSeries[metricKey] || [];
                        const byPeriod = Object.fromEntries(series.map(e => [e.period, e]));
                        return (
                          <tr key={name} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                            onClick={() => navigate(devUrl(name, teamId))}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                          >
                            <td style={{ padding: '8px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: devColor(idx), flexShrink: 0 }} />
                                {name}
                              </div>
                            </td>
                            <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 5, height: 5, borderRadius: '50%', background: TEAM_COLORS[teamId], flexShrink: 0 }} />
                                <span style={{ fontSize: 10, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{TEAM_LABELS[teamId]}</span>
                              </div>
                            </td>
                            {periods.map((p, i) => {
                              const entry = byPeriod[p.label];
                              const prevPeriod = i > 0 ? byPeriod[periods[i - 1].label] : null;
                              const delta = (entry?.value != null && prevPeriod?.value != null)
                                ? entry.value - prevPeriod.value : null;
                              const improved = delta != null && delta !== 0
                                ? (meta.lower_better ? delta < 0 : delta > 0) : null;
                              const color = metricKey === 'reworkRate' ? devRateColor(1 - (entry?.value ?? 0)) : 'var(--text)';
                              return (
                                <td key={p.label} style={{ padding: '6px 10px', textAlign: 'center' }}>
                                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color }}>
                                    {fmtDev(metricKey, entry?.value ?? null)}
                                  </div>
                                  {i > 0 && <TrendArrow improved={improved} delta={delta} metricKey={metricKey} formatter={fmtDev} />}
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

export default function DeveloperAnalysisPage() {
  const [mode, setMode] = useState('comparison');
  const [teamId, setTeamId] = useState(TEAMS[0]);

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <Breadcrumb items={[{ label: 'Overview', to: '/' }, { label: 'Developer Analysis' }]} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em' }}>Developer Analysis</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Compare developer performance within a team across periods</div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 14, padding: 4 }}>
          <ModeTab active={mode === 'comparison'} label="Comparison" icon={<BarChart3 size={14} />} onClick={() => setMode('comparison')} />
          <ModeTab active={mode === 'historical'} label="Historical Trend" icon={<TrendingUp size={14} />} onClick={() => setMode('historical')} />
        </div>
      </div>

      {/* Team selector */}
      <div style={{ marginBottom: 20 }}>
        <TeamSelector value={teamId} onChange={setTeamId} />
      </div>

      {mode === 'comparison'
        ? <ComparisonMode teamId={teamId} />
        : <HistoricalTrendMode teamId={teamId} />}
    </div>
  );
}
