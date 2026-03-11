import { Fragment } from 'react';
import { fmtDate, fmtDateTime } from '../../lib/formatters';

function groupByDate(deployments) {
  const groups = {};
  for (const d of deployments) {
    const raw = d.started_on;
    const dateKey = raw ? (typeof raw === 'string' ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10)) : 'unknown';
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(d);
  }
  return Object.entries(groups).sort(([a], [b]) => (b || '').localeCompare(a || ''));
}

export default function ReleaseHistory({ deployments, total }) {
  if (!deployments?.length) return null;

  const byDate = groupByDate(deployments);

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 18, overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 24px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ width: 3, height: 18, background: '#10b981', borderRadius: 2 }} />
          <span style={{ fontSize: 14, fontWeight: 800 }}>Release History</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 20, padding: '1px 8px', fontFamily: 'var(--font-mono)' }}>
            {total ?? deployments.length}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>production deployments this period</span>
        </div>
      </div>

      <div style={{ padding: '12px 0 0' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Release</th>
              <th>Pipeline</th>
              <th>Environment</th>
              <th>Deployed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {byDate.map(([dateKey, items]) => (
              <Fragment key={dateKey}>
                <tr style={{ background: 'var(--surface2)' }}>
                  <td colSpan={5} style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                    {dateKey === 'unknown' ? 'Unknown date' : fmtDate(dateKey)} · {items.length} {items.length === 1 ? 'deployment' : 'deployments'}
                  </td>
                </tr>
                {items.map((d, i) => (
                  <tr key={d.id ?? `${dateKey}-${i}`}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>
                          {d.release_name || `Release #${d.release_id || d.id}`}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                          #{d.id}
                        </span>
                      </div>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.definition_name || '—'}
                    </td>
                    <td>
                      {d.environment_name ? (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                          {d.environment_name}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {fmtDateTime(d.started_on)}
                    </td>
                    <td>
                      <DeployStatus status={d.status} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeployStatus({ status }) {
  const s = (status || '').toLowerCase();
  const map = {
    succeeded: { color: '#10b981', bg: '#d1fae5', label: 'Succeeded' },
    partiallysucceeded: { color: '#f59e0b', bg: '#fef3c7', label: 'Partial' },
    failed: { color: '#ef4444', bg: '#fee2e2', label: 'Failed' },
    canceled: { color: '#64748b', bg: '#f1f5f9', label: 'Canceled' },
    rejected: { color: '#ef4444', bg: '#fee2e2', label: 'Rejected' },
    notdeployed: { color: '#64748b', bg: '#f1f5f9', label: 'Not Deployed' },
  };
  const info = map[s] || { color: '#64748b', bg: '#f1f5f9', label: status || '—' };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: info.bg, color: info.color, whiteSpace: 'nowrap',
      fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {info.label}
    </span>
  );
}
