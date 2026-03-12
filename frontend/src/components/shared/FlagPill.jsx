export default function FlagPill({ color, label }) {
  return (
    <span style={{
      background: color + '18', color, fontSize: 9, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99, lineHeight: 1.2, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
