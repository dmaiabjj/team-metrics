import { useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router';
import { PanelLeftClose, PanelLeftOpen, LayoutDashboard, Activity, TrendingUp } from 'lucide-react';
import { TEAMS, TEAM_LABELS, TEAM_COLORS, TEAM_ICONS } from '../../lib/constants';

const SIDEBAR_STORAGE_KEY = 'sidebar-expanded';

export default function Sidebar() {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded));
    } catch {}
  }, [expanded]);
  const navigate = useNavigate();
  const location = useLocation();
  const { teamId } = useParams();

  const activePage = (() => {
    if (location.pathname === '/') return 'overview';
    if (location.pathname === '/performance') return 'performance';
    if (location.pathname.includes('/dora')) return 'dora';
    if (location.pathname.match(/^\/teams\/[^/]+$/)) return 'team';
    return 'team'; // kpi, work-items, etc. are sub-pages of team
  })();

  const NAV = [
    { id: 'overview', icon: 'overview', label: 'Overview', section: 'General' },
    { id: 'performance', icon: 'performance', label: 'Performance', section: 'General' },
    ...TEAMS.map(t => ({ id: 'team-' + t, team: t, icon: TEAM_ICONS[t], label: TEAM_LABELS[t], type: 'team', section: 'Teams' })),
    { id: 'sep' },
    ...TEAMS.map(t => ({ id: 'dora-' + t, team: t, icon: 'dora', label: TEAM_LABELS[t], type: 'dora', section: 'DORA' })),
  ];

  const isActive = (item) => {
    if (item.id === 'overview') return activePage === 'overview';
    if (item.id === 'performance') return activePage === 'performance';
    if (item.type === 'team') return activePage === 'team' && teamId === item.team;
    if (item.type === 'dora') return activePage === 'dora' && teamId === item.team;
    return false;
  };

  const handleNav = (item) => {
    if (item.id === 'performance') navigate('/performance');
    else if (item.type === 'team') navigate(`/teams/${item.team}`);
    else if (item.type === 'dora') navigate(`/teams/${item.team}/dora`);
    else navigate('/');
  };

  let lastSection = null;

  return (
    <nav className={`sidebar${expanded ? ' expanded' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo-wrap">
        <div className="sidebar-logo">T</div>
        <span className="sidebar-brand">Team Metrics</span>
      </div>

      {/* Nav items (scrollable when collapsed) */}
      <div className="sidebar-nav-wrap">
      {NAV.map((item, i) => {
        if (item.id === 'sep') return <div key={i} className="sidebar-sep" />;

        let sectionEl = null;
        if (expanded && item.section && item.section !== lastSection) {
          lastSection = item.section;
          sectionEl = <div key={'sec-' + item.section} className="sidebar-section">{item.section}</div>;
        }

        const dot = item.team ? TEAM_COLORS[item.team] : null;
        const active = isActive(item);

        const navEl = (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            className={`nav-icon${active ? ' active' : ''}`}
            onClick={() => handleNav(item)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNav(item); } }}
          >
            {item.icon === 'overview' ? <LayoutDashboard className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              item.icon === 'performance' ? <TrendingUp className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              item.icon === 'dora' ? <Activity className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              <span className="nav-icon-symbol">{item.icon}</span>}
            <span className="nav-icon-label">{item.label}</span>
            {dot && !active && <div className="nav-dot-sm" style={{ background: dot }} />}
            {!expanded && <span className="tooltip">{item.section ? `${item.section} · ` : ''}{item.label}</span>}
          </div>
        );

        return sectionEl ? [sectionEl, navEl] : navEl;
      })}
      </div>

      {/* Collapse toggle */}
      <div className="sidebar-toggle">
        <button className="sidebar-toggle-btn" onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
          {expanded ? <PanelLeftClose size={18} strokeWidth={2} /> : <PanelLeftOpen size={18} strokeWidth={2} />}
        </button>
      </div>
    </nav>
  );
}
