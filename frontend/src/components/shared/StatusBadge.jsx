export default function StatusBadge({ status }) {
  const cls = (status === 'Done' || status === 'Closed' || status === 'Resolved' || status === 'Delivered') ? 'good' : status === 'Blocked' ? 'bad' : 'warn';
  return <span className={`badge badge-${cls}`}>{status || 'Unknown'}</span>;
}
