import { useState } from 'react';
import StatusBadge from '../shared/StatusBadge';

function ReworkRow({ wi, onWorkItemClick }) {
  const [expanded, setExpanded] = useState(false);
  const hasBugs = wi.child_bugs?.length > 0;
  const hadRework = wi.has_rework || wi.bounces > 0;
  const canExpand = hasBugs || (wi.bounce_details?.length > 0);

  return (
    <>
      <tr style={hadRework ? { background: '#ef444408' } : {}}>
        <td style={{ width: 30, textAlign: 'center' }}>
          {canExpand ? (
            <span style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
              onClick={() => setExpanded(!expanded)}>
              {expanded ? '▼' : '▶'}
            </span>
          ) : null}
        </td>
        <td style={{ width: 30, textAlign: 'center' }}>
          {hadRework ? <span style={{ color: '#ef4444' }}>↩</span> : <span style={{ color: '#10b981' }}>✓</span>}
        </td>
        <td className="tbl-link wi-id" onClick={() => onWorkItemClick?.(wi.id)}>#{wi.id}</td>
        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wi.title}</td>
        <td><span className="badge badge-neutral">{wi.work_item_type}</span></td>
        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{wi.developer || '—'}</td>
        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{wi.qa || '—'}</td>
        <td><StatusBadge status={wi.canonical_status} /></td>
        <td style={{ textAlign: 'center' }}>
          {wi.bounces > 0
            ? <span style={{ fontWeight: 800, color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{wi.bounces}</span>
            : <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>0</span>
          }
        </td>
        <td style={{ textAlign: 'center' }}>
          {hasBugs
            ? <span style={{ fontWeight: 800, color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: 12 }}>🐛 {wi.child_bugs.length}</span>
            : <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>0</span>
          }
        </td>
      </tr>
      {expanded && canExpand && (
        <tr>
          <td colSpan={10} style={{ padding: 0 }}>
            <div style={{ background: 'var(--surface2)', borderTop: '1px solid var(--border)', padding: '10px 20px' }}>
              {wi.bounce_details?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Rework Bounces ({wi.bounces})
                  </div>
                  {wi.bounce_details.map((detail, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', padding: '2px 0' }}>
                      <span style={{ color: '#ef4444' }}>↩</span>
                      <span>{detail.from_state} → {detail.to_state} ({detail.date})</span>
                    </div>
                  ))}
                </div>
              )}
              {hasBugs && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Child Bugs ({wi.child_bugs.length})
                  </div>
                  {wi.child_bugs.map(bug => (
                    <div key={bug.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                      <span style={{ color: '#ef4444' }}>🐛</span>
                      <span className="tbl-link wi-id" onClick={() => onWorkItemClick?.(bug.id)}>#{bug.id}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.title}</span>
                      {bug.state && <StatusBadge status={bug.state} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ReworkTable({ items, onWorkItemClick }) {
  if (!items?.length) {
    return <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>No work items found</div>;
  }

  const sorted = [...items].sort((a, b) => {
    const aR = a.has_rework || a.bounces > 0 ? 1 : 0;
    const bR = b.has_rework || b.bounces > 0 ? 1 : 0;
    if (bR !== aR) return bR - aR;
    return (b.bounces || 0) - (a.bounces || 0);
  });

  const reworkCount = sorted.filter(wi => wi.has_rework || wi.bounces > 0).length;
  const cleanCount = sorted.length - reworkCount;

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
        <span>↩ {reworkCount} reworked</span>
        <span>✓ {cleanCount} clean</span>
      </div>
      <div className="tbl-scroll-wrap" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 30 }}></th>
              <th style={{ width: 30 }}></th>
              <th>ID</th>
              <th>Title</th>
              <th>Type</th>
              <th>Developer</th>
              <th>QA</th>
              <th>Status</th>
              <th style={{ textAlign: 'center' }}>Bounces</th>
              <th style={{ textAlign: 'center' }}>Bugs</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(wi => (
              <ReworkRow key={wi.id} wi={wi} onWorkItemClick={onWorkItemClick} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
