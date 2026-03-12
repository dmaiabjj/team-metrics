import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus, BarChart3, Clock, Users, Scale } from 'lucide-react';
import {
  useCrossTeamComparison,
  useCrossTeamHistorical,
  PERSON_METRICS,
  personColor,
  fmtPerson,
  personRateColor,
} from '../api/hooks/useCrossTeamAnalysis';
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

function TeamFilterChips({ selected, onChange }) {
  const allSelected = selected.size === TEAMS.length;
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
      <button
        onClick={() => onChange(allSelected ? new Set() : new Set(TEAMS))}
        style={{
          padding: '6px 12px', borderRadius: 10, border: 'none',
          background: allSelected ? 'var(--accent)' : 'var(--surface2)',
          color: allSelected ? '#fff' : 'var(--muted)',
          fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        All Teams
      </button>
      {TEAMS.map(t => {
        const active = selected.has(t);
        return (
          <button
            key={t}
            onClick={() => {
              const next = new Set(selected);
              if (active) next.delete(t); else next.add(t);
              onChange(next);
            }}
            style={{
              padding: '6px 12px', borderRadius: 10, border: 'none',
              background: active ? TEAM_COLORS[t] : 'var(--surface2)',
              color: active ? '#fff' : 'var(--muted)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            {!active && <div style={{ width: 6, height: 6, borderRadius: '50%', background: TEAM_COLORS[t] }} />}
            {TEAM_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

// ─── COMPARISON MODE ────────────────────────────────────────────────────────

const INTERVALS = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'custom', label: 'Custom' },
];

function personUrl(personField, person) {
  const basePath = personField === 'developer' ? '/cross-developers' : '/cross-qa';
  return `${basePath}/${encodeURIComponent(`${person.name}::${person.teamId}`)}`;
}

function ComparisonMode({ personField, personLabel, metricKeys }) {
  const navigate = useNavigate();
  const [interval, setInterval] = useState('monthly');
  const [customCurrent, setCustomCurrent] = useState({ start: '', end: '' });
  const [customPrevious, setCustomPrevious] = useState({ start: '', end: '' });
  const [appliedCustom, setAppliedCustom] = useState(null);
  const [teamFilter, setTeamFilter] = useState(() => new Set(TEAMS));
  const [chartMetric, setChartMetric] = useState(metricKeys[0]);

  const effectiveCustomCurrent = interval === 'custom' ? (appliedCustom?.current || null) : null;
  const effectiveCustomPrevious = interval === 'custom' ? (appliedCustom?.previous || null) : null;

  const { mergedData, isLoading, error, periods } = useCrossTeamComparison(
    personField, metricKeys, interval, effectiveCustomCurrent, effectiveCustomPrevious
  );

  // Filter persons by selected teams
  const filteredData = mergedData ? {
    ...mergedData,
    persons: mergedData.persons.filter(p => teamFilter.has(p.teamId)),
  } : null;

  // Recompute summary after filtering
  const summary = filteredData ? (() => {
    const primaryKey = metricKeys[0];
    const persons = filteredData.persons;
    const totalImproved = persons.filter(d => d.metrics[primaryKey]?.improved === true).length;
    const totalDeclined = persons.filter(d => d.metrics[primaryKey]?.improved === false).length;
    const totalUnchanged = persons.length - totalImproved - totalDeclined;
    return { totalImproved, totalDeclined, totalUnchanged, total: persons.length };
  })() : null;

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

      {/* Team filter */}
      <TeamFilterChips selected={teamFilter} onChange={setTeamFilter} />

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

      {isLoading && <Loader message={`Loading cross-team ${personLabel.toLowerCase()} data…`} />}
      {error && <ErrorBox message={error.message} />}

      {filteredData && summary && !isLoading && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Improved', count: summary.totalImproved, color: '#10b981', bg: '#d1fae5', Icon: TrendingUp },
              { label: 'Declined', count: summary.totalDeclined, color: '#ef4444', bg: '#fee2e2', Icon: TrendingDown },
              { label: 'Unchanged', count: summary.totalUnchanged, color: '#64748b', bg: '#f1f5f9', Icon: Minus },
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
              <span style={{ fontSize: 20, fontWeight: 900, color: '#8b5cf6' }}>{summary.total}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8b5cf6' }}>{personLabel}s</span>
            </div>
          </div>

          {/* Metric Leaderboard */}
          <Divider label={`${personLabel} Leaderboard`} icon={<Scale size={15} strokeWidth={2} />} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            {metricKeys.map(metricKey => {
              const meta = PERSON_METRICS[metricKey];
              const ranked = [...filteredData.persons]
                .filter(p => p.metrics[metricKey]?.currVal != null)
                .sort((a, b) => meta?.lower_better
                  ? (a.metrics[metricKey].currVal - b.metrics[metricKey].currVal)
                  : (b.metrics[metricKey].currVal - a.metrics[metricKey].currVal))
                .slice(0, 10);
              return (
                <div key={metricKey} style={{ ...CARD, padding: '14px 18px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: 'var(--accent)', borderRadius: '2px 0 0 2px' }} />
                  {/* Metric label */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 180px', paddingLeft: 4 }}>
                    <span style={{ fontSize: 14 }}>{meta?.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{meta?.label}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{meta?.lower_better ? '(lower)' : '(higher)'}</span>
                  </div>
                  {/* Ranked persons as pills */}
                  <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                    {ranked.map((person, idx) => {
                      const m = person.metrics[metricKey];
                      const rankColor = idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7f32' : 'var(--muted)';
                      return (
                        <div key={`${person.name}::${person.teamId}`} style={{
                          flex: '1 1 0', minWidth: 110, padding: '5px 8px',
                          background: 'var(--surface2)', borderRadius: 8, textAlign: 'center',
                          border: idx === 0 ? '1px solid #f59e0b30' : '1px solid transparent',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                          onClick={() => navigate(personUrl(personField, person))}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <span style={{ fontWeight: 900, color: rankColor }}>#{idx + 1}</span>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: TEAM_COLORS[person.teamId] }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>{person.name}</span>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                            {fmtPerson(metricKey, m?.currVal)}
                          </div>
                          <TrendArrow improved={m?.improved} delta={m?.delta} metricKey={metricKey} formatter={fmtPerson} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Person Metric Cards */}
          <Divider label={`${personLabel} Metrics`} icon={<Users size={15} strokeWidth={2} />} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14, marginBottom: 8 }}>
            {filteredData.persons.map((person, idx) => {
              const tp = person.metrics[metricKeys[0]]; // throughput is always first
              const accentColor = personColor(idx);
              const teamColor = TEAM_COLORS[person.teamId];
              return (
                <div key={`${person.name}::${person.teamId}`} style={{ ...CARD, padding: '16px 18px', position: 'relative', overflow: 'hidden', cursor: 'pointer', transition: 'all 0.15s' }}
                  onClick={() => navigate(personUrl(personField, person))}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08))'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accentColor }} />
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Avatar name={person.name} size={34} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{person.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: teamColor }} />
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{TEAM_LABELS[person.teamId]}</span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
                          {person.currTotal} items (was {person.prevTotal})
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Primary metric big number */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 26, fontWeight: 900, color: accentColor, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                      {fmtPerson(metricKeys[0], tp?.currVal)} delivered
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      was {fmtPerson(metricKeys[0], tp?.prevVal)}
                    </span>
                    <TrendArrow improved={tp?.improved} delta={tp?.delta} metricKey={metricKeys[0]} formatter={fmtPerson} />
                  </div>
                  {/* Additional metrics row (if more than 1 metric) */}
                  {metricKeys.length > 1 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {metricKeys.filter(k => k !== metricKeys[0]).map(metricKey => {
                        const m = person.metrics[metricKey];
                        const meta = PERSON_METRICS[metricKey];
                        return (
                          <div key={metricKey} style={{
                            flex: '1 1 60px', minWidth: 60, padding: '6px 8px',
                            background: 'var(--surface2)', borderRadius: 8, textAlign: 'center',
                          }}>
                            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                              {meta?.label}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                              {fmtPerson(metricKey, m?.currVal)}
                            </div>
                            <TrendArrow improved={m?.improved} delta={m?.delta} metricKey={metricKey} formatter={fmtPerson} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Comparison Table */}
          <Divider label={`${personLabel} Comparison Table`} />
          <div style={{ ...CARD, overflow: 'auto', marginBottom: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{personLabel}</th>
                  <th style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Team</th>
                  {metricKeys.map(k => (
                    <th key={k} style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {PERSON_METRICS[k]?.icon} {PERSON_METRICS[k]?.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredData.persons.map((person, idx) => (
                  <tr key={`${person.name}::${person.teamId}`} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onClick={() => navigate(personUrl(personField, person))}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                  >
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={person.name} size={24} />
                        <span>{person.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: TEAM_COLORS[person.teamId] }} />
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>{TEAM_LABELS[person.teamId]}</span>
                      </div>
                    </td>
                    {metricKeys.map(metricKey => {
                      const m = person.metrics[metricKey];
                      const color = metricKey === 'reworkRate' ? personRateColor(1 - (m?.currVal ?? 0))
                        : metricKey === 'deliveryRate' ? personRateColor(m?.currVal ?? 0)
                        : 'var(--text)';
                      return (
                        <td key={metricKey} style={{ padding: '8px', textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color }}>
                            {fmtPerson(metricKey, m?.currVal)}
                          </div>
                          <TrendArrow improved={m?.improved} delta={m?.delta} metricKey={metricKey} formatter={fmtPerson} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bar Chart */}
          <Divider label="Visual Comparison" icon={<BarChart3 size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px' }}>
            {metricKeys.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <PillSelector
                  options={metricKeys.map(k => ({ id: k, label: PERSON_METRICS[k]?.label }))}
                  value={metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0]}
                  onChange={setChartMetric}
                />
              </div>
            )}
            <div role="img" aria-label="Cross-person metrics comparison bar chart">
              <ResponsiveContainer width="100%" height={Math.max(300, filteredData.persons.length * 10)}>
                <BarChart data={filteredData.persons.slice(0, 25).map(p => {
                  const activeMk = metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0];
                  const m = p.metrics[activeMk];
                  return { name: p.name.split(' ')[0], current: m?.currVal, previous: m?.prevVal };
                })}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmtPerson(metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0], v)} />
                  <Tooltip
                    formatter={(v) => fmtPerson(metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0], v)}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  />
                  <Legend />
                  <Bar dataKey="current" name="Current" fill="var(--accent)" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="previous" name="Previous" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={20} />
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

function HistoricalTrendMode({ personField, personLabel, metricKeys }) {
  const navigate = useNavigate();
  const [granularity, setGranularity] = useState('monthly');
  const [chartMetric, setChartMetric] = useState(metricKeys[0]);
  const [teamFilter, setTeamFilter] = useState(() => new Set(TEAMS));
  const { timeSeriesData, isLoading, error, periods } = useCrossTeamHistorical(personField, metricKeys, granularity);

  // Filter by teams
  const filteredData = timeSeriesData ? {
    ...timeSeriesData,
    personsData: timeSeriesData.personsData.filter(p => teamFilter.has(p.teamId)),
    personKeys: timeSeriesData.personKeys.filter(pk => {
      const teamId = pk.split('::')[1];
      return teamFilter.has(teamId);
    }),
  } : null;

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

      {/* Team filter */}
      <TeamFilterChips selected={teamFilter} onChange={setTeamFilter} />

      {isLoading && <Loader message={`Loading historical ${personLabel.toLowerCase()} data…`} />}
      {error && <ErrorBox message={error.message} />}

      {filteredData && !isLoading && (
        <>
          {/* Person legend */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {filteredData.personsData.slice(0, 15).map((p, idx) => (
              <div key={p.key} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 10,
                background: 'var(--surface2)', border: '1px solid var(--border)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
                onClick={() => navigate(personUrl(personField, p))}
                onMouseEnter={e => { e.currentTarget.style.borderColor = personColor(idx); e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = ''; }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: personColor(idx) }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{p.name}</span>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: TEAM_COLORS[p.teamId] }} />
              </div>
            ))}
            {filteredData.personsData.length > 15 && (
              <span style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 10px' }}>
                +{filteredData.personsData.length - 15} more
              </span>
            )}
          </div>

          {/* Trend Chart */}
          <Divider label={`${personLabel} Trends`} icon={<TrendingUp size={15} strokeWidth={2} />} />
          <div style={{ ...CARD, padding: '20px', marginBottom: 8 }}>
            {metricKeys.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <PillSelector
                  options={metricKeys.map(k => ({ id: k, label: PERSON_METRICS[k]?.label }))}
                  value={metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0]}
                  onChange={setChartMetric}
                />
              </div>
            )}
            <div role="img" aria-label="Cross-person historical trends line chart">
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={filteredData.chartData?.[metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0]] || []}>
                  <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--muted)', fontWeight: 600 }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={v => fmtPerson(metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0], v)} />
                  <Tooltip
                    formatter={(v, name) => {
                      const displayName = name.includes('::') ? name.split('::')[0] : name;
                      return [fmtPerson(metricKeys.includes(chartMetric) ? chartMetric : metricKeys[0], v), displayName];
                    }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  />
                  <Legend formatter={(value) => value.includes('::') ? value.split('::')[0] : value} />
                  {filteredData.personKeys.slice(0, 10).map((pk, idx) => (
                    <Line
                      key={pk}
                      type="monotone"
                      dataKey={pk}
                      name={pk}
                      stroke={personColor(idx)}
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: personColor(idx) }}
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
          {metricKeys.map(metricKey => {
            const meta = PERSON_METRICS[metricKey];
            return (
              <div key={metricKey} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{meta?.icon}</span> {meta?.label}
                </div>
                <div style={{ ...CARD, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: 160 }} />
                      <col style={{ width: 120 }} />
                      {periods.map(p => (
                        <col key={p.label} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{personLabel}</th>
                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>Team</th>
                        {periods.map(p => (
                          <th key={p.label} style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 10 }}>
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredData.personsData.map(({ name, teamId, key: pk, metricSeries }, idx) => {
                        const series = metricSeries[metricKey] || [];
                        return (
                          <tr key={pk} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                            onClick={() => navigate(personUrl(personField, { name, teamId }))}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                          >
                            <td style={{ padding: '8px 14px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: personColor(idx), flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                              </div>
                            </td>
                            <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 5, height: 5, borderRadius: '50%', background: TEAM_COLORS[teamId], flexShrink: 0 }} />
                                <span style={{ fontSize: 10, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{TEAM_LABELS[teamId]}</span>
                              </div>
                            </td>
                            {series.map((entry, i) => {
                              const prevEntry = i > 0 ? series[i - 1] : null;
                              const delta = (entry.value != null && prevEntry?.value != null)
                                ? entry.value - prevEntry.value : null;
                              const improved = delta != null && delta !== 0
                                ? (meta?.lower_better ? delta < 0 : delta > 0) : null;
                              const color = metricKey === 'reworkRate' ? personRateColor(1 - (entry.value ?? 0))
                                : metricKey === 'deliveryRate' ? personRateColor(entry.value ?? 0)
                                : 'var(--text)';
                              return (
                                <td key={entry.period} style={{ padding: '6px 10px', textAlign: 'center' }}>
                                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, color }}>
                                    {fmtPerson(metricKey, entry.value)}
                                  </div>
                                  {i > 0 && <TrendArrow improved={improved} delta={delta} metricKey={metricKey} formatter={fmtPerson} />}
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

export default function CrossPersonAnalysisPage({
  personField,
  pageTitle,
  pageSubtitle,
  personLabel,
  breadcrumbLabel,
  metricKeys,
}) {
  const [mode, setMode] = useState('comparison');

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <Breadcrumb items={[{ label: 'Overview', to: '/' }, { label: breadcrumbLabel }]} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em' }}>{pageTitle}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{pageSubtitle}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 14, padding: 4 }}>
          <ModeTab active={mode === 'comparison'} label="Comparison" icon={<BarChart3 size={14} />} onClick={() => setMode('comparison')} />
          <ModeTab active={mode === 'historical'} label="Historical Trend" icon={<TrendingUp size={14} />} onClick={() => setMode('historical')} />
        </div>
      </div>

      {mode === 'comparison'
        ? <ComparisonMode personField={personField} personLabel={personLabel} metricKeys={metricKeys} />
        : <HistoricalTrendMode personField={personField} personLabel={personLabel} metricKeys={metricKeys} />}
    </div>
  );
}
