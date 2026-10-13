/**
 * ActiveSpaceChip.jsx — "Space 2 · 3 pages ✕", the active space named outside
 * the Spaces panel (Spaces chunk B, 2026-10-01 audit finding 6: with a space
 * on, nothing outside the panel said which one, so the user could not tell
 * which space new Survey Markers and marks would be tagged with).
 *
 * Rendered by AppShell in the desktop tool bar (left of Export) and by the
 * phone header (MobilePdfViewerChrome) just under the top bar. The words open
 * the Spaces panel; ✕ turns the space off (the same handler as the panel's
 * switch). Styles: .active-space-chip in styles.css.
 */
import React from 'react';
import Icon from '../Icons';

export default function ActiveSpaceChip({ name, pageCount = 0, onOpen = null, onTurnOff = null, className = '', ...rest }) {
  const label = name || 'Space';
  const pages = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;
  return (
    <div className={`active-space-chip${className ? ` ${className}` : ''}`} data-active-space-chip="true" {...rest}>
      <button
        type="button"
        className="active-space-chip__open"
        aria-label={`${label} is on, ${pages}. Open Spaces`}
        onClick={onOpen || undefined}
      >
        <Icon name="layers" size={12} color="currentColor" />
        <span className="active-space-chip__name">{label}</span>
        <span className="active-space-chip__meta">· {pages}</span>
      </button>
      <button
        type="button"
        className="active-space-chip__off"
        aria-label={`Turn off ${label}`}
        onClick={onTurnOff || undefined}
      >
        <Icon name="close" size={10} color="currentColor" />
      </button>
    </div>
  );
}
