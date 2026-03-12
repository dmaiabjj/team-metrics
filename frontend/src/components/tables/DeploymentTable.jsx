export default function DeploymentTable({ deployments }) {
  if (!deployments?.length) return null;

  return (
    <div className="tbl-scroll-wrap" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Release</th>
            <th>Definition</th>
            <th>Environment</th>
            <th>Started</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((d, i) => (
            <tr key={d.id || i}>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {d.release_name || `#${d.release_id}`}
              </td>
              <td style={{ color: 'var(--muted)' }}>{d.definition_name || d.definition_id}</td>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{d.environment_name || d.environment_id}</td>
              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                {d.started_on ? new Date(d.started_on).toLocaleString() : '—'}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)' }}>{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
