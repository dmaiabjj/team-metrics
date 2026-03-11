export default function StatBox({ value, label, clickable, onClick, color }) {
  return (
    <div
      className="stat-box"
      onClick={clickable ? onClick : undefined}
      style={clickable ? { cursor: 'pointer' } : undefined}
    >
      <div className="stat-box-val" style={color ? { color } : undefined}>
        {value ?? '—'}
      </div>
      <div className="stat-box-label">{label}</div>
    </div>
  );
}
