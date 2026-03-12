import { KPI_META } from '../../lib/constants';
import { ragFromKpis, ragColor } from '../../lib/formatters';

export default function HealthStrip({ kpis, kpiKeys }) {
  if (!kpiKeys?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 2, height: 5, borderRadius: 4, overflow: 'hidden', marginTop: 10 }}>
      {kpiKeys.map((key) => {
        const rag = ragFromKpis(kpis, key);
        const color = ragColor(rag);
        return (
          <div
            key={key}
            style={{ flex: 1, background: rag != null ? color : 'var(--border)', borderRadius: 1 }}
            title={KPI_META[key]?.label || key}
          />
        );
      })}
    </div>
  );
}
