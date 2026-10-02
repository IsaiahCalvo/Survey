/**
 * pageSelectionPresence — "is anything selected, and on which page?" for the
 * viewer-level press and key rules (Drawboard PDF rules 6 + 10, owner
 * 2026-10-02; rule table in utils/selectModes.js).
 *
 * Each SVG page layer already announces its pick (marks, callouts, counters,
 * Survey Markers) on every change through the History panel's window event
 * (historyMarkFilter.broadcastPageSelection), and an empty pick when it goes
 * away. This module listens once, at load, and keeps the count per page, so
 * the Text and Counter overlays and the Escape handler can ask at press time
 * without another React state.
 */
import { HISTORY_PAGE_SELECTION_EVENT } from './historyMarkFilter.js';
import { getAnnotationRenderIdentity } from './annotationStorageIdentity.js';

// Kept on window so a dev hot-reload of this module reads the same counts the
// one installed listener writes.
const countsByPage = (typeof window !== 'undefined')
  ? (window.__surveyPageSelectionCounts || (window.__surveyPageSelectionCounts = new Map()))
  : new Map();

const idsByPage = (typeof window !== 'undefined')
  ? (window.__surveyPageSelectionIds || (window.__surveyPageSelectionIds = new Map()))
  : new Map();

/** Is this mark / callout / marker id part of the page's current pick? */
export function isItemSelected(pageNumber, id) {
  if (id == null) return false;
  return !!idsByPage.get(Number(pageNumber))?.has(String(id));
}

export function pageHasSelection(pageNumber) {
  return (countsByPage.get(Number(pageNumber)) || 0) > 0;
}

// Drawboard rule 12 (owner 2026-10-02): a page change never drops the
// selection. A page layer far from view unmounts (and its pick with it), so it
// leaves the pick here by id and takes it back when it mounts again. Only one
// page's pick is kept; a new pick on another page, or any clear, drops it.
let stashedSelection = null; // { pageNumber, documentId, markIds:Set, markerIds:Set }
export function stashPageSelection(pageNumber, { documentId = null, markIds = [], markerIds = [] } = {}) {
  if (!markIds.length && !markerIds.length) return;
  stashedSelection = {
    pageNumber: Number(pageNumber),
    documentId: documentId || null,
    markIds: new Set(markIds.map(String)),
    markerIds: new Set(markerIds.map(String)),
  };
}
export function peekStashedSelection(pageNumber, documentId = null) {
  if (!stashedSelection || stashedSelection.pageNumber !== Number(pageNumber)) return null;
  if (stashedSelection.documentId !== (documentId || null)) return null;
  return stashedSelection;
}
export function dropStashedSelection() {
  stashedSelection = null;
}

export function hasAnyPageSelection() {
  for (const count of countsByPage.values()) if (count > 0) return true;
  return !!stashedSelection;
}

export function recordPageSelection(pageNumber, items) {
  const page = Number(pageNumber);
  if (!Number.isFinite(page)) return;
  const count = Array.isArray(items) ? items.length : 0;
  if (count > 0) {
    // A pick made on another page replaces the one a far page left behind.
    if (stashedSelection && stashedSelection.pageNumber !== page) stashedSelection = null;
    countsByPage.set(page, count);
    idsByPage.set(page, new Set(items.map((item) => String(item?.id))));
  } else {
    countsByPage.delete(page);
    idsByPage.delete(page);
  }
}

export function installPageSelectionPresence(win) {
  if (!win || typeof win.addEventListener !== 'function' || win.__surveyPageSelectionPresence) return;
  win.__surveyPageSelectionPresence = true;
  win.addEventListener(HISTORY_PAGE_SELECTION_EVENT, (event) => {
    recordPageSelection(event?.detail?.pageNumber, event?.detail?.items);
  });
}

if (typeof window !== 'undefined') installPageSelectionPresence(window);

/** Every picked id on every page (marks, callouts, counters, Survey Markers). */
export function getAllSelectedItemIds() {
  const all = new Set();
  for (const ids of idsByPage.values()) for (const id of ids) all.add(id);
  return all;
}

// Drawboard rule 5 (owner 2026-10-02): the eraser never touches the selected
// mark. The viewer notes the selection as an eraser press lands (and then
// drops the selection); FabricEraserCanvas's one erase gate skips these ids
// for that stroke, live preview and commit alike.
let eraseSparedIds = null;
export function setEraseSparedIds(ids) {
  eraseSparedIds = ids && ids.size ? new Set([...ids].map(String)) : null;
}
export function isEraseSpared(object) {
  if (!eraseSparedIds || !object) return false;
  const id = getAnnotationRenderIdentity(object)?.annotationId;
  return id != null && eraseSparedIds.has(String(id));
}
