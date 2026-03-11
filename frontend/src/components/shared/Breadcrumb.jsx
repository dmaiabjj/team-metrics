import { Link } from 'react-router';

export default function Breadcrumb({ items }) {
  return (
    <div className="breadcrumb">
      {items.map((item, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span>/</span>}
          {item.to ? (
            <Link to={item.to}>{item.label}</Link>
          ) : (
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
