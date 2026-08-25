/* Survey Hub — shared shell + small presentational components.
   Ported from the Claude Design prototype (survey-hub/shell.jsx). All markup is
   rendered inside a `.survey-hub` root so hub.css stays fully scoped. */
import { useState, useRef, useEffect, useLayoutEffect, useContext, createContext } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getContentTypeIconColor } from '../utils/contentTypeColors.js';
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

/* Inline SVG icon set used across the hub. */
const HUB_CONTENT_TYPE_BY_ICON = {
  doc: 'document',
  folder: 'project',
  template: 'template',
};

export const Icon = ({ name, size = 14, color }) => {
  const resolvedColor = color || getContentTypeIconColor(HUB_CONTENT_TYPE_BY_ICON[name], 'currentColor');
  const s = { width: size, height: size, fill: 'none', stroke: resolvedColor, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'doc': return <svg viewBox="0 0 24 24" style={s}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 12h8"/><path d="M8 15h8"/><path d="M8 18h5"/></svg>;
    case 'folder': return <svg viewBox="0 0 24 24" style={s}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
    case 'template': return <svg viewBox="0 0 24 24" style={s}><rect x="5" y="4" width="14" height="16" rx="1"/><path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2H9V4z"/><path d="M7 10h10"/><path d="M7 13h10"/><path d="M7 16h8"/></svg>;
    case 'search': return <svg viewBox="0 0 24 24" style={s}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'plus': return <svg viewBox="0 0 24 24" style={s}><path d="M12 5v14M5 12h14"/></svg>;
    /* UX (KAL-64): every modal close is this drawn icon, never a typed "×"
       character. A text glyph renders at whatever the system font decides,
       so close buttons drifted in weight between dialogs. Same two strokes as
       `close` in src/Icons.jsx, redrawn at the hub's 1.6 stroke width. */
    case 'close': return <svg viewBox="0 0 24 24" style={s}><path d="M18 6L6 18"/><path d="M6 6L18 18"/></svg>;
    case 'upload': return <svg viewBox="0 0 24 24" style={s}><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>;
    case 'filter': return <svg viewBox="0 0 24 24" style={s}><path d="M3 5h18M6 12h12M10 19h4"/></svg>;
    case 'menu': return <svg viewBox="0 0 24 24" style={s}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
    case 'more': return <svg viewBox="0 0 24 24" style={s}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
    case 'clock': return <svg viewBox="0 0 24 24" style={s}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case 'users': return <svg viewBox="0 0 24 24" style={s}><circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M17 11a3 3 0 1 0-2-5"/><path d="M22 19a5 5 0 0 0-5-5"/></svg>;
    case 'check': return <svg viewBox="0 0 24 24" style={s}><path d="m5 12 4.5 4.5L20 6"/></svg>;
    case 'arrow-r': return <svg viewBox="0 0 24 24" style={s}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case 'trash': return <svg viewBox="0 0 24 24" style={s}><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6"/></svg>;
    case 'share': return <svg viewBox="0 0 24 24" style={s}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>;
    case 'lock': return <svg viewBox="0 0 24 24" style={s}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
    case 'settings': return (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size, fill: color }} xmlns="http://www.w3.org/2000/svg">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 8.25C9.92894 8.25 8.25 9.92893 8.25 12C8.25 14.0711 9.92894 15.75 12 15.75C14.0711 15.75 15.75 14.0711 15.75 12C15.75 9.92893 14.0711 8.25 12 8.25ZM9.75 12C9.75 10.7574 10.7574 9.75 12 9.75C13.2426 9.75 14.25 10.7574 14.25 12C14.25 13.2426 13.2426 14.25 12 14.25C10.7574 14.25 9.75 13.2426 9.75 12Z" />
        <path fillRule="evenodd" clipRule="evenodd" d="M11.9747 1.25C11.5303 1.24999 11.1592 1.24999 10.8546 1.27077C10.5375 1.29241 10.238 1.33905 9.94761 1.45933C9.27379 1.73844 8.73843 2.27379 8.45932 2.94762C8.31402 3.29842 8.27467 3.66812 8.25964 4.06996C8.24756 4.39299 8.08454 4.66251 7.84395 4.80141C7.60337 4.94031 7.28845 4.94673 7.00266 4.79568C6.64714 4.60777 6.30729 4.45699 5.93083 4.40743C5.20773 4.31223 4.47642 4.50819 3.89779 4.95219C3.64843 5.14353 3.45827 5.3796 3.28099 5.6434C3.11068 5.89681 2.92517 6.21815 2.70294 6.60307L2.67769 6.64681C2.45545 7.03172 2.26993 7.35304 2.13562 7.62723C1.99581 7.91267 1.88644 8.19539 1.84541 8.50701C1.75021 9.23012 1.94617 9.96142 2.39016 10.5401C2.62128 10.8412 2.92173 11.0602 3.26217 11.2741C3.53595 11.4461 3.68788 11.7221 3.68786 12C3.68785 12.2778 3.53592 12.5538 3.26217 12.7258C2.92169 12.9397 2.62121 13.1587 2.39007 13.4599C1.94607 14.0385 1.75012 14.7698 1.84531 15.4929C1.88634 15.8045 1.99571 16.0873 2.13552 16.3727C2.26983 16.6469 2.45535 16.9682 2.67758 17.3531L2.70284 17.3969C2.92507 17.7818 3.11058 18.1031 3.28089 18.3565C3.45817 18.6203 3.64833 18.8564 3.89769 19.0477C4.47632 19.4917 5.20763 19.6877 5.93073 19.5925C6.30717 19.5429 6.647 19.3922 7.0025 19.2043C7.28833 19.0532 7.60329 19.0596 7.8439 19.1986C8.08452 19.3375 8.24756 19.607 8.25964 19.9301C8.27467 20.3319 8.31403 20.7016 8.45932 21.0524C8.73843 21.7262 9.27379 22.2616 9.94761 22.5407C10.238 22.661 10.5375 22.7076 10.8546 22.7292C11.1592 22.75 11.5303 22.75 11.9747 22.75H12.0252C12.4697 22.75 12.8407 22.75 13.1454 22.7292C13.4625 22.7076 13.762 22.661 14.0524 22.5407C14.7262 22.2616 15.2616 21.7262 15.5407 21.0524C15.686 20.7016 15.7253 20.3319 15.7403 19.93C15.7524 19.607 15.9154 19.3375 16.156 19.1985C16.3966 19.0596 16.7116 19.0532 16.9974 19.2042C17.3529 19.3921 17.6927 19.5429 18.0692 19.5924C18.7923 19.6876 19.5236 19.4917 20.1022 19.0477C20.3516 18.8563 20.5417 18.6203 20.719 18.3565C20.8893 18.1031 21.0748 17.7818 21.297 17.3969L21.3223 17.3531C21.5445 16.9682 21.7301 16.6468 21.8644 16.3726C22.0042 16.0872 22.1135 15.8045 22.1546 15.4929C22.2498 14.7697 22.0538 14.0384 21.6098 13.4598C21.3787 13.1586 21.0782 12.9397 20.7378 12.7258C20.464 12.5538 20.3121 12.2778 20.3121 11.9999C20.3121 11.7221 20.464 11.4462 20.7377 11.2742C21.0783 11.0603 21.3788 10.8414 21.6099 10.5401C22.0539 9.96149 22.2499 9.23019 22.1547 8.50708C22.1136 8.19546 22.0043 7.91274 21.8645 7.6273C21.7302 7.35313 21.5447 7.03183 21.3224 6.64695L21.2972 6.60318C21.0749 6.21825 20.8894 5.89688 20.7191 5.64347C20.5418 5.37967 20.3517 5.1436 20.1023 4.95225C19.5237 4.50826 18.7924 4.3123 18.0692 4.4075C17.6928 4.45706 17.353 4.60782 16.9975 4.79572C16.7117 4.94679 16.3967 4.94036 16.1561 4.80144C15.9155 4.66253 15.7524 4.39297 15.7403 4.06991C15.7253 3.66808 15.686 3.2984 15.5407 2.94762C15.2616 2.27379 14.7262 1.73844 14.0524 1.45933C13.762 1.33905 13.4625 1.29241 13.1454 1.27077C12.8407 1.24999 12.4697 1.24999 12.0252 1.25H11.9747ZM10.5216 2.84515C10.5988 2.81319 10.716 2.78372 10.9567 2.76729C11.2042 2.75041 11.5238 2.75 12 2.75C12.4762 2.75 12.7958 2.75041 13.0432 2.76729C13.284 2.78372 13.4012 2.81319 13.4783 2.84515C13.7846 2.97202 14.028 3.21536 14.1548 3.52165C14.1949 3.61826 14.228 3.76887 14.2414 4.12597C14.271 4.91835 14.68 5.68129 15.4061 6.10048C16.1321 6.51968 16.9974 6.4924 17.6984 6.12188C18.0143 5.9549 18.1614 5.90832 18.265 5.89467C18.5937 5.8514 18.9261 5.94047 19.1891 6.14228C19.2554 6.19312 19.3395 6.27989 19.4741 6.48016C19.6125 6.68603 19.7726 6.9626 20.0107 7.375C20.2488 7.78741 20.4083 8.06438 20.5174 8.28713C20.6235 8.50382 20.6566 8.62007 20.6675 8.70287C20.7108 9.03155 20.6217 9.36397 20.4199 9.62698C20.3562 9.70995 20.2424 9.81399 19.9397 10.0041C19.2684 10.426 18.8122 11.1616 18.8121 11.9999C18.8121 12.8383 19.2683 13.574 19.9397 13.9959C20.2423 14.186 20.3561 14.29 20.4198 14.373C20.6216 14.636 20.7107 14.9684 20.6674 15.2971C20.6565 15.3799 20.6234 15.4961 20.5173 15.7128C20.4082 15.9355 20.2487 16.2125 20.0106 16.6249C19.7725 17.0373 19.6124 17.3139 19.474 17.5198C19.3394 17.72 19.2553 17.8068 19.189 17.8576C18.926 18.0595 18.5936 18.1485 18.2649 18.1053C18.1613 18.0916 18.0142 18.045 17.6983 17.8781C16.9973 17.5075 16.132 17.4803 15.4059 17.8995C14.68 18.3187 14.271 19.0816 14.2414 19.874C14.228 20.2311 14.1949 20.3817 14.1548 20.4784C14.028 20.7846 13.7846 21.028 13.4783 21.1549C13.4012 21.1868 13.284 21.2163 13.0432 21.2327C12.7958 21.2496 12.4762 21.25 12 21.25C11.5238 21.25 11.2042 21.2496 10.9567 21.2327C10.716 21.2163 10.5988 21.1868 10.5216 21.1549C10.2154 21.028 9.97201 20.7846 9.84514 20.4784C9.80512 20.3817 9.77195 20.2311 9.75859 19.874C9.72896 19.0817 9.31997 18.3187 8.5939 17.8995C7.86784 17.4803 7.00262 17.5076 6.30158 17.8781C5.98565 18.0451 5.83863 18.0917 5.73495 18.1053C5.40626 18.1486 5.07385 18.0595 4.81084 17.8577C4.74458 17.8069 4.66045 17.7201 4.52586 17.5198C4.38751 17.314 4.22736 17.0374 3.98926 16.625C3.75115 16.2126 3.59171 15.9356 3.4826 15.7129C3.37646 15.4962 3.34338 15.3799 3.33248 15.2971C3.28921 14.9684 3.37828 14.636 3.5801 14.373C3.64376 14.2901 3.75761 14.186 4.0602 13.9959C4.73158 13.5741 5.18782 12.8384 5.18786 12.0001C5.18791 11.1616 4.73165 10.4259 4.06021 10.004C3.75769 9.81389 3.64385 9.70987 3.58019 9.62691C3.37838 9.3639 3.28931 9.03149 3.33258 8.7028C3.34348 8.62001 3.37656 8.50375 3.4827 8.28707C3.59181 8.06431 3.75125 7.78734 3.98935 7.37493C4.22746 6.96253 4.3876 6.68596 4.52596 6.48009C4.66055 6.27983 4.74468 6.19305 4.81093 6.14222C5.07395 5.9404 5.40636 5.85133 5.73504 5.8946C5.83873 5.90825 5.98576 5.95483 6.30173 6.12184C7.00273 6.49235 7.86791 6.51962 8.59394 6.10045C9.31998 5.68128 9.72896 4.91837 9.75859 4.12602C9.77195 3.76889 9.80512 3.61827 9.84514 3.52165C9.97201 3.21536 10.2154 2.97202 10.5216 2.84515Z" />
      </svg>
    );
    case 'signout': return <svg viewBox="0 0 24 24" style={s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>;
    default: return null;
  }
};

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
          aria-label={placeholder}
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
                  type="button"
                  role="menuitem"
                  className={tab === 'archive' ? 'active' : ''}
                  style={{ ...itemStyle, color: tab === 'archive' ? 'var(--gold)' : itemStyle.color }}
                  onClick={() => { setOpen(false); setConfirmSignOut(false); onNav && onNav('archive'); }}
                >
                  <Icon name="clock" size={15} color={tab === 'archive' ? 'var(--gold)' : 'var(--ink-200)'} />Archive
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                style={itemStyle}
                onClick={() => { setOpen(false); setConfirmSignOut(false); onSettings && onSettings(); }}
              >
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
                <button
                  type="button"
                  role="menuitem"
                  className="profile-menu-signout"
                  style={{ ...itemStyle, color: '#d95a56' }}
                  onClick={() => setConfirmSignOut(true)}
                >
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

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

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
      type="button"
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
          {children}
        </main>
        <nav className="mobile-home-tabs" aria-label="Home sections">
          {navItems.map(([key, icon, label, disabled]) => navBtn(key, icon, label, disabled))}
        </nav>
      </div>
    </div>
  );
};
