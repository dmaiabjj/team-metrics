import { useParams, useNavigate, Link } from 'react-router';
import { useTeamKpis } from '../api/hooks/useTeamKpis';
import { useWorkItems } from '../api/hooks/useWorkItems';
import { usePeriod } from '../context/PeriodContext';
import { TEAM_LABELS, TEAM_ICONS, TEAM_COLORS, KPI_KEYS, DORA_KEYS, KPI_META, KPI_SLUG, DORA_LEVELS } from '../lib/constants';
import { Activity } from 'lucide-react';
import { fmt, fmtDate, kpiColor, kpiStatus, valFromKpis, ragFromKpis, ragToStatus, ragColor, doraLevel } from '../lib/formatters';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';
import Breadcrumb from '../components/shared/Breadcrumb';
import WorkItemsTable from '../components/tables/WorkItemsTable';
import DeveloperSummary from '../components/shared/DeveloperSummary';

const KPI_CATEGORIES = [
  { id: 'quality',     label: 'System Quality & Stability',                    shortLabel: 'Quality',     icon: '🔬', color: '#ef4444', bg: '#fee2e2', keys: ['rework_rate'] },
  { id: 'delivery',    label: 'Flow & Delivery Health',                        shortLabel: 'Delivery',    icon: '🚦', color: '#6366f1', bg: '#e0e7ff', keys: ['delivery_predictability', 'wip_discipline', 'flow_hygiene'] },
  { id: 'strategic',   label: 'Strategic Investment & Alignment',                shortLabel: 'Strategic',   icon: '🏛', color: '#f59e0b', bg: '#fef3c7', keys: ['tech_debt_ratio', 'initiative_delivery'] },
  { id: 'reliability', label: 'Operational Excellence & Reliability Culture',  shortLabel: 'Reliability', icon: '🛡', color: '#06b6d4', bg: '#cffafe', keys: ['reliability_action_delivery'] },
];

const KPI_TO_CATEGORY = Object.fromEntries(KPI_CATEGORIES.flatMap(c => c.keys.map(k => [k, c])));

/* ── KPI Hero Card (reference-matched) ──────────────────────────────────── */
function KpiHeroCard({ kpiKey, value, rag, onClick }) {
  const m = KPI_META[kpiKey];
  if (!m) return null;
  const color = rag ? ragColor(rag) : kpiColor(kpiKey, value);
  const status = rag ? ragToStatus(rag) : kpiStatus(kpiKey, value);
  const statusBg = { good: '#d1fae5', warn: '#fef3c7', bad: '#fee2e2', unknown: 'var(--surface3)' }[status] ?? 'var(--surface3)';

  // Normalised progress bar width
  const pct = value == null ? 0 : Math.min(100, Math.round(
    kpiKey === 'flow_hygiene' ? Math.max(0, (1 - value / 2) * 100) :
      m.lower_better ? Math.max(0, (1 - value) * 100) : value * 100
  ));

  // Target text
  const targetText = m.unit === '%'
    ? (m.lower_better ? `target ≤ ${(m.thresholds.good * 100).toFixed(0)}%` : `target ≥ ${(m.thresholds.good * 100).toFixed(0)}%`)
    : m.unit === '/d'
      ? `target ≥ ${m.thresholds.good}${m.unit}`
      : m.unit === 'd'
        ? `target ≤ ${m.thresholds.good}${m.unit}`
        : (m.lower_better ? `target ≤ ${m.thresholds.good}` : `target ≥ ${m.thresholds.good}`);

  return (
    <div onClick={onClick} style={{
      flex: 1, minWidth: 0, background: 'var(--surface)',
      border: `1px solid ${color}30`, borderRadius: 14,
      padding: '16px 18px', cursor: 'pointer',
      transition: 'all 0.15s', position: 'relative', overflow: 'hidden',
      boxShadow: `0 2px 8px ${color}12`,
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 18px ${color}25`; e.currentTarget.style.borderColor = color + '60'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 2px 8px ${color}12`; e.currentTarget.style.borderColor = color + '30'; }}
    >
      {/* Left accent bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: color, borderRadius: '14px 0 0 14px' }} />
      <div style={{ paddingLeft: 6 }}>
        {/* Header row: label + status badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2, var(--muted))', letterSpacing: '0.02em' }}>{m.icon} {m.label}</div>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 20, background: statusBg, color,
          }}>{status === 'unknown' ? '—' : status}</div>
        </div>
        {/* Big value */}
        <div style={{ fontSize: 28, fontWeight: 900, color, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 8 }}>{fmt(kpiKey, value)}</div>
        {/* Progress bar */}
        <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
        </div>
        {/* Target */}
        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{targetText}</div>
      </div>
    </div>
  );
}

/* ── Section Header ───────────────────────────────────────────────────── */
function SecHeader({ icon, title, sub, action }) {
  return (
    <div className="section-head">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
        <div>
          <div className="section-title">{title}</div>
          {sub && <div className="section-sub">{sub}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

export default function TeamPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { periodStart, periodEnd } = usePeriod();

  const { data, isLoading, error } = useTeamKpis(teamId, periodStart, periodEnd);
  const { data: wiData, isLoading: wiLoading } = useWorkItems(teamId, periodStart, periodEnd, { limit: 6 });
  const { data: allWiData } = useWorkItems(teamId, periodStart, periodEnd, { limit: 500 });

  const allKpis = [...(data?.kpis || []), ...(data?.dora || [])];
  const snap = data?.delivery_snapshot;
  const teamColor = TEAM_COLORS[teamId] || '#7c6af7';
  const teamLabel = TEAM_LABELS[teamId] || teamId;

  /* Health ring: count good / warn / bad KPIs */
  const goodCount = KPI_KEYS.filter(k => ragToStatus(ragFromKpis(allKpis, k)) === 'good').length;
  const warnCount = KPI_KEYS.filter(k => ragToStatus(ragFromKpis(allKpis, k)) === 'warn').length;
  const badCount  = KPI_KEYS.filter(k => ragToStatus(ragFromKpis(allKpis, k)) === 'bad').length;
  const healthPct = KPI_KEYS.length > 0 ? Math.round((goodCount / KPI_KEYS.length) * 100) : null;
  const healthColor = healthPct == null ? '#94a3b8' : healthPct >= 70 ? '#10b981' : healthPct >= 45 ? '#f59e0b' : '#ef4444';
  const circ = 2 * Math.PI * 22;

  return (
    <div style={{ padding: 32 }} className="animate-fade-in">
      <Breadcrumb items={[
        { label: 'Overview', to: '/' },
        { label: teamLabel },
      ]} />

      {/* ── Team Banner (reference-matched: left color bar, icon box, health ring with legend) */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20,
        overflow: 'hidden', boxShadow: 'var(--shadow-sm)', marginBottom: 28,
      }}>
        {/* Row 1: team name + health ring */}
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ width: 6, background: teamColor, flexShrink: 0 }} />
          <div style={{ flex: 1, padding: '20px 24px 20px 18px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            {/* Team icon + name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 16,
                background: teamColor + '20', border: `2px solid ${teamColor}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, flexShrink: 0,
              }}>{TEAM_ICONS[teamId]}</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--text)' }}>{teamLabel}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{teamId} · {fmtDate(periodStart)} — {fmtDate(periodEnd)}</div>
              </div>
            </div>

            {/* Health ring + KPI Health legend (right-aligned) */}
            {data && !isLoading && healthPct != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                  <svg width={56} height={56} style={{ position: 'absolute', top: 0, left: 0 }}>
                    <circle cx={28} cy={28} r={22} fill="none" stroke="var(--border)" strokeWidth={5} />
                    <circle cx={28} cy={28} r={22} fill="none" stroke={healthColor} strokeWidth={5}
                      strokeDasharray={`${circ * healthPct / 100} ${circ}`}
                      strokeLinecap="round" transform="rotate(-90 28 28)"
                      style={{ transition: 'stroke-dasharray 0.6s ease' }} />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 900, color: healthColor }}>{healthPct}%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>KPI Health</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[{ c: '#10b981', n: goodCount, l: 'good' }, { c: '#f59e0b', n: warnCount, l: 'warn' }, { c: '#ef4444', n: badCount, l: 'bad' }].map(({ c, n, l }) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: c }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: c }}>{n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: KPI Status Strip (colored bars + values) */}
        {data && !isLoading && (
          <div style={{
            padding: '12px 22px 16px 28px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface2)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
              KPI Status Strip
            </div>
            <div style={{ display: 'flex', gap: 4, height: 10, borderRadius: 6, overflow: 'hidden', marginBottom: 6 }}>
              {KPI_KEYS.map(k => (
                <div key={k} title={KPI_META[k]?.label}
                  style={{ flex: 1, background: ragColor(ragFromKpis(allKpis, k)), borderRadius: 2, cursor: 'pointer' }}
                  onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[k]}`)} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {KPI_KEYS.map(k => {
                const v = valFromKpis(allKpis, k);
                const c = ragColor(ragFromKpis(allKpis, k));
                const cat = KPI_TO_CATEGORY[k];
                return (
                  <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, cursor: 'pointer' }}
                    onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[k]}`)}>
                    <span style={{ fontSize: 9, color: 'var(--muted)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                      {cat?.shortLabel ?? KPI_META[k]?.label.split(' ')[0]}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: c, fontFamily: 'var(--font-mono)' }}>{fmt(k, v)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isLoading && <Loader />}
      {error && <ErrorBox message={error.message} />}

      {data && !isLoading && (
        <>
          {/* ── KPIs Card ────────────────────────────────────────────── */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', marginBottom: 28 }}>
            <SecHeader icon="📊" title="KPIs" sub="click any card to drill down" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {KPI_CATEGORIES.map(cat => (
                <div key={cat.id}>
                  {/* Category header (reference-matched: icon box, colored text, divider, count badge) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ width: 22, height: 22, borderRadius: 6, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{cat.icon}</div>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: cat.color }}>{cat.label}</span>
                    <div style={{ flex: 1, height: 1, background: cat.color + '20' }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: cat.color, background: cat.bg, borderRadius: 20, padding: '1px 8px', fontFamily: 'var(--font-mono)' }}>{cat.keys.length}×</span>
                  </div>
                  {/* KPI cards in a flex row */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    {cat.keys.map(k => (
                      <KpiHeroCard
                        key={k}
                        kpiKey={k}
                        value={valFromKpis(allKpis, k)}
                        rag={ragFromKpis(allKpis, k)}
                        onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[k]}`)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── DORA Section ─────────────────────────────────────────── */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', marginBottom: 28 }}>
            <SecHeader
              icon={<Activity size={18} strokeWidth={2} />}
              title="DORA Metrics"
              sub="DevOps Research & Assessment benchmarks"
              action={
                <Link to={`/teams/${teamId}/dora`} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  color: 'var(--accent)', fontSize: 11, fontFamily: 'var(--font-mono)',
                  fontWeight: 600, padding: '5px 12px', letterSpacing: '0.04em',
                  textDecoration: 'none', transition: 'background .15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Health Check →
                </Link>
              }
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {DORA_KEYS.map(k => {
                const v = valFromKpis(allKpis, k);
                const level = doraLevel(k, v);
                const c = level?.color ?? '#64748b';
                const levels = DORA_LEVELS[k] || [];
                const m = KPI_META[k];
                const borderColor = c + '30';
                const topBorderColor = c + '50';
                return (
                  <div key={k}
                    onClick={() => navigate(`/teams/${teamId}/kpis/${KPI_SLUG[k]}`)}
                    style={{
                      background: `linear-gradient(135deg, ${c}08 0%, var(--surface2) 100%)`,
                      border: `1px solid ${borderColor}`,
                      borderTop: `3px solid ${topBorderColor}`,
                      borderRadius: 14,
                      padding: '18px 20px',
                      cursor: 'pointer',
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        {m?.icon} {m?.label}
                      </div>
                      {level && (
                        <span style={{ background: c + '22', color: c, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99 }}>
                          {level.label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 36, fontWeight: 800, color: c, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 4 }}>
                      {fmt(k, v)}
                    </div>
                    {level?.desc && (
                      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, marginBottom: 10 }}>
                        {level.desc}
                      </div>
                    )}
                    {/* Mini level spectrum */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 2, height: 4, borderRadius: 2, overflow: 'hidden' }}>
                        {levels.map((l, i) => (
                          <div key={i} style={{
                            flex: 1, background: l.color, borderRadius: 2,
                            opacity: level?.label === l.label ? 1 : 0.2,
                          }} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 2 }}>
                        {levels.map((l, i) => (
                          <div key={i} style={{ flex: 1, fontSize: 9, color: l.color, fontWeight: level?.label === l.label ? 700 : 500, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {l.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Delivery Snapshot (reference-matched: icon badges, colored hover, view links) */}
          {snap && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', marginBottom: 28 }}>
              <SecHeader icon="📦" title="Delivery Snapshot" sub="click a stat to filter work items" />
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { label: 'Delivered',           val: snap.delivered,          filter: 'delivered',           color: '#10b981', bg: '#d1fae5', icon: '✓' },
                  { label: 'Committed',           val: snap.committed,          filter: 'committed',          color: '#6366f1', bg: '#e0e7ff', icon: '🎯' },
                  { label: 'Spillovers',          val: snap.spillovers,         filter: 'spillover',          color: '#f59e0b', bg: '#fef3c7', icon: '📤' },
                  { label: 'Committed in Period', val: snap.committed_in_period, filter: 'committed_in_period', color: '#06b6d4', bg: '#cffafe', icon: '📅' },
                  { label: 'Rework Items', val: snap.rework_items,  filter: 'rework',     color: '#ef4444', bg: '#fee2e2', icon: '↩' },
                  { label: 'Tech Debt',    val: snap.tech_debts,    filter: 'techdebt',   color: '#8b5cf6', bg: '#ede9fe', icon: '🏚' },
                  { label: 'Bugs',         val: snap.bugs,          filter: 'bugs',       color: '#ef4444', bg: '#fee2e2', icon: '🐛' },
                ].map(({ label, val, filter, color: c, bg, icon }) => (
                  <div key={filter} onClick={() => navigate(`/teams/${teamId}/work-items?filter=${filter}`)} style={{
                    flex: '1 1 120px', background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 14, padding: '16px 18px', cursor: 'pointer', transition: 'all 0.15s', position: 'relative',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = bg; e.currentTarget.style.borderColor = c + '60'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = ''; }}
                  >
                    <div style={{ position: 'absolute', top: 12, right: 14, width: 28, height: 28, borderRadius: 8, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{icon}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, color: c, letterSpacing: '-0.03em', lineHeight: 1 }}>{val ?? 0}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: 9, color: c, marginTop: 3, fontFamily: 'var(--font-mono)' }}>↗ view</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Work Items Preview ─────────────────────────────────────── */}
      <div style={{ marginTop: 8 }}>
        <SecHeader
          icon="📋"
          title="Recent Work Items"
          sub="latest items in this period"
          action={
            <Link to={`/teams/${teamId}/work-items`} style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)',
              fontWeight: 600, padding: '5px 12px', textDecoration: 'none',
              transition: 'all .15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--surface2)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.background = 'transparent'; }}
            >
              View All →
            </Link>
          }
        />
        {wiLoading && <Loader />}
        {wiData?.items && wiData.items.length > 0 && (
          <WorkItemsTable
            items={wiData.items.slice(0, 6)}
            onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)}
            onParentClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)}
            showParent
          />
        )}
      </div>

      {/* ── Developer Summary ─────────────────────────────────────── */}
      {allWiData?.items && allWiData.items.length > 0 && (
        <DeveloperSummary items={allWiData.items} onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)} />
      )}
    </div>
  );
}
