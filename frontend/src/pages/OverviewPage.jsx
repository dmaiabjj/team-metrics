import { Link } from 'react-router';
import { Activity } from 'lucide-react';
import { useDashboard } from '../api/hooks/useDashboard';
import { usePeriod } from '../context/PeriodContext';
import { TEAMS, TEAM_LABELS, TEAM_COLORS, TEAM_ICONS, KPI_KEYS, DORA_KEYS, KPI_META, DORA_LEVELS, ALL_KPI_KEYS } from '../lib/constants';
import { fmt, fmtDate, kpiColor, kpiStatus, doraLevel, valFromKpis } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';

export default function OverviewPage() {
  const { periodStart, periodEnd } = usePeriod();
  const { data, isLoading, error } = useDashboard(periodStart, periodEnd);

  // Build cross-team averages from dashboard data
  const avgKpis = {};
  if (data?.kpis) data.kpis.forEach((k) => { avgKpis[k.name] = k.value; });
  if (data?.dora) data.dora.forEach((k) => { avgKpis[k.name] = k.value; });

  // Fleet health stats
  const teams = data?.teams || [];
  const allStatuses = teams.flatMap(t => {
    const kpis = [...(t.kpis || []), ...(t.dora || [])];
    return KPI_KEYS.map(k => kpiStatus(k, valFromKpis(kpis, k)));
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
              const c = kpiColor(k, v);
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
            const goodCount = KPI_KEYS.filter(k => kpiStatus(k, valFromKpis(teamKpis, k)) === 'good').length;

            return (
              <Link
                key={team}
                to={`/teams/${team}`}
                className="card"
                style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden', textDecoration: 'none', color: 'inherit', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${color}25`; e.currentTarget.style.borderColor = color + '60'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '18px 18px 0 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 12, background: color + '20', border: `1px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{TEAM_ICONS[team]}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{TEAM_LABELS[team]}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{team}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color, letterSpacing: '-0.02em', lineHeight: 1 }}>{goodCount}/{KPI_KEYS.length}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>healthy</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {KPI_KEYS.map(k => {
                    const v = valFromKpis(teamKpis, k);
                    const c = kpiColor(k, v);
                    const s = kpiStatus(k, v);
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: s === 'good' ? '#d1fae5' : s === 'warn' ? '#fef3c7' : s === 'bad' ? '#fee2e2' : 'var(--surface2)', border: `1px solid ${c}30` }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: c }}>{fmt(k, v)}</span>
                        <span style={{ fontSize: 9, color: c, opacity: 0.8 }}>{KPI_META[k].label.split(' ').slice(-1)[0]}</span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', gap: 2, height: 5, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                  {KPI_KEYS.map(k => (
                    <div key={k} style={{ flex: 1, background: kpiColor(k, valFromKpis(teamKpis, k)), borderRadius: 1 }} title={KPI_META[k].label} />
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {DORA_KEYS.map(k => {
                    const v = valFromKpis(teamKpis, k);
                    const lv = doraLevel(k, v);
                    return (
                      <div key={k} style={{ flex: 1, background: 'var(--accent-soft)', border: '1px solid #c4b8fd', borderRadius: 9, padding: '6px 10px' }}>
                        <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Activity size={10} strokeWidth={2} />
                          {KPI_META[k].label}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 15, fontWeight: 900, color: lv?.color ?? 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{fmt(k, v)}</span>
                          {lv && <span style={{ fontSize: 9, fontWeight: 700, color: lv.color }}>{lv.label}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Link>
            );
          })}
        </div>
      </>)}
    </div>
  );
}
