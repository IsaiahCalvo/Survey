/**
 * panelLayoutStore.js — how wide each desktop left-rail panel is, and whether
 * the rail was open, remembered per user across reloads.
 *
 * Owner 2026-10-13 (Drawboard app-shell audit, Chunk D; scratchpad
 * drawboardDeep/SHELL.md §4): Drawboard lets you drag a side panel's edge and
 * keeps each panel's width (its `canvas-panel-layout` store survives reloads).
 * Survey copies that: every panel has its own starting width and limits, a
 * drag or the keyboard changes it, a double-click on the edge puts it back,
 * and the widths plus "which panel was open" come back on the next visit.
 *
 * Widths (Drawboard's, measured): Search / Bookmarks / Spaces / History start
 * at 340 and go from 280 to 1200. Pages starts at 224, not Drawboard's 180:
 * a Pages thumbnail stops growing at 200px (pageThumbnailBox.js), and 224 is
 * the width at which it reaches that size, so the page pictures stay exactly
 * as big as they were while the panel gets narrower than the old 272. Pages
 * goes from 120 to 480 (wider only ever added empty margin).
 *
 * Whatever the limits say, an open panel always leaves MIN_VIEWER_VISIBLE px
 * of the window for the document (a window narrowed later clamps the width
 * it shows; the stored width is kept for a wider window).
 *
 * Pure apart from the two storage helpers, which take the Storage object and
 * never throw (private windows, blocked storage and quota errors all fall
 * back to the defaults).
 */

export const LEFT_RAIL_WIDTH = 48;
export const MIN_VIEWER_VISIBLE = 360;
export const PANEL_IDS = Object.freeze(['pages', 'search', 'bookmarks', 'spaces', 'history']);

const WIDE = Object.freeze({ initial: 340, min: 280, max: 1200 });
export const PANEL_WIDTHS = Object.freeze({
  pages: Object.freeze({ initial: 224, min: 120, max: 480 }),
  search: WIDE,
  bookmarks: WIDE,
  spaces: WIDE,
  history: WIDE,
});

/** Arrow keys on the edge move it this far (Shift: the larger step). */
export const KEYBOARD_STEP = 16;
export const KEYBOARD_STEP_LARGE = 64;

const STORAGE_PREFIX = 'survey.leftPanelLayout.v1';

const isPanelId = (id) => PANEL_IDS.includes(id);

export function panelWidthSpec(panelId) {
  return PANEL_WIDTHS[panelId] || PANEL_WIDTHS.pages;
}

/**
 * The widest a panel may be in a window `viewportWidth` px wide: its own max,
 * but never so wide that less than MIN_VIEWER_VISIBLE px of document is left
 * beside the rail. Never below the panel's min (a tiny window gets the min).
 */
export function panelMaxWidth(panelId, viewportWidth) {
  const spec = panelWidthSpec(panelId);
  const vw = Number(viewportWidth);
  if (!Number.isFinite(vw) || vw <= 0) return spec.max;
  const room = Math.floor(vw - LEFT_RAIL_WIDTH - MIN_VIEWER_VISIBLE);
  return Math.max(spec.min, Math.min(spec.max, room));
}

/**
 * A width for this panel inside its limits (whole px). No width (or one that
 * is not a number) -> its initial width; any number, however small or
 * negative (a drag that ran off the window's left edge), -> its min.
 */
export function clampPanelWidth(panelId, width, viewportWidth) {
  const spec = panelWidthSpec(panelId);
  const n = width === null || width === undefined || width === '' ? NaN : Number(width);
  const value = Number.isFinite(n) ? n : spec.initial;
  return Math.round(Math.min(panelMaxWidth(panelId, viewportWidth), Math.max(spec.min, value)));
}

/** The width a drag of the panel's right edge from `startX` to `x` gives. */
export function widthFromDrag({ panelId, startWidth, startX, x, viewportWidth }) {
  return clampPanelWidth(panelId, Number(startWidth) + (Number(x) - Number(startX)), viewportWidth);
}

/**
 * The width a key on the focused edge gives, or null when the key does
 * nothing there. Left/Right step it, Shift for a bigger step; Home / End go
 * to the narrowest / widest; Enter puts back the starting width (the
 * keyboard's double-click).
 */
export function widthFromKey({ panelId, width, key, shiftKey = false, viewportWidth }) {
  const spec = panelWidthSpec(panelId);
  const step = shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
  switch (key) {
    case 'ArrowLeft': return clampPanelWidth(panelId, Number(width) - step, viewportWidth);
    case 'ArrowRight': return clampPanelWidth(panelId, Number(width) + step, viewportWidth);
    case 'Home': return clampPanelWidth(panelId, spec.min, viewportWidth);
    case 'End': return panelMaxWidth(panelId, viewportWidth);
    case 'Enter': return clampPanelWidth(panelId, spec.initial, viewportWidth);
    default: return null;
  }
}

export function storageKeyForUser(userId) {
  const id = typeof userId === 'string' && userId.trim() ? userId.trim() : 'local';
  return `${STORAGE_PREFIX}:${id}`;
}

export const DEFAULT_PANEL_LAYOUT = Object.freeze({ widths: Object.freeze({}), open: false, panel: 'pages' });

/** Keep only what this store understands (a hand-edited or old value never breaks the rail). */
export function normalizePanelLayout(value) {
  if (!value || typeof value !== 'object') return DEFAULT_PANEL_LAYOUT;
  const widths = {};
  if (value.widths && typeof value.widths === 'object') {
    for (const id of PANEL_IDS) {
      const n = Number(value.widths[id]);
      if (Number.isFinite(n) && n > 0) widths[id] = Math.round(n);
    }
  }
  return {
    widths,
    open: value.open === true,
    panel: isPanelId(value.panel) ? value.panel : 'pages',
  };
}

export function readPanelLayout(storage, userId) {
  try {
    const raw = storage?.getItem?.(storageKeyForUser(userId));
    if (!raw) return DEFAULT_PANEL_LAYOUT;
    return normalizePanelLayout(JSON.parse(raw));
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}

export function writePanelLayout(storage, userId, layout) {
  try {
    if (!storage?.setItem) return false;
    storage.setItem(storageKeyForUser(userId), JSON.stringify(normalizePanelLayout(layout)));
    return true;
  } catch {
    return false;
  }
}

/** window.localStorage, or null where reading it throws. */
export function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
