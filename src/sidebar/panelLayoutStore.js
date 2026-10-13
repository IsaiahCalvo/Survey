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
 * of the window for the document beside whatever covers the RIGHT side too
 * (the right rail, and the 320px Survey panel while it is open), and in
 * Survey it stops short of the survey bar's centre group (batch-7 tablet
 * check 2026-10-13: at 1024px with the Survey panel open the Pages panel
 * could reach 480px, leaving ~130px of document and covering the bar's
 * chips). A narrower window or a right panel opening later clamps the width
 * it SHOWS; the stored width is kept and comes back when the room does.
 *
 * Pure apart from the two storage helpers, which take the Storage object and
 * never throw (private windows, blocked storage and quota errors all fall
 * back to the defaults).
 */

import { SURVEY_BAR_PARTS, surveyRowWidth } from '../utils/responsiveToolbar.js';

export const LEFT_RAIL_WIDTH = 48;
/** The least document an open left panel leaves (about 40% of a 1024px iPad). */
export const MIN_VIEWER_VISIBLE = 400;

/**
 * In Survey: what the survey bar must keep between the left panel's edge and
 * its centre spot (the tool bar's centre, where the centre group is pinned):
 * the bar's inset, the start piece's smallest look (template glyph + More),
 * the gutter, and half of the centre's smallest steady look - four chips and
 * "All N" on the tight gutter (planSurveyBar's ROW_STABLE_MIN), so the chips
 * never run under the panel and the plan does not fall to its last resort.
 */
const P = SURVEY_BAR_PARTS;
export const SURVEY_CENTRE_CLEARANCE = Math.ceil(
  P.inset + P.templateGlyph + P.moreGap + P.more + P.gap
  + surveyRowWidth({ count: 99, item: P.chip, gap: P.chipGapTight, allChip: P.allChip, max: 5 }) / 2,
);
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
 * between the left rail and `room.rightCover` (what covers the window's right
 * side: the right rail, plus the Survey panel while it is open), and - with
 * `room.surveyCentreX` (the survey bar's centre spot in window px, while the
 * bar is up) - never within SURVEY_CENTRE_CLEARANCE of that spot. Never below
 * the panel's min (a tiny window gets the min).
 */
export function panelMaxWidth(panelId, viewportWidth, room = null) {
  const spec = panelWidthSpec(panelId);
  const vw = Number(viewportWidth);
  if (!Number.isFinite(vw) || vw <= 0) return spec.max;
  const rightCover = Math.max(0, Number(room?.rightCover) || 0);
  let limit = Math.floor(vw - LEFT_RAIL_WIDTH - rightCover - MIN_VIEWER_VISIBLE);
  const centreX = Number(room?.surveyCentreX);
  if (room?.surveyCentreX != null && Number.isFinite(centreX)) {
    limit = Math.min(limit, Math.floor(centreX - LEFT_RAIL_WIDTH - SURVEY_CENTRE_CLEARANCE));
  }
  return Math.max(spec.min, Math.min(spec.max, limit));
}

/**
 * A width for this panel inside its limits (whole px). No width (or one that
 * is not a number) -> its initial width; any number, however small or
 * negative (a drag that ran off the window's left edge), -> its min.
 */
export function clampPanelWidth(panelId, width, viewportWidth, room = null) {
  const spec = panelWidthSpec(panelId);
  const n = width === null || width === undefined || width === '' ? NaN : Number(width);
  const value = Number.isFinite(n) ? n : spec.initial;
  return Math.round(Math.min(panelMaxWidth(panelId, viewportWidth, room), Math.max(spec.min, value)));
}

/** The width a drag of the panel's right edge from `startX` to `x` gives. */
export function widthFromDrag({ panelId, startWidth, startX, x, viewportWidth, room = null }) {
  return clampPanelWidth(panelId, Number(startWidth) + (Number(x) - Number(startX)), viewportWidth, room);
}

/**
 * The width a key on the focused edge gives, or null when the key does
 * nothing there. Left/Right step it, Shift for a bigger step; Home / End go
 * to the narrowest / widest; Enter puts back the starting width (the
 * keyboard's double-click).
 */
export function widthFromKey({ panelId, width, key, shiftKey = false, viewportWidth, room = null }) {
  const spec = panelWidthSpec(panelId);
  const step = shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
  switch (key) {
    case 'ArrowLeft': return clampPanelWidth(panelId, Number(width) - step, viewportWidth, room);
    case 'ArrowRight': return clampPanelWidth(panelId, Number(width) + step, viewportWidth, room);
    case 'Home': return clampPanelWidth(panelId, spec.min, viewportWidth, room);
    case 'End': return panelMaxWidth(panelId, viewportWidth, room);
    case 'Enter': return clampPanelWidth(panelId, spec.initial, viewportWidth, room);
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

/*
 * What covers the window beside the left panel, published by the chrome that
 * owns it: SurveySpacesRail (`rightCover`: its 48px rail, + 320 while the
 * Survey panel is drawn) and useSurveyBarFit (`surveyCentreX`: the survey
 * bar's centre spot in window px while the bar is up, else null). PDFSidebar
 * reads it (useSyncExternalStore) to limit the open panel's width.
 */
let sideRoom = Object.freeze({ rightCover: LEFT_RAIL_WIDTH, surveyCentreX: null });
const sideRoomListeners = new Set();

export function getSideRoom() {
  return sideRoom;
}

export function subscribeSideRoom(listener) {
  sideRoomListeners.add(listener);
  return () => sideRoomListeners.delete(listener);
}

/** Merge `patch` in; listeners hear only a real change (whole px). */
export function publishSideRoom(patch = {}) {
  const next = { ...sideRoom };
  if ('rightCover' in patch) next.rightCover = Math.max(0, Math.round(Number(patch.rightCover) || 0));
  if ('surveyCentreX' in patch) {
    const x = Number(patch.surveyCentreX);
    next.surveyCentreX = patch.surveyCentreX == null || !Number.isFinite(x) ? null : Math.round(x);
  }
  if (next.rightCover === sideRoom.rightCover && next.surveyCentreX === sideRoom.surveyCentreX) return false;
  sideRoom = Object.freeze(next);
  sideRoomListeners.forEach((listener) => { try { listener(); } catch { /* a listener never breaks the others */ } });
  return true;
}
