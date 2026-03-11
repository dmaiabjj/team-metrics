import { useParams, useNavigate, Link } from 'react-router';
import { Activity } from 'lucide-react';
import { useDoraDetail } from '../api/hooks/useDoraMetrics';
import { useDashboard } from '../api/hooks/useDashboard';
import { usePeriod } from '../context/PeriodContext';
import {
  TEAMS, TEAM_LABELS, TEAM_COLORS, KPI_META, DORA_KEYS, DORA_LEVELS, KPI_SLUG,
} from '../lib/constants';
import { fmt, fmtDora, fmtDate, doraLevel, valFromKpis } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';

/* ── Helpers ──────────────────────────────────────────────────────────────── */
const LEVEL_RANK = { Elite: 3, High: 2, Medium: 1, Low: 0 };
const OVERALL_COLOR = { Elite: '#10b981', High: '#34d399', Medium: '#f59e0b', Low: '#ef4444' };

function computeOverall(dfLevel, ltLevel) {
  if (!dfLevel || !ltLevel) return null;
  const rank = Math.min(LEVEL_RANK[dfLevel.label] ?? 0, LEVEL_RANK[ltLevel.label] ?? 0);
  const label = ['Low', 'Medium', 'High', 'Elite'][rank];
  return { label, color: OVERALL_COLOR[label] ?? '#94a3b8' };
}

/* dora-bg #eef2ff, dora-border #c7d2fe (explicit to ensure match) */
const DORA_BG = '#eef2ff';
const DORA_BORDER = '#c7d2fe';
const DORA_CARD = {
  background: DORA_BG,
  border: `1px solid ${DORA_BORDER}`,
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function levelCardStyle(color) {
  return {
    background: `linear-gradient(135deg, ${hexToRgba(color, 0.094)} 0%, ${hexToRgba(color, 0.03)} 100%)`,
    border: `1px solid ${hexToRgba(color, 0.19)}`,
    borderRadius: 20,
    padding: '28px 32px',
    display: 'flex',
    alignItems: 'center',
    gap: 32,
    position: 'relative',
    overflow: 'hidden',
  };
}

function metricCardOuterStyle() {
  return {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 18,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s',
  };
}

/* ── Main Page ───────────────────────────────────────────────────────────── */
export default function DoraHealthPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { periodStart, periodEnd } = usePeriod();

  const { data: dfData, isLoading: dfLoading, error: dfError } = useDoraDetail(
    teamId, 'deploy-frequency', periodStart, periodEnd,
  );
  const { data: ltData, isLoading: ltLoading, error: ltError } = useDoraDetail(
    teamId, 'lead-time', periodStart, periodEnd,
  );
  const { data: dashData } = useDashboard(periodStart, periodEnd);

  const isLoading = dfLoading || ltLoading;
  const error = dfError || ltError;

  const dfKpi = dfData?.kpi || {};
  const ltKpi = ltData?.kpi || {};
  const dfValue = dfKpi.value ?? null;
  const ltValue = ltKpi.value ?? null;
  const dfLevel = doraLevel('deploy_frequency', dfValue);
  const ltLevel = doraLevel('lead_time', ltValue);
  const overall = computeOverall(dfLevel, ltLevel);
  const allTeams = dashData?.teams || [];

  return (
    <div className="page dora-page animate-fade-in" style={{ padding: 32, background: '#f8f9fb' }}>

      {/* Breadcrumb */}
      <div className="breadcrumb" style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Link to="/">Overview</Link>
        <span>/</span>
        <Link to={`/teams/${teamId}`}>{TEAM_LABELS[teamId] || teamId}</Link>
        <span>/</span>
        <Activity size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>DORA Health</span>
      </div>

      {isLoading && <Loader />}
      {error && <ErrorBox message={error.message} />}

      {!isLoading && (dfValue != null || ltValue != null) && (<>

        {/* ── TOP SUMMARY CARD ─────────────────────────────────────────────── */}
        {overall && (
          <div style={{ ...levelCardStyle(overall.color), marginBottom: 24 }}>
            <div style={{
              width: 100, height: 100, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg,${overall.color} 0%,${overall.color}dd 100%)`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 8px 28px ${overall.color}45`,
            }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{overall.label[0]}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{overall.label}</div>
            </div>
            <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: overall.color, fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                DORA PERFORMANCE — {TEAM_LABELS[teamId] || teamId}
              </div>
              <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.02em', marginBottom: 6, fontFamily: 'var(--font-head)' }}>
                {overall.label} Performer
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 520 }}>
                Based on Deployment Frequency and Lead Time for Changes benchmarks from the DORA State of DevOps research.
                {overall.label === 'Elite' && ' This team is in the top tier — shipping fast and reliably.'}
                {overall.label === 'High' && ' Strong delivery cadence with room to push toward elite.'}
                {overall.label === 'Medium' && ' Solid foundation — focus on reducing batch size and cycle time.'}
                {overall.label === 'Low' && ' Significant improvement opportunity in delivery throughput.'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, position: 'relative', zIndex: 1 }}>
              {DORA_KEYS.map(k => {
                const val = k === 'deploy_frequency' ? dfValue : ltValue;
                const lv = doraLevel(k, val);
                const c = lv?.color ?? '#94a3b8';
                return (
                  <div key={k} style={{
                    background: 'var(--surface)', borderRadius: 12, padding: '14px 18px', minWidth: 140,
                    border: `1px solid ${c}30`, cursor: 'pointer', transition: 'all 0.15s',
                  }}
                    onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[k]}`)}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 18px ${c}25`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                  >
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                      {KPI_META[k]?.icon} {KPI_META[k]?.label}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 900, color: c, letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>
                      {fmtDora(k, val)}
                    </div>
                    {lv && (
                      <div style={{ fontSize: 10, fontWeight: 800, color: c, marginTop: 4, fontFamily: 'var(--font-mono)' }}>{lv.label}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TWO METRIC CARDS ────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
          {DORA_KEYS.map(k => {
            const value = k === 'deploy_frequency' ? dfValue : ltValue;
            const kpi = k === 'deploy_frequency' ? dfKpi : ltKpi;
            const m = KPI_META[k];
            const level = doraLevel(k, value);
            const color = level?.color ?? '#94a3b8';
            const allLevels = DORA_LEVELS[k] || [];

            const gaugeMax = k === 'deploy_frequency' ? 2 : 35;
            const gaugePct = k === 'deploy_frequency'
              ? Math.min(1, (value ?? 0) / gaugeMax)
              : Math.min(1, 1 - (value ?? gaugeMax) / gaugeMax);
            const gaugeR = 52; const gaugeCX = 80;
            const gaugeCirc = 2 * Math.PI * gaugeR;
            const gaugeDash = gaugeCirc * 0.75 * gaugePct;
            const gaugeTotalArc = gaugeCirc * 0.75;

            return (
              <div
                key={k}
                onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[k]}`)}
                style={metricCardOuterStyle()}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
              >
                <div style={{
                  height: 4,
                  background: `linear-gradient(90deg, ${color}, ${hexToRgba(color, 0.376)})`,
                }} />
                <div style={{ padding: '22px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                        {m?.icon} {m?.label}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>{m?.desc}</div>
                    </div>
                    {level && (
                      <div style={{
                        background: hexToRgba(color, 0.094),
                        border: `1px solid ${hexToRgba(color, 0.25)}`,
                        borderRadius: 20,
                        padding: '5px 14px',
                        fontSize: 11,
                        fontWeight: 800,
                        color,
                        fontFamily: 'var(--font-mono)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexShrink: 0,
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                        {level.label}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 20 }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <svg width={160} height={116} style={{ overflow: 'visible', fontFamily: 'inherit' }}>
                        <circle cx={gaugeCX} cy={gaugeCX} r={gaugeR} fill="none" stroke="var(--border)" strokeWidth={12}
                          strokeDasharray={`${gaugeTotalArc} ${gaugeCirc}`} strokeLinecap="round"
                          transform={`rotate(135 ${gaugeCX} ${gaugeCX})`} />
                        <circle cx={gaugeCX} cy={gaugeCX} r={gaugeR} fill="none" stroke={color} strokeWidth={12}
                          strokeDasharray={`${gaugeDash} ${gaugeCirc}`} strokeLinecap="round"
                          transform={`rotate(135 ${gaugeCX} ${gaugeCX})`}
                          style={{ transition: 'stroke-dasharray 0.9s ease' }} />
                        <text x={gaugeCX} y={gaugeCX + 2} textAnchor="middle" fill={color}
                          fontSize={22} fontWeight={800} style={{ fontFamily: 'var(--font-head)' }}>{fmtDora(k, value)}</text>
                        <text x={gaugeCX} y={gaugeCX + 18} textAnchor="middle" fill="var(--muted)"
                          fontSize={10} style={{ fontFamily: 'var(--font-head)' }}>{k === 'deploy_frequency' ? '/day' : 'h'}</text>
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      {level && (
                        <div style={{ fontSize: 13, color: 'var(--text2)', fontStyle: 'italic', marginBottom: 12, lineHeight: 1.5 }}>
                          "{level.desc}"
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        formula: {m?.formula}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {allLevels.map((l, i) => {
                      const isThis = level?.label === l.label;
                      return (
                        <div key={i} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 12px',
                          borderRadius: 9,
                          background: isThis ? hexToRgba(l.color, 0.07) : '#f7f6fb',
                          border: `1px solid ${isThis ? hexToRgba(l.color, 0.25) : 'var(--border)'}`,
                          transition: '0.2s',
                        }}>
                          <div style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: l.color,
                            flexShrink: 0,
                            boxShadow: isThis ? `${l.color} 0 0 8px` : 'none',
                          }} />
                          <div style={{ flex: '1 1 0%', fontSize: 11, fontWeight: isThis ? 800 : 500, color: isThis ? l.color : 'var(--text2)' }}>
                            {l.label}
                          </div>
                          <div style={{ fontSize: 11, color: isThis ? 'var(--text2)' : 'var(--muted)' }}>
                            {l.desc}
                          </div>
                          {isThis && (
                            <div style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: l.color,
                              fontFamily: 'var(--font-mono)',
                              background: hexToRgba(l.color, 0.094),
                              padding: '1px 7px',
                              borderRadius: 20,
                            }}>
                              you
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {k === 'deploy_frequency' && kpi.deployment_count != null && (
                    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
                      <MiniStat value={kpi.deployment_count ?? 0} label="Total Deploys" />
                      <MiniStat value={kpi.period_days ?? 0} label="Period Days" />
                    </div>
                  )}
                  {k === 'lead_time' && kpi.lead_time_days != null && (
                    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
                      <MiniStat value={fmtDora('lead_time', kpi.lead_time_days)} label="Average" />
                      <MiniStat value={kpi.median_lead_time_days != null ? fmtDora('lead_time', kpi.median_lead_time_days) : '—'} label="Median" />
                      <MiniStat value={kpi.p90_lead_time_days != null ? fmtDora('lead_time', kpi.p90_lead_time_days) : '—'} label="P90" />
                      <MiniStat value={kpi.sample_size ?? 0} label="Sample" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {allTeams.length > 1 && (
          <CrossTeamBenchmark teams={allTeams} currentTeamId={teamId}
            currentDfValue={dfValue} currentLtValue={ltValue} />
        )}

        {/* ── ABOUT DORA ──────────────────────────────────────────────────── */}
        <div style={{ ...DORA_CARD, background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>About DORA Metrics</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p>
              DORA (DevOps Research and Assessment) metrics are the industry standard for measuring
              software delivery performance. They were identified by the DORA team at Google Cloud
              through years of research.
            </p>
            <p>
              <strong style={{ color: 'var(--text)' }}>Deployment Frequency</strong> measures how often code
              reaches production. Elite performers deploy on-demand, multiple times per day.
            </p>
            <p>
              <strong style={{ color: 'var(--text)' }}>Lead Time for Changes</strong> measures the time from
              first code commit to production deployment. Elite performers achieve sub-hour lead
              times.
            </p>
            <p style={{ opacity: 0.6, fontSize: 10, marginTop: 12 }}>
              Benchmarks based on the Accelerate State of DevOps Report. Levels: Elite → High →
              Medium → Low.
            </p>
          </div>
        </div>

      </>)}
    </div>
  );
}

/* ── MiniStat (kpi_report style) ─────────────────────────────────────────── */
function MiniStat({ value, label }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', background: '#f7f6fb', borderRadius: 8, padding: '6px 8px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

/* ── Cross-Team Benchmark ────────────────────────────────────────────────── */
function CrossTeamBenchmark({ teams, currentTeamId, currentDfValue, currentLtValue }) {
  const rows = teams.map(t => {
    const dora = t.dora || [];
    const dfVal = valFromKpis(dora, 'deploy_frequency');
    const ltVal = valFromKpis(dora, 'lead_time');
    const dfLvl = doraLevel('deploy_frequency', dfVal);
    const ltLvl = doraLevel('lead_time', ltVal);
    const rank = Math.min(LEVEL_RANK[dfLvl?.label] ?? 0, LEVEL_RANK[ltLvl?.label] ?? 0);
    const overallLabel = ['Low', 'Medium', 'High', 'Elite'][rank];
    const overallColor = OVERALL_COLOR[overallLabel] ?? '#94a3b8';
    return { id: t.team_id, label: TEAM_LABELS[t.team_id] || t.team_id, dfVal, ltVal, dfLvl, ltLvl, overallLabel, overallColor };
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 3, height: 18, background: 'var(--accent)', borderRadius: 2 }} />
        <span style={{ fontSize: 14, fontWeight: 800 }}>Cross-Team Benchmark</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>all teams this period</span>
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Team</th>
              <th>{KPI_META.deploy_frequency?.icon} Deploy Frequency</th>
              <th>{KPI_META.lead_time?.icon} Lead Time</th>
              <th>Level</th>
              <th>vs This Team</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isCurrent = r.id === currentTeamId;
              const teamColor = TEAM_COLORS[r.id] || '#7c6af7';

              const deployDiff = (!isCurrent && r.dfVal != null && currentDfValue != null) ? r.dfVal - currentDfValue : null;
              const leadDiff = (!isCurrent && r.ltVal != null && currentLtValue != null) ? r.ltVal - currentLtValue : null;

              return (
                <tr key={r.id} style={{ background: isCurrent ? 'var(--accent-soft)' : '', fontWeight: isCurrent ? 700 : 400 }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: teamColor, flexShrink: 0 }} />
                      <span style={{ color: isCurrent ? 'var(--accent)' : 'var(--text)', fontSize: 12 }}>{r.label}</span>
                      {isCurrent && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid #c4b8fd', borderRadius: 20, padding: '1px 7px', fontFamily: 'var(--font-mono)' }}>
                          you
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.dfLvl?.color ?? 'var(--muted)' }}>
                    {fmt('deploy_frequency', r.dfVal)}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.ltLvl?.color ?? 'var(--muted)' }}>
                    {fmtDora('lead_time', r.ltVal)}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                      fontSize: 10, fontWeight: 800, color: r.overallColor,
                      background: r.overallColor + '18', fontFamily: 'var(--font-mono)',
                    }}>{r.overallLabel}</span>
                  </td>
                  <td>
                    {isCurrent ? (
                      <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>baseline</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                        {deployDiff != null && (
                          <span style={{ color: deployDiff > 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                            {deployDiff > 0 ? '↑' : '↓'} {Math.abs(deployDiff).toFixed(2)}/d
                          </span>
                        )}
                        {leadDiff != null && (
                          <span style={{ color: leadDiff < 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                            {leadDiff < 0 ? '↓' : '↑'} {Math.abs(leadDiff).toFixed(1)}d
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
