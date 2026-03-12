import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { PanelLeftClose, PanelLeftOpen, LayoutDashboard, Activity, TrendingUp, Users, Scale, UsersRound, ShieldCheck } from 'lucide-react';
import { TEAMS, TEAM_LABELS, TEAM_COLORS, TEAM_ICONS } from '../../lib/constants';
import { usePageMeta } from '../../hooks/usePageMeta';

const SIDEBAR_STORAGE_KEY = 'sidebar-expanded';

export default function Sidebar({ isMobile = false, mobileOpen = false, onClose }) {
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
  const { activeId: activePage, teamId } = usePageMeta();

  const NAV = [
    { id: 'overview', icon: 'overview', label: 'Overview', section: 'General' },
    { id: 'performance', icon: 'performance', label: 'Performance', section: 'General' },
    { id: 'developers', icon: 'developers', label: 'Developers', section: 'General' },
    { id: 'cross-performance', icon: 'cross-perf', label: 'Cross Performance', section: 'Cross-Team' },
    { id: 'cross-developers', icon: 'cross-devs', label: 'Cross Developers', section: 'Cross-Team' },
    { id: 'cross-qa', icon: 'cross-qa', label: 'Cross QA', section: 'Cross-Team' },
    ...TEAMS.map(t => ({ id: 'team-' + t, team: t, icon: TEAM_ICONS[t], label: TEAM_LABELS[t], type: 'team', section: 'Teams' })),
    { id: 'sep' },
    ...TEAMS.map(t => ({ id: 'dora-' + t, team: t, icon: 'dora', label: TEAM_LABELS[t], type: 'dora', section: 'DORA' })),
  ];

  const isActive = (item) => {
    if (item.id === 'overview') return activePage === 'overview';
    if (item.id === 'performance') return activePage === 'performance';
    if (item.id === 'developers') return activePage === 'developers';
    if (item.id === 'cross-performance') return activePage === 'cross-performance';
    if (item.id === 'cross-developers') return activePage === 'cross-developers';
    if (item.id === 'cross-qa') return activePage === 'cross-qa';
    if (item.type === 'team') return activePage === 'team' && teamId === item.team;
    if (item.type === 'dora') return activePage === 'dora' && teamId === item.team;
    return false;
  };

  const handleNav = (item) => {
    if (item.id === 'performance') navigate('/performance');
    else if (item.id === 'developers') navigate('/developers');
    else if (item.id === 'cross-performance') navigate('/cross-performance');
    else if (item.id === 'cross-developers') navigate('/cross-developers');
    else if (item.id === 'cross-qa') navigate('/cross-qa');
    else if (item.type === 'team') navigate(`/teams/${item.team}`);
    else if (item.type === 'dora') navigate(`/teams/${item.team}/dora`);
    else navigate('/');
    // Close drawer on mobile after navigation
    if (isMobile && onClose) onClose();
  };

  // On mobile: always render as expanded (labels visible), use mobile-open class for visibility
  const sidebarClass = isMobile
    ? `sidebar expanded${mobileOpen ? ' mobile-open' : ''}`
    : `sidebar${expanded ? ' expanded' : ''}`;

  let lastSection = null;

  return (
    <nav className={sidebarClass}>
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
        const showLabels = isMobile || expanded;
        if (showLabels && item.section && item.section !== lastSection) {
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
              item.icon === 'developers' ? <Users className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              item.icon === 'cross-perf' ? <Scale className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              item.icon === 'cross-devs' ? <UsersRound className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              item.icon === 'cross-qa' ? <ShieldCheck className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              item.icon === 'dora' ? <Activity className="nav-icon-symbol" size={18} strokeWidth={2} /> :
              <span className="nav-icon-symbol">{item.icon}</span>}
            <span className="nav-icon-label">{item.label}</span>
            {dot && !active && <div className="nav-dot-sm" style={{ background: dot }} />}
            {!isMobile && !expanded && <span className="tooltip">{item.section ? `${item.section} · ` : ''}{item.label}</span>}
          </div>
        );

        return sectionEl ? [sectionEl, navEl] : navEl;
      })}
      </div>

      {/* Collapse toggle (desktop only) */}
      <div className="sidebar-toggle">
        <button className="sidebar-toggle-btn" onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
          {expanded ? <PanelLeftClose size={18} strokeWidth={2} /> : <PanelLeftOpen size={18} strokeWidth={2} />}
        </button>
      </div>
    </nav>
  );
}
