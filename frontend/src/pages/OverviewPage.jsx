import { Link } from 'react-router';
import { Activity } from 'lucide-react';
import { useDashboard } from '../api/hooks/useDashboard';
import { usePeriod } from '../context/PeriodContext';
import { TEAMS, TEAM_LABELS, TEAM_COLORS, TEAM_ICONS, KPI_KEYS, DORA_KEYS, KPI_META, DORA_LEVELS, ALL_KPI_KEYS } from '../lib/constants';
import { fmt, fmtDate, kpiColor, kpiStatus, doraLevel, valFromKpis, ragFromKpis, ragToStatus, ragColor } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';

export default function OverviewPage() {
  const { periodStart, periodEnd } = usePeriod();
  const { data, isLoading, error } = useDashboard(periodStart, periodEnd);

  // Build cross-team averages from dashboard data
  const avgKpis = {};
  const avgRags = {};
  if (data?.kpis) data.kpis.forEach((k) => { avgKpis[k.name] = k.value; avgRags[k.name] = k.rag; });
  if (data?.dora) data.dora.forEach((k) => { avgKpis[k.name] = k.value; avgRags[k.name] = k.rag; });

  // Fleet health stats
  const teams = data?.teams || [];
  const allStatuses = teams.flatMap(t => {
    const kpis = [...(t.kpis || []), ...(t.dora || [])];
    return KPI_KEYS.map(k => ragToStatus(ragFromKpis(kpis, k)));
  });
  const fleetGood = allStatuses.filter(s => s === 'good').length;
  const fleetWarn = allStatuses.filter(s => s === 'warn').length;
  const fleetBad = allStatuses.filter(s => s === 'bad').length;
  const totalKPIs = teams.length * KPI_KEYS.length;
  const fleetScore = totalKPIs > 0 ? Math.round((fleetGood / totalKPIs) * 100) : null;
  const fleetColor = fleetScore == null ? '#94a3b8' : fleetScore >= 70 ? '#10b981' : fleetScore >= 45 ? '#f59e0b' : '#ef4444';

  const Divider = ({ label, icon }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 16px' }}>
      <div style={{ width: 3, height: 18, background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
      {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {isLoading && <Loader />}
      {error && <ErrorBox message={error.message} />}

      {data && !isLoading && (<>

        {/* ── FLEET HEALTH BANNER ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 20,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '24px 28px', marginBottom: 4,
          boxShadow: 'var(--shadow-sm)', overflow: 'hidden', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', right: 230, top: '50%', transform: 'translateY(-50%)',
            fontSize: 120, fontWeight: 900, color: fleetColor, opacity: 0.05,
            fontFamily: 'var(--font-head)', lineHeight: 1, pointerEvents: 'none', userSelect: 'none',
          }}>{fleetScore != null ? `${fleetScore}%` : '?'}</div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
              Organisation Health · {fmtDate(periodStart)} — {fmtDate(periodEnd)}
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: 4 }}>
              {fleetScore != null ? <><span style={{ color: fleetColor }}>{fleetScore}%</span>{' KPIs on target'}</> : 'Loading…'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 18 }}>
              Across {teams.length} teams · {totalKPIs} KPI checks this period
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { label: 'On Target', count: fleetGood, color: '#10b981', bg: '#d1fae5' },
                { label: 'At Risk', count: fleetWarn, color: '#f59e0b', bg: '#fef3c7' },
                { label: 'Off Target', count: fleetBad, color: '#ef4444', bg: '#fee2e2' },
              ].map(({ label, count, color: c, bg }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, background: bg, border: `1px solid ${c}30`, borderRadius: 20, padding: '6px 14px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: c }}>{count}</span>
                  <span style={{ fontSize: 11, color: c, fontWeight: 500 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Cross-team avg per KPI mini bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>Cross-team avg per KPI</div>
            {KPI_KEYS.map(k => {
              const v = avgKpis[k];
              const c = ragColor(avgRags[k]);
              const pct = v != null ? Math.min(100, Math.round(
                k === 'flow_hygiene' ? Math.max(0, (1 - v / 2) * 100) :
                  KPI_META[k].lower_better ? Math.max(0, (1 - v) * 100) : v * 100
              )) : 0;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 110, fontSize: 10, color: 'var(--muted)', fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{KPI_META[k].label}</div>
                  <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ width: 38, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: c, flexShrink: 0 }}>{fmt(k, v)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── DORA FLEET OVERVIEW ── */}
        <Divider label="DORA Fleet Overview" icon={<Activity size={16} strokeWidth={2} />} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 4 }}>
          {DORA_KEYS.map(k => {
            const avgVal = avgKpis[k];
            const avgLv = doraLevel(k, avgVal);
            const avgColor = avgLv?.color ?? '#94a3b8';
            const allLevels = DORA_LEVELS[k] || [];
            const activeIdx = allLevels.findIndex(l => l.label === avgLv?.label);
            return (
              <div key={k} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${avgColor},${avgColor}60)` }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                      {KPI_META[k].icon} {KPI_META[k].label} · Fleet Avg
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 900, color: avgColor, letterSpacing: '-0.03em', lineHeight: 1 }}>{fmt(k, avgVal)}</div>
                  </div>
                  {avgLv && <div style={{ background: avgColor + '18', border: `1px solid ${avgColor}40`, borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 800, color: avgColor, fontFamily: 'var(--font-mono)' }}>{avgLv.label}</div>}
                </div>
                <div style={{ display: 'flex', gap: 3, height: 4, borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
                  {allLevels.map((l, li) => (
                    <div key={li} style={{ flex: 1, background: l.color, opacity: activeIdx === li ? 1 : 0.2, borderRadius: 2 }} />
                  ))}
                </div>
                {teams.map(teamEntry => {
                  const t = teamEntry.team_id;
                  const v = valFromKpis([...(teamEntry.kpis || []), ...(teamEntry.dora || [])], k);
                  const lv = doraLevel(k, v);
                  const max = k === 'deploy_frequency' ? 2 : 14;
                  const pct = k === 'deploy_frequency'
                    ? Math.min(100, ((v ?? 0) / max) * 100)
                    : Math.min(100, (1 - (v ?? max) / (max * 1.2)) * 100);
                  return (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[t], flexShrink: 0 }} />
                      <div style={{ width: 130, fontSize: 11, fontWeight: 600, color: 'var(--text)', flexShrink: 0 }}>{TEAM_LABELS[t] || t}</div>
                      <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.max(3, pct)}%`, background: lv?.color ?? '#94a3b8', borderRadius: 3, transition: 'width 0.4s' }} />
                      </div>
                      <div style={{ width: 44, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: lv?.color ?? 'var(--muted)', flexShrink: 0 }}>{fmt(k, v)}</div>
                      {lv && <div style={{ width: 52, flexShrink: 0 }}><span style={{ fontSize: 9, fontWeight: 800, color: lv.color, background: lv.color + '18', padding: '1px 7px', borderRadius: 20, fontFamily: 'var(--font-mono)' }}>{lv.label}</span></div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── TEAM CARDS ── */}
        <Divider label="Teams" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          {teams.map(teamEntry => {
            const team = teamEntry.team_id;
            const teamKpis = [...(teamEntry.kpis || []), ...(teamEntry.dora || [])];
            const color = TEAM_COLORS[team];
            const goodCount = KPI_KEYS.filter(k => ragToStatus(ragFromKpis(teamKpis, k)) === 'good').length;
            const warnCount = KPI_KEYS.filter(k => ragToStatus(ragFromKpis(teamKpis, k)) === 'warn').length;
            const badCount = KPI_KEYS.length - goodCount - warnCount;
            const healthPct = Math.round((goodCount / KPI_KEYS.length) * 100);
            const healthColor = healthPct >= 70 ? 'var(--good)' : healthPct >= 45 ? 'var(--warn)' : 'var(--bad)';

            // SVG ring constants
            const ringR = 22, ringC = 2 * Math.PI * ringR;
            const ringOffset = ringC - (ringC * healthPct / 100);

            return (
              <Link
                key={team}
                to={`/teams/${team}`}
                style={{
                  display: 'block', textDecoration: 'none', color: 'inherit',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 18, overflow: 'hidden', position: 'relative',
                  boxShadow: 'var(--shadow-sm)', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = `0 12px 32px ${color}20, var(--shadow-md)`;
                  e.currentTarget.style.borderColor = color + '50';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
              >
                {/* Colored left accent */}
                <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, background: `linear-gradient(180deg, ${color}, ${color}70)`, borderRadius: '18px 0 0 18px' }} />

                <div style={{ padding: '18px 22px 18px 26px', display: 'grid', gridTemplateColumns: 'minmax(160px, 200px) 1fr auto', gap: 20, alignItems: 'center' }}>

                  {/* ── Left: identity + health ring ── */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                      <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="28" cy="28" r={ringR} fill="none" stroke="var(--border)" strokeWidth="4.5" />
                        <circle cx="28" cy="28" r={ringR} fill="none" stroke={healthColor} strokeWidth="4.5"
                          strokeDasharray={ringC} strokeDashoffset={ringOffset}
                          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
                      </svg>
                      <div style={{
                        position: 'absolute', inset: 0, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 20,
                      }}>{TEAM_ICONS[team]}</div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{TEAM_LABELS[team]}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: 18, fontWeight: 900, color: healthColor, lineHeight: 1 }}>{goodCount}<span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>/{KPI_KEYS.length}</span></span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                        {[
                          { count: goodCount, c: 'var(--good)', bg: 'var(--good-soft)' },
                          { count: warnCount, c: 'var(--warn)', bg: 'var(--warn-soft)' },
                          { count: badCount, c: 'var(--bad)', bg: 'var(--bad-soft)' },
                        ].filter(x => x.count > 0).map(({ count, c: c2, bg }, i) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 3,
                            background: bg, borderRadius: 10, padding: '2px 7px',
                          }}>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: c2 }} />
                            <span style={{ fontSize: 10, fontWeight: 800, color: c2 }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── Center: KPI grid ── */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '5px 16px' }}>
                    {KPI_KEYS.map(k => {
                      const v = valFromKpis(teamKpis, k);
                      const rag = ragFromKpis(teamKpis, k);
                      const c = ragColor(rag);
                      const pct = v != null ? Math.min(100, Math.round(
                        k === 'flow_hygiene' ? Math.max(0, (1 - v / 2) * 100) :
                          KPI_META[k].lower_better ? Math.max(0, (1 - v) * 100) : v * 100
                      )) : 0;
                      return (
                        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ fontSize: 10, flexShrink: 0, width: 12, textAlign: 'center' }}>{KPI_META[k].icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                              <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{KPI_META[k].label}</span>
                              <span style={{ fontSize: 10, fontWeight: 800, color: c, fontFamily: 'var(--font-mono)', flexShrink: 0, marginLeft: 6 }}>{fmt(k, v)}</span>
                            </div>
                            <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 2, transition: 'width 0.5s ease' }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Right: DORA metrics ── */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 6,
                    paddingLeft: 16, borderLeft: '1px solid var(--border)',
                    minWidth: 130,
                  }}>
                    {DORA_KEYS.map(k => {
                      const v = valFromKpis(teamKpis, k);
                      const lv = doraLevel(k, v);
                      return (
                        <div key={k}>
                          <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Activity size={9} strokeWidth={2.5} />
                            {KPI_META[k].label}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                            <span style={{ fontSize: 15, fontWeight: 900, color: lv?.color ?? 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{fmt(k, v)}</span>
                            {lv && <span style={{
                              fontSize: 8, fontWeight: 800, color: lv.color,
                              background: lv.color + '15', border: `1px solid ${lv.color}25`,
                              borderRadius: 10, padding: '1px 6px', fontFamily: 'var(--font-mono)',
                            }}>{lv.label}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </>)}
    </div>
  );
}
