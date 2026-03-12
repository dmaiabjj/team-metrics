import { useState, useEffect, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router';
import { usePeriod } from '../../context/PeriodContext';
import { TEAM_LABELS, TEAM_COLORS, KPI_META, SLUG_TO_KPI } from '../../lib/constants';
import { api } from '../../api/client';
import StatusBadge from '../shared/StatusBadge';

export default function Topbar() {
  const { periodStart, periodEnd, setPeriod } = usePeriod();
  const [pendingStart, setPendingStart] = useState(periodStart);
  const [pendingEnd, setPendingEnd] = useState(periodEnd);
  const location = useLocation();
  const { teamId, kpiName, itemId } = useParams();
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef(null);

  // Derive page title from URL
  const pageTitle = (() => {
    if (location.pathname === '/') return 'Overview';
    if (location.pathname === '/performance') return 'Performance Analysis';
    if (itemId) return `#${itemId}`;
    if (location.pathname.includes('/work-items')) return 'Work Items';
    if (location.pathname.includes('/dora')) return 'DORA Health';
    if (kpiName) {
      const kpiKey = SLUG_TO_KPI[kpiName];
      return KPI_META[kpiKey]?.label || kpiName;
    }
    if (teamId) return TEAM_LABELS[teamId] || teamId;
    return 'Dashboard';
  })();

  const isTeamPage = !!teamId;

  // Search debounce
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const q = searchQuery.trim();
        const searchTeam = teamId || 'game-services';
        const resp = await api(`/teams/${searchTeam}/work-items?start_date=${periodStart}&end_date=${periodEnd}&page_size=200`);
        const items = resp?.items || [];
        const lower = q.toLowerCase();
        const isId = /^\d+$/.test(q);
        const filtered = items.filter(wi =>
          isId
            ? String(wi.id).includes(q)
            : ((wi.title || '').toLowerCase().includes(lower) ||
               (wi.developer || '').toLowerCase().includes(lower) ||
               (wi.qa_engineer || '').toLowerCase().includes(lower))
        );
        setSearchResults(filtered.slice(0, 15));
      } catch { setSearchResults([]); }
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, teamId, periodStart, periodEnd]);

  // Close search on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus();
  }, [searchOpen]);

  const openWorkItem = (id) => {
    const t = teamId || 'game-services';
    navigate(`/teams/${t}/work-items/${id}`);
    setSearchOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="topbar">
      <div className="topbar-title">{pageTitle}</div>
      <div className="topbar-divider" />

      {/* Team selector pill */}
      {isTeamPage && (
        <div className="topbar-team-btn">
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: TEAM_COLORS[teamId] || '#999' }} />
          {TEAM_LABELS[teamId] || teamId}
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>▾</span>
        </div>
      )}

      {/* Search */}
      <div className="topbar-search" onClick={() => setSearchOpen(true)} style={{ position: 'relative' }}>
        <span style={{ fontSize: 13 }}>⌕</span>
        {searchOpen
          ? <input
              ref={searchRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by ID or title…"
              style={{ border: 'none', background: 'transparent', outline: 'none', font: 'inherit', color: 'var(--text)', width: '100%' }}
              onBlur={() => { setTimeout(() => { setSearchOpen(false); setSearchQuery(''); }, 200); }}
            />
          : <span>Search…</span>}
        {searchOpen && searchQuery.trim().length >= 2 && (
          <div className="search-dropdown">
            {searchLoading && <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>Searching…</div>}
            {!searchLoading && searchResults.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)' }}>No results found</div>}
            {!searchLoading && searchResults.map(r => (
              <div key={r.id} className="search-result" onMouseDown={() => openWorkItem(r.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="wi-id" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>#{r.id}</span>
                  <span className="badge badge-neutral" style={{ fontSize: 9, padding: '1px 6px' }}>{r.work_item_type}</span>
                  <StatusBadge status={r.canonical_status_end} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                {r.developer && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>Dev: {r.developer}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Period picker */}
      <div className="period-picker">
        <input type="date" className="date-input" value={pendingStart} onChange={e => setPendingStart(e.target.value)} />
        <span className="period-label">→</span>
        <input type="date" className="date-input" value={pendingEnd} onChange={e => setPendingEnd(e.target.value)} />
        <button className="btn" onClick={() => setPeriod(pendingStart, pendingEnd)}>Apply</button>
      </div>

      <div className="topbar-icon-btn">⚙</div>
    </div>
  );
}
