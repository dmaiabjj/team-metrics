import { useParams, useNavigate } from 'react-router';
import DOMPurify from 'dompurify';
import { useWorkItem } from '../api/hooks/useWorkItem';
import { usePeriod } from '../context/PeriodContext';
import { TEAM_LABELS } from '../lib/constants';
import { fmtDate, fmtDateTime } from '../lib/formatters';
import Avatar from '../components/shared/Avatar';
import StatusBadge from '../components/shared/StatusBadge';
import Breadcrumb from '../components/shared/Breadcrumb';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';

const card = {
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 16, boxShadow: 'var(--shadow-sm)', padding: 24, marginBottom: 18,
};
const sectionLabel = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
  color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12,
};

export default function WorkItemDetailPage() {
  const { teamId, itemId } = useParams();
  const navigate = useNavigate();
  const { periodStart, periodEnd } = usePeriod();

  const { data: wi, isLoading, error } = useWorkItem(teamId, itemId, periodStart, periodEnd);

  return (
    <div style={{ padding: 32 }} className="animate-fade-in">
      <Breadcrumb items={[
        { label: 'Overview', to: '/' },
        { label: TEAM_LABELS[teamId] || teamId, to: `/teams/${teamId}` },
        { label: 'Work Items', to: `/teams/${teamId}/work-items` },
        { label: `#${itemId}` },
      ]} />

      {isLoading && <Loader />}
      {error && <ErrorBox message={error.message} />}

      {!isLoading && !wi && !error && (
        <div style={{ textAlign: 'center', padding: '64px 0', fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Work item #{itemId} not found
        </div>
      )}

      {wi && !isLoading && (
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* ── LEFT COLUMN: Main Content ──────────────────────────── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Header card */}
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <StatusBadge status={wi.canonical_status} />
                <span style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--muted)',
                  background: 'var(--surface3)', padding: '2px 8px', borderRadius: 99,
                  fontFamily: 'var(--font-mono)',
                }}>
                  {wi.work_item_type}
                </span>
                {wi.is_spillover && <FlagPill color="#f59e0b" label="↻ Spillover" />}
                {wi.is_delivered && <FlagPill color="#10b981" label="✓ Delivered" />}
                {wi.is_technical_debt && <FlagPill color="var(--accent)" label="🏚 Tech Debt" />}
                {wi.is_admin_closed && <FlagPill color="var(--muted)" label="Admin Closed" />}
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>{wi.title}</h1>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                #{wi.id} · {wi.team_project} · {wi.area_path}
              </div>
            </div>

            {/* Description */}
            {wi.description && (
              <div style={card}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Description</div>
                <div
                  style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)', opacity: 0.8 }}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(wi.description) }}
                />
              </div>
            )}

            {/* Hierarchy */}
            {(wi.parent_epic || wi.parent_feature) && (
              <div style={card}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Hierarchy</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {wi.parent_epic && (
                    <HierarchyItem level="Epic" id={wi.parent_epic.id} title={wi.parent_epic.title} color="#a78bfa"
                      onClick={() => navigate(`/teams/${teamId}/work-items/${wi.parent_epic.id}`)} />
                  )}
                  {wi.parent_feature && (
                    <HierarchyItem level="Feature" id={wi.parent_feature.id} title={wi.parent_feature.title} color="#60a5fa"
                      onClick={() => navigate(`/teams/${teamId}/work-items/${wi.parent_feature.id}`)} />
                  )}
                  <HierarchyItem level={wi.work_item_type} id={wi.id} title={wi.title} color="#f59e0b" active />
                </div>
              </div>
            )}

            {/* Status Timeline */}
            {wi.status_timeline?.length > 0 && (() => {
              const activeEntry = wi.status_timeline.find(t => t.canonical_status?.toLowerCase() === 'active');
              const doneEntry = [...wi.status_timeline].reverse().find(t => {
                const s = t.canonical_status?.toLowerCase();
                return s === 'done' || s === 'closed' || s === 'resolved';
              });
              return (
                <div style={card}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Status Timeline</div>
                  <div style={{ position: 'relative', paddingLeft: 24 }}>
                    {/* Vertical line */}
                    <div style={{
                      position: 'absolute', left: 5, top: 6, bottom: 6,
                      width: 2, background: 'var(--border)',
                    }} />
                    {wi.status_timeline.map((t, i) => (
                      <div key={i} style={{
                        position: 'relative', paddingBottom: i < wi.status_timeline.length - 1 ? 18 : 0,
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                      }}>
                        {/* Dot */}
                        <div style={{
                          position: 'absolute', left: -24, top: 2,
                          width: 12, height: 12, borderRadius: '50%',
                          background: transitionDotColor(t.canonical_status),
                          border: '2px solid var(--surface)',
                          flexShrink: 0, zIndex: 1,
                        }} />
                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <StatusBadge status={t.canonical_status} />
                            {t.state && t.state !== t.canonical_status && (
                              <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                                ({t.state})
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                            {t.date ? fmtDateTime(t.date) : '—'}
                          </div>
                          {/* Assigned person */}
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'var(--surface2)', borderRadius: 8, padding: '6px 10px',
                          }}>
                            {t.assigned_to ? (
                              <>
                                <Avatar name={t.assigned_to} size={22} />
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                    Assigned to
                                  </div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t.assigned_to}</div>
                                </div>
                              </>
                            ) : (
                              <>
                                <div style={{
                                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                  background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>?</span>
                                </div>
                                <div>
                                  <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                    Assigned to
                                  </div>
                                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Unassigned</div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Cycle time footer */}
                  {activeEntry?.date && doneEntry?.date && (
                    <div style={{
                      marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Cycle Time
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                        {cycleTimeDays(activeEntry.date, doneEntry.date)}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        ({fmtDateTime(activeEntry.date)} → {fmtDateTime(doneEntry.date)})
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Rework History */}
            {wi.bounces > 0 && (
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Rework History</div>
                  <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {wi.bounces} bounce{wi.bounces > 1 ? 's' : ''}
                  </span>
                </div>
                {wi.bounce_details?.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {wi.bounce_details.map((detail, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: '#ef444408', border: '1px solid #ef444418',
                        borderRadius: 10, padding: '10px 14px',
                      }}>
                        <span style={{ color: '#ef4444', fontSize: 16 }}>↩</span>
                        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', opacity: 0.8 }}>
                          {detail.from_state} → {detail.to_state}
                          {detail.date && (
                            <span style={{ color: 'var(--muted)', marginLeft: 8 }}>
                              {new Date(detail.date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                    {wi.bounces} QA → Active bounce{wi.bounces > 1 ? 's' : ''} detected
                  </div>
                )}
              </div>
            )}

            {/* Linked Bugs */}
            {wi.child_bugs?.length > 0 && (
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Linked Bugs</div>
                  <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {wi.child_bugs.length} bug{wi.child_bugs.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wi.child_bugs.map((bug) => (
                    <ChildItemRow
                      key={bug.id}
                      icon="🐛"
                      item={bug}
                      onClick={() => navigate(`/teams/${teamId}/work-items/${bug.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Child Tasks */}
            {wi.child_tasks?.length > 0 && (
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Child Tasks</div>
                  <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {wi.child_tasks.length} task{wi.child_tasks.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wi.child_tasks.map((task) => (
                    <ChildItemRow
                      key={task.id}
                      icon="📋"
                      item={task}
                      onClick={() => navigate(`/teams/${teamId}/work-items/${task.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN: Sidebar ──────────────────────────────── */}
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* People */}
            <div style={card}>
              <div style={sectionLabel}>People</div>
              <PersonRow label="Developer" name={wi.developer} />
              <PersonRow label="QA Engineer" name={wi.qa} />
              <PersonRow label="Release Manager" name={wi.release_manager} />
            </div>

            {/* Status */}
            <div style={card}>
              <div style={sectionLabel}>Status</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <StatusRow
                  label="Period Start"
                  canonical={wi.status_at_start}
                />
                <StatusRow
                  label="Period End"
                  canonical={wi.status_at_end || wi.canonical_status}
                />
              </div>
            </div>

            {/* Timeline */}
            <div style={card}>
              <div style={sectionLabel}>Timeline</div>
              <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 12, marginLeft: 4 }}>
                <TimelineRow label="Start Date" dateStr={wi.start_date} />
                <TimelineRow label="Finish Date" dateStr={wi.finish_date} />
                {wi.active_entered_at && <TimelineRow label="Active Entered" dateStr={wi.active_entered_at} />}
                {wi.done_entered_at && <TimelineRow label="Done Entered" dateStr={wi.done_entered_at} />}
              </div>
              {!wi.start_date && !wi.finish_date && !wi.active_entered_at && !wi.done_entered_at && (
                <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>No timeline data</div>
              )}
            </div>

            {/* Status Info */}
            <div style={card}>
              <div style={sectionLabel}>Info</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <InfoRow label="Period" value={`${fmtDate(periodStart)} — ${fmtDate(periodEnd)}`} />
                {wi.delivery_days != null && (
                  <InfoRow label="Lead Time" value={`${wi.delivery_days.toFixed(1)} days`} />
                )}
                {wi.is_committed != null && (
                  <InfoRow label="Committed" value={wi.is_committed ? 'Yes' : 'No'} />
                )}
                {wi.is_unparented && (
                  <div style={{
                    background: '#f59e0b18', color: '#f59e0b', fontSize: 10, fontWeight: 700,
                    padding: '4px 8px', borderRadius: 6, fontFamily: 'var(--font-mono)',
                  }}>
                    ⚠ Unparented work item
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function transitionDotColor(status) {
  if (!status) return 'var(--muted)';
  const s = status.toLowerCase();
  if (s === 'done' || s === 'closed' || s === 'resolved') return 'var(--good)';
  if (s === 'active' || s === 'in progress') return 'var(--accent)';
  if (s === 'in qa' || s === 'testing' || s === 'review') return 'var(--warn)';
  if (s === 'blocked') return 'var(--bad)';
  return 'var(--muted)';
}

function cycleTimeDays(start, end) {
  if (!start || !end) return '—';
  const ms = new Date(end) - new Date(start);
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function FlagPill({ color, label }) {
  return (
    <span style={{
      background: color + '18', color, fontSize: 9, fontWeight: 700,
      padding: '2px 8px', borderRadius: 99,
    }}>
      {label}
    </span>
  );
}

function PersonRow({ label, name }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      {name ? (
        <Avatar name={name} size={28} />
      ) : (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>?</span>
        </div>
      )}
      <div>
        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-mono)' }}>
          {label}
        </div>
        {name ? (
          <div style={{ fontSize: 12, fontWeight: 600 }}>{name}</div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Unassigned</div>
        )}
      </div>
    </div>
  );
}

function StatusRow({ label, canonical }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {canonical ? (
          <StatusBadge status={canonical} />
        ) : (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', fontFamily: 'var(--font-mono)' }}>
            No data
          </span>
        )}
      </div>
    </div>
  );
}

function TimelineRow({ label, dateStr }) {
  if (!dateStr) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{label}</div>
        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
          {fmtDateTime(dateStr)}
        </div>
      </div>
    </div>
  );
}

function HierarchyItem({ level, id, title, color, active, onClick }) {
  const isClickable = !!onClick && !active;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, borderRadius: 10,
        padding: '10px 14px', border: '1px solid',
        background: active ? 'var(--accent-soft)' : 'var(--surface2)',
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onClick={isClickable ? onClick : undefined}
      onMouseEnter={isClickable ? (e) => { e.currentTarget.style.borderColor = color; } : undefined}
      onMouseLeave={isClickable ? (e) => { e.currentTarget.style.borderColor = 'var(--border)'; } : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div style={{ width: 5, height: 32, borderRadius: 99, background: color, flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {level}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span className="wi-id" style={{ color: 'var(--accent)' }}>#{id}</span>{' '}
          {title || '—'}
        </div>
      </div>
    </div>
  );
}

function ChildItemRow({ icon, item, onClick }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px',
      cursor: 'pointer', transition: 'background .15s',
    }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface3)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--surface2)'}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span className="wi-id" style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0 }}>#{item.id}</span>
      <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
      {item.state && <StatusBadge status={item.state} />}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12 }}>{value}</div>
    </div>
  );
}
