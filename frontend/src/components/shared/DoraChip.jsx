import { KPI_META } from '../../lib/constants';
import { fmt, doraLevel } from '../../lib/formatters';

export default function DoraChip({ kpiKey, value, onClick }) {
  const m = KPI_META[kpiKey];
  if (!m) return null;
  const level = doraLevel(kpiKey, value);
  const color = level?.color ?? '#64748b';
  return (
    <div className="kpi-chip" style={{ borderLeftColor: color, background: 'var(--accent-soft)' }} onClick={onClick}>
      <div className="kpi-chip-label" style={{ color: 'var(--accent)' }}>{m.icon} {m.label}</div>
      <div className="kpi-chip-value" style={{ color, fontSize: 20 }}>{fmt(kpiKey, value)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {level && <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', background: color + '22', color }}>{level.label}</span>}
      </div>
    </div>
  );
}
