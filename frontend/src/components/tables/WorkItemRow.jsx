import { useState } from 'react';
import StatusBadge from '../shared/StatusBadge';

export default function WorkItemRow({ wi, onWorkItemClick, showParent, onParentClick }) {
  const [bugsOpen, setBugsOpen] = useState(false);
  const bugs = wi.child_bugs?.length > 0 ? wi.child_bugs : [];
  const hasBugs = bugs.length > 0;

  return (
    <>
      <tr style={bugsOpen ? { background: 'var(--surface2)' } : {}}>
        <td className="tbl-link wi-id" style={{ fontSize: 12 }}
          onClick={() => onWorkItemClick?.(wi.id)}>#{wi.id}</td>
        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {wi.title}
        </td>
        <td><span className="badge badge-neutral">{wi.work_item_type}</span></td>
        {showParent && (
          <td style={{ minWidth: 140, maxWidth: 200 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
              {wi.parent_epic?.title && (
                <div
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onParentClick ? 'pointer' : 'default' }}
                  onClick={(e) => { if (onParentClick) { e.stopPropagation(); onParentClick(wi.parent_epic.id); } }}
                  title={`Epic #${wi.parent_epic.id}: ${wi.parent_epic.title}`}
                >
                  📦 <span className={onParentClick ? 'tbl-link' : ''} style={onParentClick ? { color: 'var(--accent)' } : {}}>{wi.parent_epic.title}</span>
                </div>
              )}
              {wi.parent_feature?.title && (
                <div
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: onParentClick ? 'pointer' : 'default' }}
                  onClick={(e) => { if (onParentClick) { e.stopPropagation(); onParentClick(wi.parent_feature.id); } }}
                  title={`Feature #${wi.parent_feature.id}: ${wi.parent_feature.title}`}
                >
                  → <span className={onParentClick ? 'tbl-link' : ''} style={onParentClick ? { color: 'var(--accent)' } : {}}>{wi.parent_feature.title}</span>
                </div>
              )}
            </div>
          </td>
        )}
        <td><StatusBadge status={wi.canonical_status} /></td>
        <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {wi.developer || '—'}
        </td>
        <td>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {wi.is_delivered && <span className="badge badge-good">✓ Delivered</span>}
            {wi.is_spillover && <span className="badge badge-warn">↻ Spillover</span>}
            {(wi.bounces > 0 || wi.has_rework) && <span className="badge badge-bad">↩ Rework{wi.bounces > 1 ? ` ×${wi.bounces}` : ''}</span>}
            {wi.is_technical_debt && <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>🏚 Debt</span>}
            {hasBugs && (
              <button className={`bug-expand-btn${bugsOpen ? ' open' : ''}`}
                onClick={(e) => { e.stopPropagation(); setBugsOpen(!bugsOpen); }}>
                🐛 {bugs.length}{bugsOpen ? ' ▲' : ' ▼'}
              </button>
            )}
          </div>
        </td>
      </tr>
      {bugsOpen && hasBugs && (
        <tr>
          <td colSpan={showParent ? 7 : 6} style={{ padding: 0, background: '#13101a', borderBottom: '2px solid #ef444430' }}>
            <div className="bug-panel-inner">
              <div className="bug-panel-title">🐛 Child Bugs ({bugs.length})</div>
              {bugs.map((bug, bi) => (
                <div key={bug.id || bi} className="bug-row" style={{ cursor: 'pointer' }}
                  onClick={() => onWorkItemClick?.(bug.id)}>
                  <div className="bug-row-id">#{bug.id}</div>
                  <div className="bug-row-title">{bug.title || 'Untitled'}</div>
                  <div className="bug-row-meta">
                    <StatusBadge status={bug.state || 'Active'} />
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
