/**
 * panelLayoutStore.js - how wide the desktop left-rail panel is, and which
 * panel was open, remembered per user across reloads.
 *
 * Owner 2026-10-14: "It can barely be resized. I think we should just pick
 * one size. Pick the smallest size that makes sense for all the tabs, where
 * everything fits nicely, and leave it that way." So every panel (Pages,
 * Search, Bookmarks, Spaces, History) is LEFT_PANEL_WIDTH wide. There is no
 * drag edge and no remembered width any more (a width saved by the old
 * resizable panel is ignored).
 *
 * Why 260: each tab was opened in Chromium at 1440x900 on a 36-page PDF with
 * nested bookmarks and long names, and narrowed until something broke.
 * Pages keeps its thumbnails at their full 200px down to ~224; Search,
 * Bookmarks and Spaces keep every control, icon and the search box whole
 * down to ~220-240 (long names end in "..." at any width); History's colour
 * key (Added / Edited / Deleted / Restored) drops "Restored" to a second line
 * below 252. History sets the minimum; 260 is the next clean number.
 *
 * One safety stays (batch-7 tablet check 2026-10-13): an open panel always
 * leaves MIN_VIEWER_VISIBLE px of the window for the document beside whatever
 * covers the RIGHT side (the right rail, and the 320px Survey panel while it
 * is open), and in Survey it stops short of the survey bar's centre group.
 * On a 1180px iPad and anything wider that never bites - the panel is 260 -
 * it only narrows the panel on a smaller window (a 1024px iPad with the
 * Survey panel open), never below LEFT_PANEL_MIN_WIDTH.
 *
 * Pure apart from the two storage helpers, which take the Storage object and
 * never throw (private windows, blocked storage and quota errors all fall
 * back to the defaults).
 */

import { SURVEY_BAR_PARTS, surveyRowWidth } from '../utils/responsiveToolbar.js';

export const LEFT_RAIL_WIDTH = 48;
/** The one width of every desktop left panel (see above for why 260). */
export const LEFT_PANEL_WIDTH = 260;
/** The narrowest a too-small window may squeeze the panel to. */
export const LEFT_PANEL_MIN_WIDTH = 200;
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

const STORAGE_PREFIX = 'survey.leftPanelLayout.v1';

const isPanelId = (id) => PANEL_IDS.includes(id);

/**
 * The open panel's width in a window `viewportWidth` px wide: LEFT_PANEL_WIDTH,
 * unless that would leave less than MIN_VIEWER_VISIBLE px of document between
 * the left rail and `room.rightCover` (what covers the window's right side:
 * the right rail, plus the Survey panel while it is open), or - with
 * `room.surveyCentreX` (the survey bar's centre spot in window px, while the
 * bar is up) - reach within SURVEY_CENTRE_CLEARANCE of that spot. Never below
 * LEFT_PANEL_MIN_WIDTH (a tiny window gets that).
 */
export function leftPanelWidth(viewportWidth, room = null) {
  const vw = Number(viewportWidth);
  if (!Number.isFinite(vw) || vw <= 0) return LEFT_PANEL_WIDTH;
  const rightCover = Math.max(0, Number(room?.rightCover) || 0);
  let limit = Math.floor(vw - LEFT_RAIL_WIDTH - rightCover - MIN_VIEWER_VISIBLE);
  const centreX = Number(room?.surveyCentreX);
  if (room?.surveyCentreX != null && Number.isFinite(centreX)) {
    limit = Math.min(limit, Math.floor(centreX - LEFT_RAIL_WIDTH - SURVEY_CENTRE_CLEARANCE));
  }
  return Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(LEFT_PANEL_WIDTH, limit));
}

export function storageKeyForUser(userId, documentId = null) {
  const id = typeof userId === 'string' && userId.trim() ? userId.trim() : 'local';
  return `${STORAGE_PREFIX}:${id}${documentId ? `:document:${encodeURIComponent(String(documentId))}` : ''}`;
}

export const DEFAULT_PANEL_LAYOUT = Object.freeze({ open: false, panel: 'pages' });

/**
 * Keep only what this store understands (a hand-edited or old value never
 * breaks the rail). The `widths` the resizable panel used to save are dropped.
 */
export function normalizePanelLayout(value) {
  if (!value || typeof value !== 'object') return DEFAULT_PANEL_LAYOUT;
  return {
    open: value.open === true,
    panel: isPanelId(value.panel) ? value.panel : 'pages',
  };
}

export function readPanelLayout(storage, userId, documentId = null) {
  try {
    const raw = storage?.getItem?.(storageKeyForUser(userId, documentId));
    if (!raw) return DEFAULT_PANEL_LAYOUT;
    return normalizePanelLayout(JSON.parse(raw));
  } catch {
    return DEFAULT_PANEL_LAYOUT;
  }
}

export function writePanelLayout(storage, userId, layout, documentId = null) {
  try {
    if (!storage?.setItem) return false;
    storage.setItem(storageKeyForUser(userId, documentId), JSON.stringify(normalizePanelLayout(layout)));
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
