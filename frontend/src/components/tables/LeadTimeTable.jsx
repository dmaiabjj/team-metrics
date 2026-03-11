export default function LeadTimeTable({ items, onWorkItemClick }) {
  if (!items?.length) return null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Start Date</th>
            <th>Finish Date</th>
            <th style={{ textAlign: 'right' }}>Lead Time</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id || i}>
              <td>
                {item.id ? (
                  <span className="tbl-link wi-id" onClick={() => onWorkItemClick?.(item.id)}>#{item.id}</span>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>—</span>
                )}
              </td>
              <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.title}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                {item.start_date ? new Date(item.start_date).toLocaleDateString() : '—'}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                {item.finish_date ? new Date(item.finish_date).toLocaleDateString() : '—'}
              </td>
              <td style={{ textAlign: 'right', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                {item.delivery_days != null ? `${item.delivery_days}d` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
