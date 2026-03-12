import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useWorkItems } from '../api/hooks/useWorkItems';
import { usePeriod } from '../context/PeriodContext';
import { TEAM_LABELS } from '../lib/constants';
import { fmtDate } from '../lib/formatters';
import StatusBadge from '../components/shared/StatusBadge';
import Breadcrumb from '../components/shared/Breadcrumb';
import Loader from '../components/shared/Loader';
import ErrorBox from '../components/shared/ErrorBox';
import DeveloperSummary from '../components/shared/DeveloperSummary';

const FLAG_TABS = [
  { key: '', label: 'All' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'committed', label: 'Committed' },
  { key: 'spillover', label: 'Spillover' },
  { key: 'committed_in_period', label: 'Committed in Period' },
  { key: 'rework', label: 'Rework' },
  { key: 'techdebt', label: 'Tech Debt' },
  { key: 'bugs', label: '🐛 Bugs' },
];

const inputStyle = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 12, padding: '7px 10px', color: 'var(--text)', fontFamily: 'var(--font-mono)',
  outline: 'none',
};

export default function WorkItemsPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { periodStart, periodEnd } = usePeriod();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [flagFilter, setFlagFilter] = useState(searchParams.get('filter') || '');
  const [groupByEpic, setGroupByEpic] = useState(false);

  const { data, isLoading, error } = useWorkItems(teamId, periodStart, periodEnd, { limit: 500 });

  const items = useMemo(() => {
    if (!data?.items) return [];
    let list = data.items;
    if (flagFilter === 'delivered') list = list.filter((w) => w.is_delivered);
    if (flagFilter === 'spillover') list = list.filter((w) => w.is_spillover);
    if (flagFilter === 'committed_in_period') list = list.filter((w) => w.is_committed && !w.is_spillover);
    if (flagFilter === 'rework') list = list.filter((w) => w.is_rework_item);
    if (flagFilter === 'techdebt') list = list.filter((w) => w.is_technical_debt);
    if (flagFilter === 'committed') list = list.filter((w) => w.is_committed);
    if (flagFilter === 'bugs') list = list.filter((w) => (w.child_bugs?.length > 0) || w.work_item_type === 'Bug');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (w) =>
          String(w.id).includes(q) ||
          w.title?.toLowerCase().includes(q) ||
          w.developer?.toLowerCase().includes(q) ||
          w.qa?.toLowerCase().includes(q)
      );
    }
    if (statusFilter) list = list.filter((w) => w.canonical_status === statusFilter);
    if (typeFilter) list = list.filter((w) => w.work_item_type === typeFilter);
    return list;
  }, [data, search, statusFilter, typeFilter, flagFilter]);

  const epicGroups = useMemo(() => {
    if (!groupByEpic) return null;
    const map = new Map();
    for (const wi of items) {
      const eid = wi.parent_epic?.id ?? 0;
      if (!map.has(eid)) {
        map.set(eid, { epicId: eid, epicTitle: wi.parent_epic?.title || null, items: [] });
      }
      map.get(eid).items.push(wi);
    }
    const groups = [...map.values()];
    groups.sort((a, b) => {
      if (a.epicId === 0) return 1;
      if (b.epicId === 0) return -1;
      return (a.epicTitle || '').localeCompare(b.epicTitle || '');
    });
    return groups;
  }, [items, groupByEpic]);

  const statuses = useMemo(() => {
    if (!data?.items) return [];
    return [...new Set(data.items.map((w) => w.canonical_status).filter(Boolean))].sort();
  }, [data]);

  const types = useMemo(() => {
    if (!data?.items) return [];
    return [...new Set(data.items.map((w) => w.work_item_type).filter(Boolean))].sort();
  }, [data]);

  return (
    <div style={{ padding: 32 }} className="animate-fade-in">
      <Breadcrumb items={[
        { label: 'Overview', to: '/' },
        { label: TEAM_LABELS[teamId] || teamId, to: `/teams/${teamId}` },
        { label: 'Work Items' },
      ]} />

      {/* Filters bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
          <input
            type="text"
            placeholder="Search ID, title, developer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '100%', paddingLeft: 30 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 8, fontSize: 12, color: 'var(--muted)' }}>🔍</span>
        </div>

        {/* Status dropdown */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Type dropdown */}
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">All Types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Flag toggle tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {FLAG_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setFlagFilter(tab.key)} style={{
            padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            fontFamily: 'var(--font-mono)', border: '1px solid',
            cursor: 'pointer', transition: 'all .15s',
            background: flagFilter === tab.key ? 'var(--accent-soft)' : 'var(--surface)',
            borderColor: flagFilter === tab.key ? 'var(--accent)' : 'var(--border)',
            color: flagFilter === tab.key ? 'var(--accent)' : 'var(--muted)',
          }}>
            {tab.label}
          </button>
        ))}
        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
        <button onClick={() => setGroupByEpic(!groupByEpic)} style={{
          padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          fontFamily: 'var(--font-mono)', border: '1px solid',
          cursor: 'pointer', transition: 'all .15s',
          background: groupByEpic ? 'var(--accent-soft)' : 'var(--surface)',
          borderColor: groupByEpic ? 'var(--accent)' : 'var(--border)',
          color: groupByEpic ? 'var(--accent)' : 'var(--muted)',
        }}>
          Group by Epic
        </button>
      </div>

      {/* Results count */}
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
        {items.length} items
        {data?.total != null && items.length < data.total && ` of ${data.total} total`}
        {' · '}
        {fmtDate(periodStart)} — {fmtDate(periodEnd)}
      </div>

      {isLoading && <Loader />}
      {error && <ErrorBox message={error.message} />}

      {!isLoading && items.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
          <table className="tbl">
            <thead>
              <tr>
                {(groupByEpic
                  ? ['ID', 'Title', 'Type', 'Status', 'Developer', 'QA', 'Flags']
                  : ['ID', 'Title', 'Type', 'Parent / Epic', 'Status', 'Developer', 'QA', 'Flags']
                ).map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupByEpic && epicGroups ? (
                epicGroups.map((g) => (
                  <EpicGroup
                    key={g.epicId}
                    group={g}
                    teamId={teamId}
                    navigate={navigate}
                    colSpan={7}
                  />
                ))
              ) : (
                items.map((wi) => (
                  <WorkItemRow
                    key={wi.id}
                    wi={wi}
                    teamId={teamId}
                    navigate={navigate}
                    hideEpic={false}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && items.length === 0 && data && (
        <div style={{ textAlign: 'center', padding: '64px 0', fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          No work items match the current filters
        </div>
      )}

      {/* ── Developer Summary ─────────────────────────────────────── */}
      {!isLoading && items.length > 0 && (
        <DeveloperSummary items={items} onWorkItemClick={(id) => navigate(`/teams/${teamId}/work-items/${id}`)} />
      )}
    </div>
  );
}

/* ── Row with bug drilldown ──────────────────────────────────────────── */

function EpicGroup({ group, teamId, navigate, colSpan }) {
  return (
    <>
      <tr>
        <td colSpan={colSpan} style={{
          padding: '10px 14px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
          fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)',
        }}>
          {group.epicId !== 0 ? (
            <span
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/teams/${teamId}/work-items/${group.epicId}`)}
            >
              <span style={{ opacity: 0.6, marginRight: 6 }}>Epic</span>
              <span style={{ color: 'var(--accent)' }}>{group.epicTitle}</span>
              <span style={{ opacity: 0.5, marginLeft: 6 }}>#{group.epicId}</span>
            </span>
          ) : (
            <span style={{ opacity: 0.5 }}>No Epic</span>
          )}
          <span style={{ opacity: 0.4, marginLeft: 8 }}>· {group.items.length} items</span>
        </td>
      </tr>
      {group.items.map((wi) => (
        <WorkItemRow key={wi.id} wi={wi} teamId={teamId} navigate={navigate} hideEpic />
      ))}
    </>
  );
}

function WorkItemRow({ wi, teamId, navigate, hideEpic }) {
  const [bugsOpen, setBugsOpen] = useState(false);
  const bugs = wi.child_bugs?.length > 0 ? wi.child_bugs : [];
  const hasBugs = bugs.length > 0;
  const cols = hideEpic ? 7 : 8;

  return (
    <>
      <tr
        style={{ cursor: 'pointer', ...(bugsOpen ? { background: 'var(--surface2)' } : {}) }}
        onClick={() => navigate(`/teams/${teamId}/work-items/${wi.id}`)}
      >
        <td className="wi-id" style={{ fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
          #{wi.id}
        </td>
        <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {wi.title}
        </td>
        <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {wi.work_item_type}
        </td>
        {!hideEpic && (
          <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 200 }}>
            {wi.parent_epic?.title && (
              <div
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); navigate(`/teams/${teamId}/work-items/${wi.parent_epic.id}`); }}
                title={`Epic #${wi.parent_epic.id}: ${wi.parent_epic.title}`}
              >
                <span style={{ opacity: 0.6 }}>Epic:</span>{' '}
                <span className="tbl-link" style={{ color: 'var(--accent)', fontSize: 10 }}>{wi.parent_epic.title}</span>
              </div>
            )}
            {wi.parent_feature?.title && (
              <div
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); navigate(`/teams/${teamId}/work-items/${wi.parent_feature.id}`); }}
                title={`Feature #${wi.parent_feature.id}: ${wi.parent_feature.title}`}
              >
                <span style={{ opacity: 0.6 }}>→</span>{' '}
                <span className="tbl-link" style={{ color: 'var(--accent)', fontSize: 10 }}>{wi.parent_feature.title}</span>
              </div>
            )}
          </td>
        )}
        <td><StatusBadge status={wi.canonical_status} /></td>
        <td style={{ fontSize: 12 }}>{wi.developer || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
        <td style={{ fontSize: 12 }}>{wi.qa || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
        <td>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {wi.is_delivered && <FlagPill color="#10b981" label="✓ Delivered" />}
            {wi.is_spillover && <FlagPill color="#f59e0b" label="↻ Spillover" />}
            {wi.bounces > 0 && <FlagPill color="#ef4444" label={`↩ Rework(${wi.bounces})`} />}
            {wi.is_technical_debt && <FlagPill color="var(--accent)" label="🏚 Debt" />}
            {hasBugs && (
              <button
                className={`bug-expand-btn${bugsOpen ? ' open' : ''}`}
                onClick={(e) => { e.stopPropagation(); setBugsOpen(!bugsOpen); }}
              >
                🐛 {bugs.length}{bugsOpen ? ' ▲' : ' ▼'}
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Bug drilldown panel */}
      {bugsOpen && hasBugs && (
        <tr>
          <td colSpan={cols} style={{ padding: 0, background: '#13101a', borderBottom: '2px solid #ef444430' }}>
            <div className="bug-panel-inner">
              <div className="bug-panel-title">🐛 Child Bugs ({bugs.length})</div>
              {bugs.map((bug, bi) => (
                <div
                  key={bug.id || bi}
                  className="bug-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/teams/${teamId}/work-items/${bug.id}`)}
                >
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

function FlagPill({ color, label }) {
  return (
    <span style={{
      background: color + '18', color, fontSize: 9, fontWeight: 700,
      padding: '2px 6px', borderRadius: 99, lineHeight: 1.2, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
