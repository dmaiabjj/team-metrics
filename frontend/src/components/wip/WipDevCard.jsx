import { useState } from 'react';
import StatusBadge from '../shared/StatusBadge';

function seed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function WipDevCard({ person, onWorkItemClick, wipLimit = 0 }) {
  const [expanded, setExpanded] = useState(false);

  const name = person.person || 'Unassigned';
  const rawCompliance = person.compliance_pct ?? person.compliancePct ?? 0;
  const compliance = Math.min(1, Math.max(0, Number(rawCompliance) || 0));
  const compColor = compliance >= 0.8 ? '#10b981' : compliance >= 0.6 ? '#f59e0b' : '#ef4444';
  const compStatus = compliance >= 0.8 ? 'good' : compliance >= 0.6 ? 'warn' : 'bad';
  const avatarColor = `hsl(${seed(name) % 360},38%,38%)`;
  const hasItems = person.work_items?.length > 0;

  return (
    <div className="wip-dev-card" style={{ borderColor: expanded ? compColor + '40' : 'var(--border)' }}>
      <div className="wip-dev-header">
        <div className="wip-dev-avatar" style={{ background: avatarColor }}>
          {name[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div className="wip-dev-name">{name}</div>
          <div className="wip-dev-rate" style={{ color: compColor }}>
            {(compliance * 100).toFixed(0)}% compliant
          </div>
        </div>
        <span className={`badge badge-${compStatus}`}>{compStatus}</span>
        {hasItems && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none', border: '1px solid var(--border2)', borderRadius: 6,
              color: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)',
              padding: '3px 8px', cursor: 'pointer', marginLeft: 4,
            }}
          >
            {person.work_items.length} items {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>

      {(person.status_breakdown || []).map(s => {
        const limit = wipLimit > 0 ? wipLimit : 1;
        const pct = Math.min(1, (s.avg_items ?? 0) / limit);
        const barColor = pct <= 0.7 ? '#10b981' : pct <= 1.0 ? '#f59e0b' : '#ef4444';
        const overLimit = (s.avg_items ?? 0) > limit;
        return (
          <div key={s.state} className="wip-status-row">
            <div className="wip-status-label">{s.state}</div>
            <div className="wip-bar-bg">
              <div className="wip-bar-fill" style={{ width: `${Math.min(100, pct * 100)}%`, background: barColor }} />
            </div>
            <div
              className="wip-count-badge"
              style={{ color: overLimit ? '#ef4444' : 'var(--muted)' }}
              title={`Avg ${(s.avg_items ?? 0).toFixed(1)} items/day in ${s.state} (limit ${limit})${overLimit ? ' — over limit' : ''}`}
            >
              {(s.avg_items ?? 0).toFixed(1)}/{limit}{overLimit ? ' ⚠' : ''}
            </div>
          </div>
        );
      })}

      {expanded && hasItems && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Active Work Items
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
            {person.work_items.map((wi, idx) => (
              <div
                key={wi.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 0',
                  borderBottom: idx < person.work_items.length - 1 ? '1px solid var(--border)' : 'none',
                  minWidth: 0,
                }}
              >
                <span
                  onClick={() => onWorkItemClick?.(wi.id)}
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    color: 'var(--accent)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  #{wi.id}
                </span>
                <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{wi.title}</span>
                <StatusBadge status={wi.state} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
