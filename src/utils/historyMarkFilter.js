/**
 * historyMarkFilter.js — w64 (owner 2026-09-29): picking a mark on the page
 * while History is open shows that mark's history.
 *
 * UX: with the History panel open, selecting a mark (or several) on the page
 * jumps the list to that mark's lines: the newest line is scrolled into view
 * and becomes the selected line (gold glyph only), and a small bar at the top
 * reads "Showing history for this rectangle · Clear". The list shows only
 * those marks' lines until Clear, Esc, deselecting, or picking another mark.
 * Reference behaviour: Figma / Miro — select an object, the activity panel
 * narrows to that object.
 *
 * The page tells the panel what is picked with a window event
 * (HISTORY_PAGE_SELECTION_EVENT, one per page layer: { pageNumber, items });
 * everything else here is pure and node-tested (tests/historyMarkFilter.test.mjs).
 */

export const HISTORY_PAGE_SELECTION_EVENT = 'annotations:page-selection';

/**
 * A page layer tells the History panel what is picked on its page. Uses the
 * window's own event class (a test DOM has its own), and never throws: a
 * failed broadcast must never break the page.
 */
export function broadcastPageSelection(win, pageNumber, items) {
  if (!win || typeof win.dispatchEvent !== 'function') return false;
  try {
    const EventClass = win.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
    if (!EventClass) return false;
    win.dispatchEvent(new EventClass(HISTORY_PAGE_SELECTION_EVENT, {
      detail: { pageNumber, items: Array.isArray(items) ? items : [] },
    }));
    return true;
  } catch (_err) {
    return false;
  }
}

// Older rows are fetched a page at a time until the mark's lines turn up —
// never more than this many extra pages for one pick (Load older still works).
export const HISTORY_MARK_LOOKUP_MAX_PAGES = 8;

const SINGULAR = {
  rect: 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
  polyline: 'polyline',
  polygon: 'polygon',
  cloud: 'cloud',
  pen: 'pen stroke',
  highlighter: 'highlighter stroke',
  text: 'text box',
  callout: 'callout',
  counter: 'counter',
  surveyMarker: 'Survey Marker',
  image: 'image',
  markup: 'text highlight',
  mark: 'mark',
};

function plural(word) {
  return /(x|s|sh|ch)$/.test(word) ? `${word}es` : `${word}s`;
}

/** One pick item: { id: string, typeKey: string }. Drops blanks and repeats. */
export function normalizeSelectionItems(items) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const id = item?.id != null ? String(item.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, typeKey: SINGULAR[item?.typeKey] ? item.typeKey : 'mark' });
  }
  return out;
}

/**
 * Every page layer reports its own pick; the whole pick is their union.
 * `byPage` is a Map (or object) of pageNumber -> items.
 */
export function mergePageSelections(byPage) {
  const entries = byPage instanceof Map ? [...byPage.entries()] : Object.entries(byPage || {});
  entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  return normalizeSelectionItems(entries.flatMap(([, items]) => items || []));
}

/** A stable key for a pick (order-free), '' for nothing picked. */
export function selectionKey(items) {
  return normalizeSelectionItems(items).map((item) => item.id).sort().join('|');
}

/** "this rectangle", "these 2 counters", "these 3 marks". */
export function historyMarkFilterNoun(items) {
  const list = normalizeSelectionItems(items);
  if (list.length === 0) return 'this mark';
  const types = new Set(list.map((item) => item.typeKey));
  const word = types.size === 1 ? SINGULAR[list[0].typeKey] : 'mark';
  return list.length === 1 ? `this ${word}` : `these ${list.length} ${plural(word)}`;
}

/** The bar's words: "Showing history for this rectangle". */
export function historyMarkFilterLabel(items) {
  return `Showing history for ${historyMarkFilterNoun(items)}`;
}

/** Nothing found (after looking back as far as allowed). */
export function historyMarkFilterEmptyText(items, { searchedAll = true } = {}) {
  const noun = historyMarkFilterNoun(items);
  const subject = noun.charAt(0).toUpperCase() + noun.slice(1);
  const verb = normalizeSelectionItems(items).length > 1 ? 'have' : 'has';
  return searchedAll
    ? `${subject} ${verb} no history yet.`
    : `No changes to ${noun} in the recent history. Load older to look further back.`;
}

/** Does a feed group (or a single described entry) touch any of these marks? */
export function historyGroupTouchesMarks(group, idSet) {
  if (!group || !idSet || idSet.size === 0) return false;
  const entries = Array.isArray(group.entries) ? group.entries : [group];
  return entries.some((entry) => (entry?.markIds || []).some((id) => idSet.has(String(id))));
}

/** The raw rows touch any of these marks (used while looking further back). */
export function historyRowsTouchMarks(rows, idSet, markIdsOfRow) {
  if (!idSet || idSet.size === 0 || typeof markIdsOfRow !== 'function') return false;
  return (Array.isArray(rows) ? rows : []).some((row) => markIdsOfRow(row).some((id) => idSet.has(String(id))));
}
