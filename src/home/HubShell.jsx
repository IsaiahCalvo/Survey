/* Survey Hub — shared shell + small presentational components.
   Ported from the Claude Design prototype (survey-hub/shell.jsx). All markup is
   rendered inside a `.survey-hub` root so hub.css stays fully scoped. */
import React from 'react';

/* Inline SVG icon set used across the hub. */
export const Icon = ({ name, size = 14, color = 'currentColor' }) => {
  const s = { width: size, height: size, fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'doc': return <svg viewBox="0 0 24 24" style={s}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>;
    case 'folder': return <svg viewBox="0 0 24 24" style={s}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
    case 'grid': return <svg viewBox="0 0 24 24" style={s}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
    case 'search': return <svg viewBox="0 0 24 24" style={s}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'plus': return <svg viewBox="0 0 24 24" style={s}><path d="M12 5v14M5 12h14"/></svg>;
    case 'upload': return <svg viewBox="0 0 24 24" style={s}><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>;
    case 'filter': return <svg viewBox="0 0 24 24" style={s}><path d="M3 5h18M6 12h12M10 19h4"/></svg>;
    case 'more': return <svg viewBox="0 0 24 24" style={s}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
    case 'clock': return <svg viewBox="0 0 24 24" style={s}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'users': return <svg viewBox="0 0 24 24" style={s}><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M17 11a3 3 0 1 0-2-5"/><path d="M22 19a5 5 0 0 0-5-5"/></svg>;
    case 'check': return <svg viewBox="0 0 24 24" style={s}><path d="m5 12 4.5 4.5L20 6"/></svg>;
    case 'arrow-r': return <svg viewBox="0 0 24 24" style={s}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case 'trash': return <svg viewBox="0 0 24 24" style={s}><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6"/></svg>;
    case 'share': return <svg viewBox="0 0 24 24" style={s}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>;
    case 'lock': return <svg viewBox="0 0 24 24" style={s}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
    default: return null;
  }
};

/* Round initials badge. */
export const Avatar = ({ initials, color = 'var(--gold)', size = 22 }) => (
  <div style={{ width: size, height: size, borderRadius: '50%', background: color, color: '#15110a', display: 'grid', placeItems: 'center', fontSize: size * 0.42, fontWeight: 800, flex: 'none' }}>{initials}</div>
);

/* Overlapping row of avatars — used to preview a roster compactly. */
export const AvatarStack = ({ members, size = 22 }) => (
  <div style={{ display: 'flex' }}>
    {members.map((m, i) => (
      <div key={i} style={{ marginLeft: i === 0 ? 0 : -6, border: '2px solid var(--ink-700)', borderRadius: '50%' }}>
        <Avatar initials={m} color={['var(--gold)', 'var(--blue)', 'var(--green)', 'var(--rose)', 'var(--lilac)'][i % 5]} size={size} />
      </div>
    ))}
  </div>
);

/* Stylised PDF page placeholder — stands in for a real page render. */
export const PdfThumb = ({ height = 110, marks = [], stamp = '', color = '#1f4a7a' }) => (
  <div className="pdf-thumb" style={{ height, width: '100%' }}>
    <div className="ribbon" style={{ background: color }}></div>
    <div className="ribbon-line"></div>
    {marks.map((m, i) => (
      m.type === 'swatch'
        ? <div key={i} className="swatch" style={{ left: m.x + '%', top: m.y + '%', width: m.w + '%', height: m.h + '%', background: m.color || 'rgba(216,168,78,0.4)' }}></div>
        : <div key={i} className="mark" style={{ left: m.x + '%', top: m.y + '%', width: m.w + '%', height: m.h + '%', borderColor: m.color || 'var(--gold)' }}></div>
    ))}
    {stamp ? <div className="stamp">{stamp}</div> : null}
  </div>
);

/* Thin progress bar. */
export const ProgressBar = ({ pct, color = 'var(--gold)' }) => (
  <div style={{ height: 5, background: 'var(--ink-500)', borderRadius: 3, overflow: 'hidden' }}>
    <div style={{ width: pct + '%', height: '100%', background: color }}></div>
  </div>
);

/* Search field — visual only at this layer; callers wire value/onChange. */
export const Search = ({ placeholder = 'Search…', width = 240, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--ink-700)', border: '1px solid var(--ink-500)', borderRadius: 6, padding: '5px 9px', width, fontSize: 11.5, height: 28, boxSizing: 'border-box' }}>
    <Icon name="search" size={13} color="var(--ink-200)" />
    <input
      value={value || ''}
      onChange={(e) => onChange && onChange(e.target.value)}
      placeholder={placeholder}
      style={{ background: 'transparent', border: 0, outline: 'none', color: 'var(--bone-100)', font: 'inherit', flex: 1, minWidth: 0 }}
    />
  </div>
);

/* Sidebar + header frame. The three tabs are always rendered so the chrome
   feels permanent; only the body content (children) changes per tab. */
export const HubShell = ({ tab, onNav, title, subtitle, actions, children, userName = 'You', userMeta = '', templatesLocked = false }) => {
  const navBtn = (key, icon, label, disabled = false) => (
    <button
      className={tab === key ? 'active' : ''}
      disabled={disabled}
      onClick={() => !disabled && onNav && onNav(key)}
      title={disabled ? 'Templates is a Pro feature' : undefined}
    >
      <span className="ico"><Icon name={icon} size={14} /></span>
      {label}
      {disabled ? <span style={{ marginLeft: 'auto' }}><Icon name="lock" size={11} color="var(--ink-200)" /></span> : null}
    </button>
  );
  return (
    <div className="survey-hub">
      <div className="shell">
        <aside className="side">
          <div className="brand"><span className="brand-dot"></span>Survey</div>
          <nav className="nav">
            {navBtn('documents', 'doc', 'Documents')}
            {navBtn('projects', 'folder', 'Projects')}
            {navBtn('templates', 'grid', 'Templates', templatesLocked)}
          </nav>
          <div className="who">
            <Avatar initials={(userName || 'You').slice(0, 2).toUpperCase()} size={24} />
            <div>
              <div className="name">{userName}</div>
              {userMeta ? <div className="who-meta">{userMeta}</div> : null}
            </div>
          </div>
        </aside>
        <main className="main paper">
          <div className="header">
            <div>
              <h1 className="title">{title}</h1>
              {subtitle ? <div className="crumb" style={{ marginTop: 6 }}>{subtitle}</div> : null}
            </div>
            <div className="actions">{actions}</div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
};
