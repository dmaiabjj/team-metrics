import { useMemo, useState } from 'react';
import Avatar from './Avatar';
import StatusBadge from './StatusBadge';

function aggregateByDeveloper(items) {
  const map = new Map();
  for (const wi of items) {
    const name = wi.developer || 'Unassigned';
    if (!map.has(name)) {
      map.set(name, { name, total: 0, delivered: 0, spillover: 0, rework: 0, techDebt: 0, deliveryDaysSum: 0, deliveryDaysCount: 0, workItems: [] });
    }
    const d = map.get(name);
    d.total++;
    if (wi.canonical_status === 'Delivered') d.delivered++;
    if (wi.is_spillover) d.spillover++;
    if (wi.is_rework_item || wi.has_rework) d.rework++;
    if (wi.is_technical_debt) d.techDebt++;
    if (wi.delivery_days != null) { d.deliveryDaysSum += wi.delivery_days; d.deliveryDaysCount++; }
    d.workItems.push({ id: wi.id, title: wi.title, state: wi.canonical_status || wi.state, type: wi.work_item_type, parentEpic: wi.parent_epic || null, parentFeature: wi.parent_feature || null, isSpillover: !!wi.is_spillover, isRework: !!(wi.is_rework_item || wi.has_rework), isTechDebt: !!wi.is_technical_debt });
  }

  return Array.from(map.values())
    .map(d => ({
      ...d,
      deliveryRate: d.total > 0 ? d.delivered / d.total : 0,
      avgDeliveryDays: d.deliveryDaysCount > 0 ? d.deliveryDaysSum / d.deliveryDaysCount : null,
    }))
    .sort((a, b) => {
      if (a.name === 'Unassigned') return 1;
      if (b.name === 'Unassigned') return -1;
      return b.total - a.total;
    });
}

function buildSummaryText(dev) {
  const parts = [];
  parts.push(`Delivered ${dev.delivered} of ${dev.total} item${dev.total !== 1 ? 's' : ''}`);
  const flags = [];
  if (dev.spillover > 0) flags.push(`${dev.spillover} spillover`);
  if (dev.rework > 0) flags.push(`${dev.rework} rework`);
  if (dev.techDebt > 0) flags.push(`${dev.techDebt} tech debt`);
  if (flags.length > 0) parts.push(flags.join(', '));
  if (dev.avgDeliveryDays != null) parts.push(`avg cycle ${dev.avgDeliveryDays.toFixed(1)}d`);
  return parts.join('. ') + '.';
}

function StatPill({ value, label, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
      <span style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</span>
    </div>
  );
}

function DeveloperCard({ dev, onWorkItemClick }) {
  const [expanded, setExpanded] = useState(true);
  const rateColor = dev.deliveryRate >= 0.85 ? 'var(--good)' : dev.deliveryRate >= 0.6 ? 'var(--warn)' : 'var(--bad)';
  const ratePct = Math.round(dev.deliveryRate * 100);
  const hasItems = dev.workItems.length > 0;

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--shadow-sm)',
      transition: 'all 0.15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = ''; }}
    >
      {/* Header: avatar + name + expand button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Avatar name={dev.name !== 'Unassigned' ? dev.name : null} size={34} />
        {dev.name === 'Unassigned' && (
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--muted)', flexShrink: 0 }}>?</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dev.name}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
            {dev.total} item{dev.total !== 1 ? 's' : ''}
          </div>
        </div>
        {hasItems && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--muted)', fontSize: 10, fontFamily: 'var(--font-mono)',
              padding: '3px 8px', cursor: 'pointer', flexShrink: 0,
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >
            {dev.workItems.length} items {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>

      {/* Text summary */}
      <div style={{
        fontSize: 11, color: 'var(--text2, var(--muted))', lineHeight: 1.5,
        marginBottom: 12, padding: '6px 8px',
        background: 'var(--surface2)', borderRadius: 8,
        borderLeft: `3px solid ${rateColor}`,
      }}>
        {buildSummaryText(dev)}
      </div>

      {/* Stat pills */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between', marginBottom: 12, padding: '8px 6px', background: 'var(--surface2)', borderRadius: 10 }}>
        <StatPill value={dev.delivered} label="Delivered" color="var(--good)" />
        <StatPill value={dev.spillover} label="Spillover" color={dev.spillover > 0 ? 'var(--warn)' : 'var(--muted)'} />
        <StatPill value={dev.rework} label="Rework" color={dev.rework > 0 ? 'var(--bad)' : 'var(--muted)'} />
        {dev.techDebt > 0 && <StatPill value={dev.techDebt} label="Debt" color="var(--accent)" />}
      </div>

      {/* Delivery rate bar */}
      <div style={{ marginBottom: dev.avgDeliveryDays != null ? 8 : 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Delivery Rate</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: rateColor, fontFamily: 'var(--font-mono)' }}>{ratePct}%</span>
        </div>
        <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${ratePct}%`, background: rateColor, borderRadius: 2, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Avg cycle time */}
      {dev.avgDeliveryDays != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg Cycle Time</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{dev.avgDeliveryDays.toFixed(1)}d</span>
        </div>
      )}

      {/* Expanded work items list */}
      {expanded && hasItems && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
            Work Items
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
            {dev.workItems.map((wi, idx) => (
              <div
                key={wi.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 0',
                  borderBottom: idx < dev.workItems.length - 1 ? '1px solid var(--border)' : 'none',
                  minWidth: 0,
                }}
              >
                <span
                  onClick={() => onWorkItemClick?.(wi.id)}
                  style={{
                    flexShrink: 0, fontSize: 11, fontFamily: 'var(--font-mono)',
                    fontWeight: 600, color: 'var(--accent)', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                >
                  #{wi.id}
                </span>
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                    {wi.title}
                  </div>
                  {wi.parentEpic && (
                    <div style={{ fontSize: 9, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                      <span style={{ opacity: 0.6 }}>Epic:</span>{' '}
                      <span
                        style={{ color: 'var(--accent)', cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); onWorkItemClick?.(wi.parentEpic.id); }}
                        onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                        onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                      >
                        {wi.parentEpic.title}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  <StatusBadge status={wi.state} />
                  {wi.isSpillover && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: '#f59e0b18', color: '#f59e0b', whiteSpace: 'nowrap' }}>Spillover</span>}
                  {wi.isRework && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: '#ef444418', color: '#ef4444', whiteSpace: 'nowrap' }}>Rework</span>}
                  {wi.isTechDebt && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: '#8b5cf618', color: '#8b5cf6', whiteSpace: 'nowrap' }}>Debt</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DeveloperSummary({ items, onWorkItemClick }) {
  const devs = useMemo(() => aggregateByDeveloper(items || []), [items]);

  if (!devs.length) return null;

  return (
    <div style={{ marginTop: 24 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 3, height: 18, background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Developer Summary</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{devs.length} contributor{devs.length !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      {/* Developer cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        {devs.map(dev => <DeveloperCard key={dev.name} dev={dev} onWorkItemClick={onWorkItemClick} />)}
      </div>
    </div>
  );
}
