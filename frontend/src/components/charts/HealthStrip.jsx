import { KPI_META } from '../../lib/constants';
import { kpiColor, valFromKpis } from '../../lib/formatters';

export default function HealthStrip({ kpis, kpiKeys }) {
  if (!kpiKeys?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 2, height: 5, borderRadius: 4, overflow: 'hidden', marginTop: 10 }}>
      {kpiKeys.map((key) => {
        const value = valFromKpis(kpis, key);
        const color = kpiColor(key, value);
        return (
          <div
            key={key}
            style={{ flex: 1, background: value != null ? color : 'var(--border)', borderRadius: 1 }}
            title={KPI_META[key]?.label || key}
          />
        );
      })}
    </div>
  );
}
