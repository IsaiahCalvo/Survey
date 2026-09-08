/* Survey Hub — shared shell + small presentational components.
   Ported from the Claude Design prototype (survey-hub/shell.jsx). All markup is
   rendered inside a `.survey-hub` root so hub.css stays fully scoped. */
import { useState, useRef, useEffect, useLayoutEffect, useContext, createContext } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AppIcon from '../Icons';
import DismissBarrier from '../components/DismissBarrier';

const HUB_BUILD_STAMP = (
  typeof __BUILD_STAMP__ !== 'undefined' && __BUILD_STAMP__
) || 'unknown';

/* Friendly per-tier label used in the bottom-left profile chip. Maps the
   raw plan/tier string from AuthContext to the short capitalised form. The
   default of "Synced · Pro" used to be hardcoded, which displayed "Pro"
   even for free / enterprise / developer users — a release-blocking lie
   about subscription status. (KAL-54 audit, 2026-05-22.) */
const TIER_LABEL = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
  developer: 'Developer'
};
const tierLabelFromAuth = (tier) => {
  const key = String(tier || '').toLowerCase();
  return TIER_LABEL[key] || (key ? key[0].toUpperCase() + key.slice(1) : 'Free');
};

/* Context for chrome-level data/callbacks (the profile menu) so the per-tab
   shells don't have to prop-drill them. SurveyHub provides it. */
export const HubChromeContext = createContext({});

/* The hub uses the app-wide SVG registry. Keep the old short hub names at this
   boundary so callers stay small while every shape comes from one source. */
const HUB_ICON_ALIASES = {
  doc: "document",
  "arrow-r": "arrowRight",
};

export const Icon = ({ name, size = 14, color, style, className }) => (
  <AppIcon
    name={HUB_ICON_ALIASES[name] || name}
    size={size}
    color={color}
    style={style}
    className={className}
  />
);

/* Round initials badge. */
export const Avatar = ({ initials, color = 'var(--gold)', size = 22 }) => (
  <div style={{ width: size, height: size, borderRadius: '50%', background: color, color: '#15110a', display: 'grid', placeItems: 'center', fontSize: size * 0.42, fontWeight: 800, flex: 'none' }}>{initials}</div>
);

/* Overlapping row of avatars — used to preview a team compactly. */
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


/* Search field — visual only at this layer; callers wire value/onChange. */
export const Search = ({ placeholder = 'Search…', width = 240, value, onChange, dismissActionSelector = '' }) => {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);

  return (
    <>
      <DismissBarrier
        active={focused}
        insideRefs={[rootRef]}
        passthroughSelector={dismissActionSelector}
        onDismiss={() => {
          inputRef.current?.blur();
          setFocused(false);
        }}
      />
      <div ref={rootRef} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--ink-700)', border: '1px solid var(--ink-500)', borderRadius: 6, padding: '5px 9px', width, fontSize: 11.5, height: 28, boxSizing: 'border-box' }}>
        <Icon name="search" size={13} color="var(--ink-200)" />
        <input
          ref={inputRef}
          value={value || ''}
          onChange={(e) => onChange && onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          style={{ background: 'transparent', border: 0, outline: 'none', color: 'var(--bone-100)', font: 'inherit', flex: 1, minWidth: 0 }}
        />
        <span className="kbd">⌘K</span>
      </div>
    </>
  );
};

/* Shared empty state — icon + headline + one primary action.
   (Design decision 4: every empty tab surface uses this exact shape.)

   UX (KAL-58): `description` is OPTIONAL and is what turns the one-line form
   into a two-tier one. Pass it and `line` is promoted to a real 13px headline
   with the sentence beneath it in muted ink; omit it and the block renders
   exactly as it always has — a single muted line.

   Why two tiers: "No documents yet" states the fact but not the next move. A
   first-time user on a blank pane needs to know what to DO, and a headline plus
   one plain sentence carries that without turning the empty state into a page.
   The block is capped at 320px so the sentence wraps to two lines at most.

   The one-line form is not legacy — the Archive screen deliberately uses it.
   "Nothing in Archive" needs no coaching, and Archive's layout was signed off
   as-is, so it must keep rendering identically. Any change here has to leave
   the no-description path byte-for-byte the same. */
export const EmptyState = ({ icon, line, description, actionLabel, actionIcon = 'plus', onAction }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '40px 16px', textAlign: 'center', letterSpacing: 0 }}>
    <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--ink-600)', border: '1px solid var(--ink-500)', display: 'grid', placeItems: 'center' }}>
      <Icon name={icon} size={20} />
    </div>
    {description ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 320 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--bone-100)' }}>{line}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-200)', lineHeight: 1.5 }}>{description}</div>
      </div>
    ) : (
      <div style={{ fontSize: 12.5, color: 'var(--ink-200)' }}>{line}</div>
    )}
    <button className="btn primary" type="button" onClick={() => onAction && onAction()}>
      <Icon name={actionIcon} size={12} />{actionLabel}
    </button>
  </div>
);

/* Word-initials, e.g. "Isaiah Calvo" -> "IC". */
const initialsOf = (name) => (name || 'You')
  .trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || 'YOU';

const mobileNavModeFromUrl = () => {
  if (typeof window === 'undefined') return 'tabs';
  const explicit = new URLSearchParams(window.location.search).get('mobileNav');
  if (explicit === 'rail' || explicit === 'tabs') return explicit;
  if (/^\/mobile(?:\/|$)/.test(window.location.pathname)) return 'tabs';
  return window.Capacitor?.isNativePlatform?.() ? 'tabs' : 'rail';
};

const isExpoNativeShell = () => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('nativeShell') === 'expo';
};

/* Bottom-left profile control — a button that opens a Settings / Sign Out
   popup (matching the menu the app had before, restyled to the hub palette).
   Reads the user and the two callbacks from HubChromeContext. */
/* `showArchive` is set only on the MOBILE instance (owner call 2026-08-07:
   "in mobile, when the user clicks on their icon in the top right corner,
   that's where they'll be able to see their archives"). Desktop keeps Archive
   pinned at the bottom of the left rail, so putting it in the desktop menu too
   would be the same destination offered twice. */
const ProfileMenu = ({ userName, userMeta, showArchive = false, tab, onNav }) => {
  const { user, onSettings, onSignOut, onSignIn } = useContext(HubChromeContext);
  // Resolve the per-tier badge text. Callers may pass `userMeta` explicitly;
  // otherwise we read from AuthContext so free users no longer see "Pro".
  const auth = useAuth();
  const resolvedMeta = userMeta || `Synced · ${tierLabelFromAuth(auth?.tier)}`;
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      setConfirmSignOut(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!user) {
    return (
      <div className="who who-guest">
        <button type="button" className="profile-signin" onClick={() => onSignIn && onSignIn()}>
          Sign in
        </button>
      </div>
    );
  }

  const name = user?.name || user?.email?.split('@')[0] || userName;
  const email = user?.email || '';
  const initials = initialsOf(name);
  const itemStyle = { display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', background: 'transparent', border: 0, color: 'var(--bone-100)', padding: '8px 10px', fontSize: 12.5, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
  return (
    <div className="who" ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="Open account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => {
          const next = !o;
          if (!next) setConfirmSignOut(false);
          return next;
        })}
        title={email || name}
        style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', background: open ? 'var(--ink-600)' : 'transparent', border: 0, borderRadius: 6, padding: '4px 6px', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', textAlign: 'left' }}
      >
        <Avatar initials={initials} size={24} />
        <div style={{ minWidth: 0 }}>
          <div className="name">{name}</div>
          <div className="who-meta">{resolvedMeta}</div>
        </div>
      </button>
      {open && (
        <>
          <div
            className="profile-menu-scrim"
            aria-hidden="true"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setConfirmSignOut(false);
            }}
          />
          <div className="profile-menu-popup" role="menu" aria-label="Account menu" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, width: 270, background: 'var(--ink-700)', border: '1px solid var(--ink-500)', borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.5)', overflow: 'hidden', zIndex: 50 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
              <Avatar initials={initials} size={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                {email ? <div style={{ fontSize: 10.5, color: 'var(--ink-200)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div> : null}
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--ink-500)' }} />
            <div className="profile-menu-actions" style={{ padding: 4 }}>
              {showArchive && (
                <button
                  className={tab === 'archive' ? 'active' : ''}
                  style={{ ...itemStyle, color: tab === 'archive' ? 'var(--gold)' : itemStyle.color }}
                  onClick={() => { setOpen(false); setConfirmSignOut(false); onNav && onNav('archive'); }}
                >
                  <Icon name="clock" size={15} color={tab === 'archive' ? 'var(--gold)' : 'var(--ink-200)'} />Archive
                </button>
              )}
              <button style={itemStyle} onClick={() => { setOpen(false); setConfirmSignOut(false); onSettings && onSettings(); }}>
                <Icon name="settings" size={15} color="var(--ink-200)" />Settings
              </button>
              {confirmSignOut ? (
                <div className="profile-signout-confirm">
                  <div className="profile-signout-copy">Sign out of Survey?</div>
                  <div className="profile-signout-buttons">
                    <button type="button" onClick={() => setConfirmSignOut(false)}>Cancel</button>
                    <button type="button" className="danger" onClick={() => { setOpen(false); onSignOut && onSignOut(); }}>Sign out</button>
                  </div>
                </div>
              ) : (
                <button className="profile-menu-signout" style={{ ...itemStyle, color: '#d95a56' }} onClick={() => setConfirmSignOut(true)}>
                  <Icon name="signout" size={15} color="#d95a56" />Sign out
                </button>
              )}
            </div>
            <div className="profile-menu-build-footer">
              <span>Survey App version 1.0</span>
              <span>Build {HUB_BUILD_STAMP}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const MobileRailNav = ({ mode, title, tab, navItems, onNav }) => {
  const [open, setOpen] = useState(false);
  const touchStart = useRef(null);

  if (mode !== 'rail') return null;

  const choose = (key, disabled) => {
    if (disabled) return;
    setOpen(false);
    onNav && onNav(key);
  };

  const onTouchStart = (e) => {
    const touch = e.touches?.[0];
    if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (e) => {
    const start = touchStart.current;
    const touch = e.changedTouches?.[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx < -36 && Math.abs(dx) > Math.abs(dy)) setOpen(false);
  };

  return (
    <div className="mobile-rail-nav">
      <button
        type="button"
        className="mobile-rail-nav-trigger"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="menu" size={16} />
      </button>
      {open && (
        <div className="mobile-rail-nav-scrim" onClick={() => setOpen(false)}>
          <aside
            className="mobile-rail-nav-panel"
            aria-label="Mobile navigation"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div className="mobile-rail-nav-label">Navigate</div>
            <div className="mobile-rail-nav-title">{title}</div>
            <div className="mobile-rail-nav-options">
              {navItems.map(([key, icon, label, disabled]) => (
                <button
                  key={key}
                  type="button"
                  className={tab === key ? 'active' : ''}
                  disabled={disabled}
                  onClick={() => choose(key, disabled)}
                >
                  <Icon name={icon} size={15} />
                  <span>{label}</span>
                  {disabled ? <Icon name="lock" size={12} color="var(--ink-200)" /> : null}
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

/* Sidebar + header frame. SurveyHub swaps complete tab shells atomically, so
   this component owns the shared viewport and chrome contract for each tab. */
export const HubShell = ({ tab, onNav, title, subtitle, actions, children, userName = 'You', userMeta = undefined, templatesLocked = false, mobileSwipeSurfaceRef = undefined }) => {
  const { projectUploadRecovery } = useContext(HubChromeContext);
  const expoNativeShell = isExpoNativeShell();

  // These classes define the mobile viewport itself. A passive effect can run
  // after the browser paints, exposing one unframed page between tab shells.
  // Layout effects hand the classes from the old shell to the new one before
  // paint, so navigation has no white/blank frame.
  useLayoutEffect(() => {
    const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
    const pageClass = expoNativeShell ? 'survey-hub-native-frame' : 'survey-hub-mobile-scroll-page';
    const rootClass = expoNativeShell ? 'survey-hub-native-root' : 'survey-hub-mobile-scroll-root';
    document.documentElement.classList.add(pageClass);
    document.body.classList.add(pageClass);
    root?.classList.add(rootClass);
    return () => {
      document.documentElement.classList.remove(pageClass);
      document.body.classList.remove(pageClass);
      root?.classList.remove(rootClass);
    };
  }, [expoNativeShell]);

  // The three places you work. Archive is deliberately NOT one of them.
  const primaryNavItems = [
    ['documents', 'doc', 'Documents', false],
    ['projects', 'folder', 'Projects', false],
    ['templates', 'template', 'Templates', templatesLocked],
  ];
  // KAL-280 — Archive is a recovery destination, not somewhere you work, so it
  // must never compete with the three main tabs for attention. It renders in its
  // own bottom group that is pushed down the rail so it sits directly above the
  // profile chip. (Listing it last inside `.nav` was NOT enough: `.who` carries
  // margin-top:auto, so the empty space opened up *below* Archive and it stayed
  // glued to the main tabs at the top.)
  const archiveNavItem = ['archive', 'clock', 'Archive', false];
  /* Mobile navigation carries the three primary tabs ONLY. Archive lives behind
     the top-right profile avatar there (owner call 2026-08-07) — the same
     "recovery destination, not somewhere you work" reasoning as the desktop
     rail, applied to a bar that has far less room to spend. This list feeds
     both mobile navigation modes (`?mobileNav=tabs` bottom bar and
     `?mobileNav=rail` drawer), so Archive leaves both at once. */
  const navItems = primaryNavItems;
  const mobileNavMode = mobileNavModeFromUrl();
  const navBtn = (key, icon, label, disabled = false) => (
    <button
      key={key}
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
    // The hub-tab-* class lets mobile CSS size the fixed header per tab
    // (Documents carries an extra select/bulk row; the others don't).
    <div className={`survey-hub hub-tab-${tab} ${mobileNavMode === 'rail' ? 'hub-mobile-nav-rail' : ''} ${expoNativeShell ? 'hub-native-shell-expo' : ''}`}>
      <div className="shell">
        <aside className="side">
          <div className="brand"><span className="brand-dot"></span>Survey</div>
          <nav className="nav">
            {primaryNavItems.map(([key, icon, label, disabled]) => navBtn(key, icon, label, disabled))}
          </nav>
          <nav className="nav nav-bottom">
            {navBtn(...archiveNavItem)}
          </nav>
          <ProfileMenu userName={userName} userMeta={userMeta} />
        </aside>
        <main ref={mobileSwipeSurfaceRef} className="main paper">
          <div className="header">
            <div className="header-title-block">
              <MobileRailNav mode={mobileNavMode} title={title} tab={tab} navItems={navItems} onNav={onNav} />
              <h1 className="title">{title}</h1>
              {subtitle ? <div className="crumb header-subtitle" style={{ marginTop: 6 }}>{subtitle}</div> : null}
            </div>
            <div className="mobile-profile">
              <ProfileMenu userName={userName} userMeta={userMeta} showArchive tab={tab} onNav={onNav} />
            </div>
            <div className="actions">{actions}</div>
          </div>
          {projectUploadRecovery}
          {children}
        </main>
        <nav className="mobile-home-tabs" aria-label="Home sections">
          {navItems.map(([key, icon, label, disabled]) => navBtn(key, icon, label, disabled))}
        </nav>
      </div>
    </div>
  );
};
