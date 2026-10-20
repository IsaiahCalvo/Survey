/**
 * Long lists in the survey bars (lead decision 2026-10-13, scratchpad
 * listDebate/DECISION.md) - the pure rules, node-tested in
 * tests/surveyPickLists.test.mjs.
 *
 * Intended UX: a survey bar row never changes shape while the window is
 * resized - what it shows is decided by COUNT, never by width:
 *   - up to 8 categories (or entities): every one is a chip (or swatch);
 *   - above 8: 7 of them, plus a plain "All N" chip that opens the whole list
 *     (by full name, with a find field from 15 rows). The 7 are the current
 *     one, then the most recently used, then template order - and they are
 *     DRAWN in template order, so picking a chip that is already showing never
 *     reshuffles the row.
 *   - the template menu gains a "Find a template" field and the 3 most
 *     recently used templates at the top from 15 templates.
 * Recents are per template (templates: one list), kept in this browser only
 * (localStorage, every access guarded), never in the database.
 */

/** A row shows every item up to this many. */
export const SURVEY_ROW_MAX_ITEMS = 8;
/** A list gets its find field from this many rows. */
export const SURVEY_LIST_SEARCH_FROM = 15;
/** How many recently used templates sit at the top of the template menu. */
export const SURVEY_RECENT_TEMPLATES = 3;
/** How many recent picks are remembered per list. */
export const SURVEY_RECENTS_KEPT = 12;

const STORAGE_PREFIX = 'survey:recent:v1';

const storageKey = (kind, scopeId) => `${STORAGE_PREFIX}:${kind}:${scopeId || 'all'}`;

const getStorage = (storage) => {
  if (storage) return storage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** The remembered picks for a list, most recent first ([] when unknown). */
export function readSurveyRecents(kind, scopeId, storage) {
  try {
    const store = getStorage(storage);
    const raw = store?.getItem?.(storageKey(kind, scopeId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

/** Remember `id` as the most recent pick in a list. Returns the new list. */
export function pushSurveyRecent(kind, scopeId, id, storage) {
  if (!id) return readSurveyRecents(kind, scopeId, storage);
  const next = [String(id), ...readSurveyRecents(kind, scopeId, storage).filter((other) => other !== String(id))]
    .slice(0, SURVEY_RECENTS_KEPT);
  try {
    getStorage(storage)?.setItem?.(storageKey(kind, scopeId), JSON.stringify(next));
  } catch {
    // Private mode / full storage: the row still works, it just forgets.
  }
  return next;
}

/**
 * Which items a bar row draws (decided by count).
 * @param {Array<{id: string}>} items   in template order
 * @param {object} [options]
 * @param {string|null} [options.currentId]  the armed / current one
 * @param {string[]} [options.recentIds]     most recent first
 * @param {number} [options.max]             SURVEY_ROW_MAX_ITEMS
 * @returns {{ shown: Array, overflow: boolean, total: number }}
 *   `shown` in template order; `overflow` true when an "All N" chip follows.
 */
export function pickSurveyRowItems(items, { currentId = null, recentIds = [], max = SURVEY_ROW_MAX_ITEMS } = {}) {
  const list = Array.isArray(items) ? items.filter((item) => item && item.id != null) : [];
  if (list.length <= max) return { shown: list, overflow: false, total: list.length };
  const room = Math.max(0, max - 1);
  const ids = new Set(list.map((item) => String(item.id)));
  const chosen = new Set();
  const take = (id) => {
    if (chosen.size >= room || id == null) return;
    const key = String(id);
    if (ids.has(key)) chosen.add(key);
  };
  take(currentId);
  for (const id of recentIds || []) take(id);
  for (const item of list) take(item.id);
  return { shown: list.filter((item) => chosen.has(String(item.id))), overflow: true, total: list.length };
}

/** Fewest disc slots a phone rail column gives up to ("All N" + 2 discs). */
export const SURVEY_RAIL_MIN_SLOTS = 3;

/**
 * The phone tool rail's two survey disc columns (categories, entities) - the
 * phone twin of the desktop rows (phone survey round, 2026-10-13).
 *
 * Intended UX: the same count rule as desktop (up to 8: every disc; above 8:
 * 7 discs + "All N"), and - like a narrow desktop window, its last resort -
 * when the rail is too short for both columns, the longer column gives up
 * discs first (never below 3 slots: 2 discs + "All N") so no disc is ever
 * hidden below the rail's fold. The phone rail is as tall as the screen, so
 * this is decided once per screen size, never while working (`slots` is
 * measured with no tool group open). With no room even for that, the rail
 * scrolls (owner 2026-10-01: "if the rail runs out of room it should scroll
 * rather than compress").
 *
 * @param {object} args
 * @param {number} args.categoryCount  categories of the chosen module
 * @param {number} args.entityCount    entities of the template
 * @param {number|null} args.slots     discs the rail can hold for both
 *                                     columns ("All N" is a disc); null =
 *                                     not measured yet (count rule only)
 * @returns {{ categoryMax: number, entityMax: number }} each column's `max`
 *   for pickSurveyRowItems (all shown when count <= max).
 */
export function planPhoneSurveyRail({ categoryCount = 0, entityCount = 0, slots = null } = {}) {
  const cap = (count) => Math.min(Math.max(0, count | 0), SURVEY_ROW_MAX_ITEMS);
  let cats = cap(categoryCount);
  let ents = cap(entityCount);
  if (!Number.isFinite(slots)) return { categoryMax: SURVEY_ROW_MAX_ITEMS, entityMax: SURVEY_ROW_MAX_ITEMS };
  const floorOf = (count) => Math.min(Math.max(0, count | 0), SURVEY_RAIL_MIN_SLOTS);
  const catFloor = floorOf(categoryCount);
  const entFloor = floorOf(entityCount);
  while (cats + ents > slots) {
    // The longer column gives first; on a tie the entities (the second pick).
    const entsCan = ents > entFloor;
    const catsCan = cats > catFloor;
    if (entsCan && (!catsCan || ents >= cats)) ents -= 1;
    else if (catsCan) cats -= 1;
    else break;
  }
  // A column that keeps every item uses exactly its count; one that shows
  // fewer keeps at least 2 so it is "1 disc + All" at the very least.
  return {
    categoryMax: cats >= categoryCount ? SURVEY_ROW_MAX_ITEMS : Math.max(2, cats),
    entityMax: ents >= entityCount ? SURVEY_ROW_MAX_ITEMS : Math.max(2, ents),
  };
}

/** Case-insensitive "contains" filter for the find field. */
export function filterSurveyListItems(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => String(item?.label || '').toLowerCase().includes(q));
}

/**
 * The template menu's sections: from SURVEY_LIST_SEARCH_FROM templates, the
 * SURVEY_RECENT_TEMPLATES most recently used ones sit at the top under
 * "Recent" (they stay in the full list too).
 */
export function surveyTemplateSections(templates, recentIds = []) {
  const all = (templates || []).map((template) => ({ id: template.id, label: template.name || 'Untitled template' }));
  if (all.length < SURVEY_LIST_SEARCH_FROM) return [{ id: 'all', label: null, items: all }];
  const byId = new Map(all.map((item) => [String(item.id), item]));
  const recent = (recentIds || []).map((id) => byId.get(String(id))).filter(Boolean).slice(0, SURVEY_RECENT_TEMPLATES);
  return [
    ...(recent.length ? [{ id: 'recent', label: 'Recent', items: recent }] : []),
    { id: 'all', label: 'All templates', items: all },
  ];
}
