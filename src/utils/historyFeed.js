/**
 * historyFeed.js — RULED 2026-09-28 owner: History option A ("activity feed").
 *
 * Pure helpers that turn the raw document_history_events rows into the feed the
 * History panel draws (src/components/revisions/RevisionsPanel.jsx):
 *
 *   - one line per thing a person did, newest first, split by day
 *     (Today / Yesterday / weekday / date);
 *   - each line reads "<Name> <verb> <mark>" ("Maya moved a rectangle"),
 *     with the person, the time and the page on the second line;
 *   - repeat edits of ONE mark by ONE person close together (moves, resizes,
 *     color changes, erasing, text edits) fold into one line
 *     ("moved a rectangle · 3 edits") that opens to show each edit;
 *   - filters: Everyone / Only me / Deleted.
 *
 * Reference behaviour: the owner-approved prototype history-A.html (w60) and
 * Miro / Figma activity lists. Nothing here touches the DOM or React so the
 * whole feed shape is node-tested (tests/historyFeed.test.mjs).
 */

// The trash rows (a deleted item's restore data). Mirrors
// TRASH_HISTORY_EVENT_TYPES in services/documentHistoryService.js (kept
// separate so this file has no imports; tests/historyFeed.test.mjs checks the
// two lists match).
export const HISTORY_TRASH_EVENT_TYPES = Object.freeze([
  'annotation_deleted',
  'callout_deleted',
  'region_deleted',
  'annotations_bulk_deleted',
  'space_deleted',
  'survey_marker_deleted',
]);
function isTrashHistoryEvent(row) {
  return HISTORY_TRASH_EVENT_TYPES.includes(row?.event_type);
}

// Repeat edits by one person on one mark within this window fold into one line.
export const HISTORY_FOLD_WINDOW_MS = 15 * 60 * 1000;
const FOLD_KINDS = new Set(['moved', 'resized', 'rotated', 'recolored', 'erased', 'textEdited', 'edited']);
// Rows whose "Before / After" can be peeked on the page (a ghost of the old
// position / size / color while the row is open).
export const HISTORY_PEEK_KINDS = new Set(['moved', 'resized', 'rotated', 'recolored', 'erased']);

// RULED 2026-09-29 owner: cleaner History — "I want it clearer whether an
// entry was deleted, just modified, or created, something quick to see":
// each line carries a small colored dot (the verb is tinted to match; the
// words stay, so color is never the only signal).
//   created  = blue   (added, placed)
//   edited   = green  (moved, resized, rotated, recolored, erased part of,
//                      edited text, locked / unlocked, cut a Survey Marker)
//   deleted  = red
//   restored = teal   (kept apart from "added" blue)
//   other    = grey   (undo / redo / Excel sync)
const HISTORY_STATUS_BY_KIND = Object.freeze({
  created: 'created',
  placed: 'created',
  deleted: 'deleted',
  restored: 'restored',
  moved: 'edited',
  resized: 'edited',
  rotated: 'edited',
  recolored: 'edited',
  erased: 'edited',
  textEdited: 'edited',
  locked: 'edited',
  unlocked: 'edited',
  tookOff: 'edited',
  edited: 'edited',
});

/** 'created' | 'edited' | 'deleted' | 'restored' | 'other' for a line's kind. */
export function historyStatusOf(kind) {
  return HISTORY_STATUS_BY_KIND[kind] || 'other';
}

// The legend under the filters (the four colors a line can have).
export const HISTORY_STATUS_LEGEND = Object.freeze([
  Object.freeze({ id: 'created', label: 'Added' }),
  Object.freeze({ id: 'edited', label: 'Edited' }),
  Object.freeze({ id: 'deleted', label: 'Deleted' }),
  Object.freeze({ id: 'restored', label: 'Restored' }),
]);

export const HISTORY_FILTERS = Object.freeze([
  Object.freeze({ id: 'all', label: 'Everyone' }),
  Object.freeze({ id: 'me', label: 'Only me' }),
  Object.freeze({ id: 'deleted', label: 'Deleted' }),
]);

export function historyRowKey(row) {
  return row?.client_event_id || row?.id || null;
}

export function historyRowTimeMs(row) {
  return Date.parse(row?.occurred_at || row?.created_at || 0) || 0;
}

/** The page a row belongs to (null when it is not tied to one page). */
export function historyRowPage(row) {
  const payload = row?.payload || {};
  const candidates = [
    row?.page_number,
    payload.pageNumber,
    payload.restoreAction?.pageNumber,
    payload.restoreAction?.surveyMarker?.pageNumber,
    payload.restoreAction?.region?.pageId,
  ];
  for (const value of candidates) {
    if (value == null || value === '') continue;
    const page = Number(value);
    if (Number.isFinite(page) && page > 0) return page;
  }
  // A bulk delete whose marks were all on one page names that page.
  if (Array.isArray(payload.objects) && payload.objects.length > 0) {
    const pages = new Set(payload.objects.map((o) => Number(o?.pageNumber ?? o?.restoreAction?.pageNumber)));
    if (pages.size === 1) {
      const [only] = [...pages];
      if (Number.isFinite(only) && only > 0) return only;
    }
  }
  return null;
}

/** The id of the ONE mark (or space / region) a row is about, when there is one. */
export function historyRowMarkId(row) {
  if (!row) return null;
  const payload = row.payload || {};
  if (row.event_type === 'annotations_bulk_deleted') return null;
  const restore = payload.restoreAction || {};
  if (row.event_type === 'space_deleted') return restore.spaceId || payload.spaceId || row.annotation_id || null;
  if (row.event_type === 'region_deleted') return restore.region?.regionId || restore.regionId || row.annotation_id || null;
  if (Array.isArray(payload.annotationIds) && payload.annotationIds.length > 1) return null;
  return row.annotation_id || payload.annotationId || payload.calloutId || restore.markerId || null;
}

/** Every mark id a row touches (a bulk delete touches many). */
export function historyRowMarkIds(row) {
  if (!row) return [];
  const payload = row.payload || {};
  if (row.event_type === 'annotations_bulk_deleted' && Array.isArray(payload.objects)) {
    const ids = [];
    for (const object of payload.objects) {
      const ra = object?.restoreAction || {};
      const id = object?.annotationId || object?.id || ra.annotationId || ra.annotation?.data?.id
        || ra.annotation?.id || ra.markerId || ra.calloutId || ra.callout?.id || ra.region?.regionId
        || (Array.isArray(ra.created) ? ra.created.map((entry) => entry?.id) : null);
      if (Array.isArray(id)) ids.push(...id.filter(Boolean));
      else if (id) ids.push(id);
    }
    return [...new Set(ids.map(String))];
  }
  if (Array.isArray(payload.annotationIds) && payload.annotationIds.length > 1) {
    return [...new Set(payload.annotationIds.filter(Boolean).map(String))];
  }
  const id = historyRowMarkId(row);
  return id ? [String(id)] : [];
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const TYPE_WORDS = {
  rect: 'a rectangle',
  ellipse: 'an ellipse',
  line: 'a line',
  arrow: 'an arrow',
  polyline: 'a polyline',
  polygon: 'a polygon',
  cloud: 'a cloud',
  pen: 'a pen stroke',
  highlighter: 'a highlighter stroke',
  text: 'a text box',
  callout: 'a callout',
  counter: 'a counter',
  surveyMarker: 'a Survey Marker',
  image: 'an image',
  markup: 'a text highlight',
  space: 'a space',
  region: 'a region',
  mark: 'a mark',
};

// The app's own glyph (src/Icons.jsx) for each kind of mark.
const TYPE_GLYPHS = {
  rect: 'rect',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
  polyline: 'polyline',
  polygon: 'polygon',
  cloud: 'lineSampleCloud',
  pen: 'pen',
  highlighter: 'highlighterTool',
  text: 'textBox',
  callout: 'callout',
  counter: 'counter',
  surveyMarker: 'survey',
  image: 'image',
  markup: 'formatHighlight',
  space: 'layers',
  region: 'layers',
  marks: 'shapes',
  mark: 'shapes',
  excel: 'survey',
  undo: 'undo',
  redo: 'redo',
};

/** Normalize the many spellings of a mark type to one key. */
export function historyTypeKey(value, annotation = null) {
  const text = String(value || '').toLowerCase();
  const data = annotation?.data || {};
  // The tool that drew it wins over the stored shape type: an arrow is a
  // "line" with arrowheads, a highlighter stroke is a "path".
  const tool = String(annotation?.tool || data.tool || '').toLowerCase();
  if (tool === 'arrow') return 'arrow';
  if (tool === 'highlighter') return 'highlighter';
  if (data.lineStyle === 'cloud' || data.style?.lineStyle === 'cloud' || data.cloud === true || data.borderStyle === 'cloud') return 'cloud';
  if (!text) return 'mark';
  if (text.includes('survey') || text === 'highlight-survey') return 'surveyMarker';
  if (text === 'rect' || text === 'rectangle' || text === 'square') return 'rect';
  if (text === 'ellipse' || text === 'circle' || text === 'oval') return 'ellipse';
  if (text === 'arrow') return 'arrow';
  if (text === 'line') return 'line';
  if (text === 'polyline') return 'polyline';
  if (text === 'polygon') return 'polygon';
  if (text === 'cloud' || text.includes('cloud')) return 'cloud';
  if (text.includes('highlighter')) return 'highlighter';
  if (text === 'path' || text === 'ink' || text === 'pen' || text === 'freehand') return 'pen';
  if (text === 'textbox' || text === 'text' || text === 'freetext' || text === 'i-text') return 'text';
  if (text.includes('callout')) return 'callout';
  if (text.includes('counter')) return 'counter';
  if (text === 'image' || text === 'stamp') return 'image';
  if (['highlight', 'underline', 'strikeout', 'squiggly', 'text-markup', 'textmarkup'].includes(text)) return 'markup';
  if (text === 'space') return 'space';
  if (text === 'region') return 'region';
  return 'mark';
}

export function historyGlyphFor(typeKey) {
  return TYPE_GLYPHS[typeKey] || 'shapes';
}

function surveyMarkerName(row) {
  const payload = row?.payload || {};
  const marker = payload.restoreAction?.surveyMarker || payload.previewAnnotation?.surveyMarker || null;
  const name = typeof marker?.name === 'string' ? marker.name.trim() : '';
  if (name) return name;
  const match = /Survey Marker "([^"]+)"/i.exec(String(row?.summary || ''));
  return match ? match[1] : '';
}

function nounFor(typeKey, row, count = 1) {
  if (count > 1) return `${count} marks`;
  if (typeKey === 'surveyMarker') {
    const name = surveyMarkerName(row);
    return name ? `Survey Marker “${name}”` : 'a Survey Marker';
  }
  if (typeKey === 'space') {
    const payload = row?.payload || {};
    const name = payload.spaceName ?? payload.restoreAction?.spaceName;
    return name ? `the space “${name}”` : 'a space';
  }
  if (typeKey === 'region') {
    const payload = row?.payload || {};
    const name = payload.spaceName ?? payload.restoreAction?.spaceName;
    return name ? `a region in “${name}”` : 'a region';
  }
  return TYPE_WORDS[typeKey] || 'a mark';
}

// Verb for each kind. "added", not "created" (prototype wording, owner-approved).
const VERBS = {
  created: 'added',
  deleted: 'deleted',
  restored: 'restored',
  moved: 'moved',
  resized: 'resized',
  rotated: 'rotated',
  recolored: 'changed the color of',
  erased: 'erased part of',
  textEdited: 'edited the text of',
  locked: 'locked',
  unlocked: 'unlocked',
  tookOff: 'cut',
  placed: 'placed',
  edited: 'edited',
};

// The words a folded line's children use ("Moved it", "Changed its color").
const SHORT_VERBS = {
  moved: 'Moved it',
  resized: 'Resized it',
  rotated: 'Rotated it',
  recolored: 'Changed its color',
  erased: 'Erased part of it',
  textEdited: 'Edited its text',
  edited: 'Edited it',
};

export function historyShortVerb(kind) {
  return SHORT_VERBS[kind] || 'Edited it';
}

const ACTOR_VERB_RE = /^(.*?)\s+(created|drew|deleted|moved|resized|rotated|edited|locked|unlocked|restored|undid|redid|made|synced|changed|erased|added|brought)\b/;

/** The person's name as written into the row (null when it can't be read). */
export function historyActorName(row) {
  const match = ACTOR_VERB_RE.exec(String(row?.summary || ''));
  const name = match ? match[1].trim() : '';
  return name || null;
}

/**
 * What a row says, as structured parts:
 *   { kind, verb, noun, typeKey, glyph, count, suffix }
 * kind ∈ created | deleted | restored | moved | resized | rotated | recolored |
 *        erased | textEdited | locked | unlocked | edited | undo | redo | synced
 */
export function classifyHistoryRow(row) {
  const payload = row?.payload || {};
  const eventType = String(row?.event_type || '');
  const preview = payload.previewAnnotation || payload.restoreAction?.annotation || null;
  const baseType = historyTypeKey(payload.annotationType || preview?.data?.type || preview?.type, preview);
  const count = Number(payload.itemCount || payload.count || payload.gestureTotalCount || 0);

  if (eventType === 'space_deleted') return finish('deleted', 'space', row);
  if (eventType === 'region_deleted') return finish('deleted', 'region', row);
  if (eventType === 'survey_marker_deleted') {
    return { ...finish('deleted', 'surveyMarker', row), suffix: payload.origin === 'excel-import' ? 'in Excel' : '' };
  }
  if (eventType === 'callout_deleted') return finish('deleted', 'callout', row);
  if (eventType === 'annotations_bulk_deleted') {
    const total = Number(payload.gestureTotalCount || payload.count || (payload.objects || []).length || 0);
    const eraser = payload.rawActionType === 'annotations_erase_deleted' || row?.source === 'annotation-eraser';
    return {
      ...finish('deleted', total > 1 ? 'marks' : bulkSingleType(payload), row, total),
      suffix: eraser ? 'with the eraser' : '',
    };
  }
  if (eventType === 'annotation_deleted') return finish('deleted', baseType, row);
  if (eventType.endsWith('_undo_applied')) return { kind: 'undo', verb: 'undid a change', noun: '', typeKey: 'undo', glyph: 'undo', count: 0, suffix: '' };
  if (eventType.endsWith('_redo_applied')) return { kind: 'redo', verb: 'redid a change', noun: '', typeKey: 'redo', glyph: 'redo', count: 0, suffix: '' };

  if (eventType === 'checkpoint_added' || eventType === 'checkpoint_added_annotation_fast') {
    const reason = String(payload.reason || payload.rawActionType || '').toLowerCase();
    if (reason.startsWith('callouts:create')) return finish('created', 'callout', row);
    if (reason.startsWith('callouts:delete')) return finish('deleted', 'callout', row);
    if (reason.startsWith('callouts:')) return finish('edited', 'callout', row);
    if (reason.startsWith('space:create')) return finish('created', 'space', row);
    if (reason.startsWith('space:delete')) return finish('deleted', 'space', row);
    if (reason.startsWith('space:')) return finish('edited', 'space', row);
    if (reason.startsWith('highlight:create')) return finish('created', 'surveyMarker', row);
    if (reason.startsWith('highlight:delete')) return finish('deleted', 'surveyMarker', row);
    if (reason.startsWith('survey-marker:')) return finish('edited', 'surveyMarker', row);
    if (reason.startsWith('excel:')) {
      return { kind: 'synced', verb: 'synced survey data to Excel', noun: '', typeKey: 'excel', glyph: 'survey', count: 0, suffix: '' };
    }
    return finish('edited', baseType, row);
  }

  const multi = count > 1 ? count : 0;
  if (payload.restoredFromHistory === true) return finish('restored', baseType, row, multi);
  const action = String(payload.actionType || '').toLowerCase();
  if (action === 'ink') return finish('created', baseType === 'mark' ? 'pen' : baseType, row, multi);
  if (action === 'create') return finish('created', baseType, row, multi);
  if (action === 'delete') return finish('deleted', baseType, row, multi);
  if (action === 'move') return finish('moved', baseType, row, multi);
  if (action === 'resize') return finish('resized', baseType, row, multi);
  if (action === 'rotate') return finish('rotated', baseType, row, multi);
  if (action === 'recolor') return finish('recolored', baseType, row, multi);
  if (action === 'erase') return finish('erased', baseType, row, multi);
  if (action === 'text edit') return finish('textEdited', baseType === 'mark' ? 'text' : baseType, row, multi);
  if (action === 'lock') return finish('locked', baseType, row, multi);
  if (action === 'unlock') return finish('unlocked', baseType, row, multi);
  if (action === 'unplace') return finish('tookOff', baseType, row, multi);
  if (action === 'place') return finish('placed', baseType, row, multi);
  if (action === 'callout edit') return finish('edited', 'callout', row, multi);
  return finish('edited', baseType, row, multi);
}

function bulkSingleType(payload) {
  const ra = payload?.objects?.[0]?.restoreAction || {};
  const annotation = ra.annotation || ra.created?.[0]?.annotation || null;
  if (ra.type === 'surveyMarker') return 'surveyMarker';
  if (ra.callout) return 'callout';
  if (ra.region) return 'region';
  return historyTypeKey(annotation?.data?.type || annotation?.type, annotation);
}

function finish(kind, typeKey, row, count = 0) {
  return {
    kind,
    verb: VERBS[kind] || 'edited',
    noun: nounFor(typeKey, row, count),
    typeKey,
    glyph: historyGlyphFor(count > 1 ? 'marks' : typeKey),
    count,
    suffix: '',
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", "Tuesday" (this week), "Mon, Sep 21", "Mon, Sep 21, 2025". */
export function historyDayLabel(ms, now = Date.now()) {
  const today = startOfDay(now);
  const day = startOfDay(ms);
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const d = new Date(ms);
  if (diffDays < 7) return DAY_NAMES[d.getDay()];
  const base = `${DAY_NAMES[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** "2:41 PM" — or "Just now" within the last minute. */
export function historyClockLabel(ms, now = Date.now()) {
  if (now - ms >= 0 && now - ms < 60000) return 'Just now';
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

/** A folded line's time: "2:10–2:41 PM" (both ends, one AM/PM when shared). */
export function historyRangeLabel(firstMs, lastMs, now = Date.now()) {
  const last = historyClockLabel(lastMs, now);
  const first = historyClockLabel(firstMs, now);
  if (first === last) return last;
  if (last === 'Just now') return `${first}–now`;
  const firstAp = first.slice(-2);
  const lastAp = last.slice(-2);
  return `${firstAp === lastAp ? first.slice(0, -3) : first}–${last}`;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function actorKey(row) {
  return row?.user_id || historyActorName(row) || '?';
}

/**
 * Describe one row for the feed.
 *   currentUserId → "You" for the viewer's own rows.
 */
export function describeHistoryRow(row, { currentUserId = null } = {}) {
  const parts = classifyHistoryRow(row);
  const rawName = historyActorName(row) || 'Someone';
  // An email address as a name reads as its first part ("sam", not "sam@x.com").
  const fullName = rawName.includes('@') ? rawName.split('@')[0] : rawName;
  const isYou = Boolean(currentUserId && row?.user_id && row.user_id === currentUserId);
  const firstName = fullName.split(/\s+/)[0];
  return {
    ...parts,
    key: historyRowKey(row),
    row,
    ms: historyRowTimeMs(row),
    page: historyRowPage(row),
    markId: historyRowMarkId(row),
    markIds: historyRowMarkIds(row),
    status: historyStatusOf(parts.kind),
    isDelete: isTrashHistoryEvent(row) || parts.kind === 'deleted',
    isTrash: isTrashHistoryEvent(row),
    actorId: row?.user_id || null,
    actorName: isYou ? 'You' : fullName,
    actorShort: isYou ? 'You' : firstName,
    isYou,
  };
}

/**
 * Build the feed: groups of folded rows, newest first.
 * Each group: { key, entries (oldest → newest), first, last, count }.
 */
export function buildHistoryGroups(rows, { currentUserId = null, foldWindowMs = HISTORY_FOLD_WINDOW_MS } = {}) {
  const entries = (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .map((row) => describeHistoryRow(row, { currentUserId }))
    .filter((entry) => entry.key)
    .sort((a, b) => a.ms - b.ms || String(a.key).localeCompare(String(b.key)));
  const groups = [];
  for (const entry of entries) {
    const group = groups[groups.length - 1];
    const prev = group?.entries[group.entries.length - 1];
    const folds = prev
      && FOLD_KINDS.has(entry.kind)
      && prev.kind === entry.kind
      && entry.markId
      && prev.markId === entry.markId
      && actorKey(prev.row) === actorKey(entry.row)
      && entry.ms - prev.ms < foldWindowMs;
    if (folds) group.entries.push(entry);
    else groups.push({ entries: [entry] });
  }
  for (const group of groups) {
    group.first = group.entries[0];
    group.last = group.entries[group.entries.length - 1];
    group.count = group.entries.length;
    group.key = `g:${group.first.key}`;
  }
  return groups.reverse();
}

export function historyGroupPassesFilter(group, filter, { currentUserId = null } = {}) {
  if (filter === 'me') return Boolean(currentUserId && group.last.actorId === currentUserId);
  if (filter === 'deleted') return group.last.isDelete;
  return true;
}

export function historyGroupMatchesQuery(group, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const e = group.last;
  const text = `${e.actorName} ${e.verb} ${e.noun} ${e.suffix} page ${e.page || ''}`.toLowerCase();
  return q.split(/\s+/).every((word) => text.includes(word));
}

/**
 * The visible feed: day headings between groups.
 * Returns [{ type: 'day', label, key } | { type: 'group', group }].
 */
export function buildHistoryFeed(rows, {
  currentUserId = null,
  filter = 'all',
  query = '',
  now = Date.now(),
  // w64: the marks picked on the page. When set, the feed shows every line
  // about those marks (by anyone, deleted or not) and ignores the filter
  // chips and the search — the "Showing history for this …" bar says so.
  markIds = null,
} = {}) {
  const markSet = markIds && (markIds.size ?? markIds.length) > 0
    ? new Set([...markIds].map(String))
    : null;
  const groups = buildHistoryGroups(rows, { currentUserId })
    .filter((group) => (markSet
      ? group.entries.some((entry) => entry.markIds.some((id) => markSet.has(id)))
      : historyGroupPassesFilter(group, filter, { currentUserId }) && historyGroupMatchesQuery(group, query)));
  const items = [];
  let lastDay = null;
  for (const group of groups) {
    const label = historyDayLabel(group.last.ms, now);
    if (label !== lastDay) {
      items.push({ type: 'day', label, key: `day:${label}:${group.key}` });
      lastDay = label;
    }
    items.push({ type: 'group', group });
  }
  return { items, groupCount: groups.length };
}

/** The newest trash row per mark id among the loaded rows (for "deleted later"). */
export function latestDeleteRowByMark(rows) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isTrashHistoryEvent(row)) continue;
    for (const id of historyRowMarkIds(row)) {
      const prev = out.get(id);
      if (!prev || historyRowTimeMs(row) > historyRowTimeMs(prev)) out.set(id, row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Colors (Before / After of a color change)
// ---------------------------------------------------------------------------

function parseColor(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'transparent' || text === 'none') return null;
  let m = /^#([0-9a-f]{3})$/.exec(text);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]+)\)$/.exec(text);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      if (parts.length > 3 && parts[3] === 0) return null;
      return parts.slice(0, 3);
    }
  }
  return null;
}

/** The color a person sees for a mark: its outline, else its fill. */
export function historyMarkColor(annotation) {
  if (!annotation || typeof annotation !== 'object') return null;
  const data = annotation.data || {};
  const candidates = [data.color, data.strokeColor, annotation.stroke, data.style?.fontColor, annotation.fill];
  for (const value of candidates) {
    if (parseColor(value)) return String(value);
  }
  return null;
}

/** A plain color word for a hex / rgb color ("Red", "Blue", "Black"). */
export function historyColorName(value) {
  const rgb = parseColor(value);
  if (!rgb) return 'No color';
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.12) return 'Black';
  if (l > 0.93) return 'White';
  if (s < 0.18) return l < 0.35 ? 'Dark gray' : 'Gray';
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return l < 0.3 ? 'Dark red' : 'Red';
  if (h < 40) return l < 0.35 ? 'Brown' : 'Orange';
  if (h < 65) return 'Yellow';
  if (h < 160) return 'Green';
  if (h < 195) return 'Teal';
  if (h < 255) return 'Blue';
  if (h < 290) return 'Purple';
  return 'Pink';
}
