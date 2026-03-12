import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export function Divider({ label, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '28px 0 16px' }}>
      <div style={{ width: 3, height: 18, background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
      {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

export function TrendArrow({ improved, delta, metricKey, formatter }) {
  if (improved == null || delta == null || delta === 0) {
    return <span style={{ color: 'var(--muted)', fontSize: 11 }}><Minus size={11} /></span>;
  }
  const color = improved ? '#10b981' : '#ef4444';
  const Icon = improved ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color, fontWeight: 700, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
      <Icon size={12} strokeWidth={2.5} />
      {formatter(metricKey, Math.abs(delta))}
    </span>
  );
}

export function ModeTab({ active, label, icon, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 20px', borderRadius: 12, border: 'none',
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--muted)',
      fontSize: 13, fontWeight: 700, cursor: 'pointer',
      transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {icon} {label}
    </button>
  );
}

export function PillSelector({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', borderRadius: 12, padding: 3, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          padding: '7px 14px', borderRadius: 10, border: 'none',
          background: value === o.id ? 'var(--accent)' : 'transparent',
          color: value === o.id ? '#fff' : 'var(--muted)',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
        }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
