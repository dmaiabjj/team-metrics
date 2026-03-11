import { DORA_LEVELS } from '../../lib/constants';
import { doraLevel } from '../../lib/formatters';

export default function DoraLevelBar({ kpiKey, value }) {
  const levels = DORA_LEVELS[kpiKey] || [];
  const level = doraLevel(kpiKey, value);
  const activeIdx = levels.findIndex(l => l.label === level?.label);

  return (
    <div>
      <div style={{ display: 'flex', gap: 3, height: 4, overflow: 'hidden', borderRadius: 3 }}>
        {levels.map((l, i) => (
          <div key={i} style={{ flex: 1, background: l.color, opacity: activeIdx === i ? 1 : 0.2, borderRadius: 2 }} />
        ))}
      </div>
      <div style={{ display: 'flex', marginTop: 4 }}>
        {levels.map((l, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: activeIdx === i ? l.color : 'var(--muted)',
            fontWeight: activeIdx === i ? 800 : 400,
          }}>{l.label}</div>
        ))}
      </div>
    </div>
  );
}
