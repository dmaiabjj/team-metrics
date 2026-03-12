import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, Users, Clock, ArrowLeft } from 'lucide-react';
import { usePersonDetail } from '../api/hooks/usePersonDetail';
import { PERSON_METRICS, fmtPerson, personColor, personRateColor } from '../api/hooks/useCrossTeamAnalysis';
import { TEAM_LABELS, TEAM_COLORS } from '../lib/constants';
import { fmtDate } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';
import Breadcrumb from '../components/shared/Breadcrumb';
import Avatar from '../components/shared/Avatar';
import WorkItemsTable from '../components/tables/WorkItemsTable';
import { Divider, TrendArrow, PillSelector } from '../components/analysis/AnalysisComponents';

const CARD = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 18, boxShadow: 'var(--shadow-sm)',
};

const INTERVALS = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
];

const METRIC_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

export default function PersonDetailPage({ personField }) {
  const { personKey } = useParams();
  const navigate = useNavigate();
  const [interval, setInterval] = useState('monthly');
  const [chartMetric, setChartMetric] = useState(null);

  // Decode person key
  const decoded = decodeURIComponent(personKey);
  const sepIdx = decoded.lastIndexOf('::');
  const personName = sepIdx >= 0 ? decoded.slice(0, sepIdx) : decoded;
  const teamId = sepIdx >= 0 ? decoded.slice(sepIdx + 2) : '';

  // Determine metrics based on role
  const metricKeys = personField === 'developer'
    ? ['throughput', 'avgCycleTime', 'reworkRate', 'bugsCount', 'deliveryRate']
    : ['throughput'];

  const personLabel = personField === 'developer' ? 'Developer' : 'QA Engineer';
  const backPath = personField === 'developer' ? '/cross-developers' : '/cross-qa';
  const breadcrumbLabel = personField === 'developer' ? 'Cross Developers' : 'Cross QA';

  const { personData, isLoading, error, periods } = usePersonDetail(
    personName, teamId, personField, metricKeys, interval
  );

  const activeChartMetric = chartMetric && metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0];
  const teamColor = TEAM_COLORS[teamId] || '#7c6af7';

  return (
    <div className="page animate-fade-in">
      <Breadcrumb items={[
        { label: 'Overview', to: '/' },
        { label: breadcrumbLabel, to: backPath },
        { label: personName },
      ]} />

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <button
          onClick={() => navigate(backPath)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid var(--border)', borderRadius: 10,
            padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            color: 'var(--muted)', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <ArrowLeft size={14} /> Back to {breadcrumbLabel}
        </button>
        <PillSelector options={INTERVALS} value={interval} onChange={setInterval} />
      </div>

      {/* Hero Banner */}
      <div style={{
        ...CARD, overflow: 'hidden', marginBottom: 28,
      }}>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ width: 6, background: teamColor, flexShrink: 0 }} />
          <div style={{ flex: 1, padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <Avatar name={personName} size={56} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--text)' }}>
                {personName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: teamColor }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{TEAM_LABELS[teamId]}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  padding: '2px 10px', borderRadius: 20,
                  background: personField === 'developer' ? '#e0e7ff' : '#d1fae5',
                  color: personField === 'developer' ? '#6366f1' : '#10b981',
                }}>
                  {personLabel}
                </span>
              </div>
            </div>

            {/* Summary stats on the right */}
            {personData && (
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--accent)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                    {personData.currTotal}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Total Items</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#10b981', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                    {fmtPerson('throughput', personData.metrics?.throughput?.currVal)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Delivered</div>
                </div>
                {personData.prevTotal > 0 && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                      was {personData.prevTotal}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Prev Period</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Period info strip */}
        {periods && (
          <div style={{ padding: '10px 28px 14px 34px', borderTop: '1px solid var(--border)', background: 'var(--surface2)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {fmtDate(periods.current.start)} — {fmtDate(periods.current.end)}
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)' }}>vs</span>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Previous</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
              {fmtDate(periods.previous.start)} — {fmtDate(periods.previous.end)}
            </div>
          </div>
        )}
      </div>

      {isLoading && <Loader message={`Loading ${personLabel.toLowerCase()} data\u2026`} />}
      {error && <ErrorBox message={error.message} />}

      {personData && !isLoading && (
        <>
          {/* Metric Comparison Cards */}
          <Divider label={`${personLabel} Metrics`} icon={<Users size={15} strokeWidth={2} />} />
          <div className="responsive-grid-3" style={{ gap: 14, marginBottom: 8 }}>
            {metricKeys.map((mk, idx) => {
              const m = personData.metrics[mk];
              const meta = PERSON_METRICS[mk];
              const accentColor = METRIC_COLORS[idx % METRIC_COLORS.length];
              const displayColor = mk === 'reworkRate' ? personRateColor(1 - (m?.currVal ?? 0))
                : mk === 'deliveryRate' ? personRateColor(m?.currVal ?? 0)
                : accentColor;
              return (
                <div key={mk} style={{ ...CARD, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accentColor }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                      <span style={{ marginRight: 5 }}>{meta?.icon}</span>{meta?.label}
                    </div>
                    <TrendArrow improved={m?.improved} delta={m?.delta} metricKey={mk} formatter={fmtPerson} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: displayColor, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                      {fmtPerson(mk, m?.currVal)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      was {fmtPerson(mk, m?.prevVal)}
                    </span>
                  </div>
                  {/* Description */}
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                    {meta?.lower_better ? 'lower is better' : 'higher is better'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Historical Trend Chart */}
          {personData.historicalData.length > 1 && (
            <>
              <Divider label="Monthly Trend" icon={<TrendingUp size={15} strokeWidth={2} />} />
              <div style={{ ...CARD, padding: '20px', marginBottom: 8 }}>
                {metricKeys.length > 1 && (
                  <div style={{ marginBottom: 16 }}>
                    <PillSelector
                      options={metricKeys.map(k => ({ id: k, label: PERSON_METRICS[k]?.label }))}
                      value={activeChartMetric}
                      onChange={setChartMetric}
                    />
                  </div>
                )}
                <div role="img" aria-label={`${personName} historical trend chart`}>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={personData.historicalData}>
                      <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--muted)', fontWeight: 600 }} />
                      <YAxis
                        tick={{ fontSize: 11, fill: 'var(--muted)' }}
                        tickFormatter={v => fmtPerson(activeChartMetric, v)}
                      />
                      <Tooltip
                        formatter={(v) => fmtPerson(activeChartMetric, v)}
                        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey={activeChartMetric}
                        name={PERSON_METRICS[activeChartMetric]?.label}
                        stroke="var(--accent)"
                        strokeWidth={3}
                        dot={{ r: 5, fill: 'var(--accent)' }}
                        activeDot={{ r: 7 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}

          {/* Historical Data Table */}
          {personData.historicalData.length > 1 && (
            <>
              <Divider label="Period Detail" icon={<Clock size={15} strokeWidth={2} />} />
              <div style={{ ...CARD, overflow: 'auto', marginBottom: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Metric</th>
                      {personData.historicalData.map(p => (
                        <th key={p.period} style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 10 }}>
                          {p.period}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metricKeys.map(mk => {
                      const meta = PERSON_METRICS[mk];
                      return (
                        <tr key={mk} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                            <span style={{ marginRight: 5 }}>{meta?.icon}</span>{meta?.label}
                          </td>
                          {personData.historicalData.map((entry, i) => {
                            const value = entry[mk];
                            const prevVal = i > 0 ? personData.historicalData[i - 1][mk] : null;
                            const delta = (value != null && prevVal != null) ? value - prevVal : null;
                            const improved = delta != null && delta !== 0
                              ? (meta?.lower_better ? delta < 0 : delta > 0) : null;
                            return (
                              <td key={entry.period} style={{ padding: '8px', textAlign: 'center' }}>
                                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>
                                  {fmtPerson(mk, value)}
                                </div>
                                {i > 0 && <TrendArrow improved={improved} delta={delta} metricKey={mk} formatter={fmtPerson} />}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Work Items per Period */}
          {personData.historicalData.slice().reverse().map(period => (
            <div key={period.period}>
              <Divider label={`${period.period} — Work Items (${period.workItems.length})`} icon={<Clock size={15} strokeWidth={2} />} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
                {fmtDate(period.start)} — {fmtDate(period.end)}
              </div>
              {period.workItems.length > 0 ? (
                <WorkItemsTable
                  items={period.workItems}
                  onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)}
                  onParentClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)}
                  showParent
                />
              ) : (
                <div style={{ ...CARD, padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>
                  No work items for {personName} in this period
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
