import { useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router';
import { TEAMS, TEAM_LABELS, TEAM_COLORS, TEAM_ICONS } from '../../lib/constants';

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { teamId } = useParams();

  const activePage = (() => {
    if (location.pathname === '/') return 'overview';
    if (location.pathname.includes('/dora')) return 'dora';
    if (location.pathname.match(/^\/teams\/[^/]+$/)) return 'team';
    return 'team'; // kpi, work-items, etc. are sub-pages of team
  })();

  const NAV = [
    { id: 'overview', icon: '⊞', label: 'Overview', section: 'General' },
    ...TEAMS.map(t => ({ id: 'team-' + t, team: t, icon: TEAM_ICONS[t], label: TEAM_LABELS[t], type: 'team', section: 'Teams' })),
    { id: 'sep' },
    ...TEAMS.map(t => ({ id: 'dora-' + t, team: t, icon: '⬡', label: TEAM_LABELS[t], type: 'dora', section: 'DORA' })),
  ];

  const isActive = (item) => {
    if (item.id === 'overview') return activePage === 'overview';
    if (item.type === 'team') return activePage === 'team' && teamId === item.team;
    if (item.type === 'dora') return activePage === 'dora' && teamId === item.team;
    return false;
  };

  const handleNav = (item) => {
    if (item.type === 'team') navigate(`/teams/${item.team}`);
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

      {/* Nav items */}
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
            className={`nav-icon${active ? ' active' : ''}`}
            onClick={() => handleNav(item)}
          >
            <span className="nav-icon-symbol" style={{ fontSize: item.type === 'dora' ? 13 : 16 }}>{item.icon}</span>
            <span className="nav-icon-label">{item.label}</span>
            {dot && !active && <div className="nav-dot-sm" style={{ background: dot }} />}
            {!expanded && <span className="tooltip">{item.section ? `${item.section} · ` : ''}{item.label}</span>}
          </div>
        );

        return sectionEl ? [sectionEl, navEl] : navEl;
      })}

      {/* Collapse toggle */}
      <div className="sidebar-toggle">
        <button className="sidebar-toggle-btn" onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? '◀' : '▶'}
        </button>
      </div>
    </nav>
  );
}
