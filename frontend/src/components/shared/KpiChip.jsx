import { KPI_META } from '../../lib/constants';
import { fmt, kpiColor, kpiStatus } from '../../lib/formatters';

export default function KpiChip({ kpiKey, value, onClick }) {
  const m = KPI_META[kpiKey];
  if (!m) return null;
  const color = kpiColor(kpiKey, value);
  const status = kpiStatus(kpiKey, value);
  return (
    <div className="kpi-chip" style={{ borderLeftColor: color }} onClick={onClick}>
      <div className="kpi-chip-label">{m.icon} {m.label}</div>
      <div className="kpi-chip-value" style={{ color }}>{fmt(kpiKey, value)}</div>
      <div><span className={`badge badge-${status}`}>{status === 'unknown' ? 'no data' : status}</span></div>
    </div>
  );
}
