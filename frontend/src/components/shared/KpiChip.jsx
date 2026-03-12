import { KPI_META } from '../../lib/constants';
import { fmt, kpiColor, kpiStatus, ragToStatus, ragColor } from '../../lib/formatters';

export default function KpiChip({ kpiKey, value, rag, onClick }) {
  const m = KPI_META[kpiKey];
  if (!m) return null;
  const color = rag ? ragColor(rag) : kpiColor(kpiKey, value);
  const status = rag ? ragToStatus(rag) : kpiStatus(kpiKey, value);
  return (
    <div className="kpi-chip" style={{ borderLeftColor: color }} onClick={onClick}>
      <div className="kpi-chip-label">{m.icon} {m.label}</div>
      <div className="kpi-chip-value" style={{ color }}>{fmt(kpiKey, value)}</div>
      <div><span className={`badge badge-${status}`}>{status === 'unknown' ? 'no data' : status}</span></div>
    </div>
  );
}
