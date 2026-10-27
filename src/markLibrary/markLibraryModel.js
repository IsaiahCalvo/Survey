/**
 * markLibraryModel.js — the rules of the mark library (beta flag
 * 'mark-library'). Pure: no React, no Supabase, so node tests import it.
 *
 * Drawboard Projects' "Markup Library" (docs/MARK-LIBRARY.md): a person saves
 * marks they use often (a stamp, a symbol, a callout with set text, a set of
 * Survey Markers) into their personal library or the project's shared one,
 * and drops them on any page again.
 *
 * An item's payload is the app's family clipboard (utils/familyClipboard.js
 * buildFamilyClipboard): marks, callouts and Survey Markers in stacking order,
 * the page size they were copied on (callouts keep page fractions) and the
 * group's page-unit box. Placing an item IS a paste of that clipboard
 * (commitFamilyPaste), so a placed item saves, syncs and undoes like a paste:
 * every mark is new, the placer's own, and takes the landing scope (open
 * Survey module, space region, active layer).
 *
 * Beyond Drawboard:
 *   - every mark kind can be saved, not only ink, shapes, text and callouts:
 *     images and stamps (within the 1 MB item limit), counters, measurements
 *     (they take the landing page's scale) and Survey Markers (they become new
 *     survey items in the open module's category of the same name);
 *   - text may hold {{tokens}} (Drawboard's Dynamic Tokens) that fill in when
 *     the item is placed: author, date, time, document, project, page.
 */

export const LIBRARY_PAYLOAD_VERSION = 1;
export const LIBRARY_KINDS = Object.freeze(['personal', 'project']);
export const LIBRARY_NAME_MAX = 120;
export const LIBRARY_TAG_MAX = 40;
export const LIBRARY_TAGS_PER_ITEM = 20;
/** The database refuses a payload over 1 MB (pg_column_size); stay under it. */
export const LIBRARY_PAYLOAD_MAX_BYTES = 900 * 1024;
export const LIBRARY_EXPORT_FORMAT = 'survey-mark-library';
export const LIBRARY_EXPORT_EXTENSION = '.surveymarks';
export const LIBRARY_IMPORT_MAX_ITEMS = 500;

// Fields that tie a mark to the place it was saved from. A placed mark takes
// the landing place's scope, layer and author instead.
const PLACE_BOUND_KEYS = [
  'regionId', 'moduleId', 'layerId', 'lockedBy', 'spaceId',
  '__surveyLivePreview', '__surveyLiveEdit',
];

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

const isTextMarkup = (object) => object?.data?.type === 'text-markup';

function stripPlaceBound(object) {
  if (!object || typeof object !== 'object') return object;
  for (const key of PLACE_BOUND_KEYS) delete object[key];
  if (object.data && typeof object.data === 'object' && !Array.isArray(object.data)) {
    for (const key of PLACE_BOUND_KEYS) delete object.data[key];
    if (object.data.legacyCallout && typeof object.data.legacyCallout === 'object') {
      delete object.data.legacyCallout.lockedBy;
    }
  }
  return object;
}

/** Which of the library's kinds one clipboard item is (for the item's badges and filters). */
export function libraryKindOf(item) {
  if (!item) return null;
  if (item.kind === 'callout') return 'callout';
  if (item.kind === 'marker') return 'marker';
  const object = item.object || {};
  const dataType = object.data?.type;
  if (dataType === 'counter') return 'counter';
  if (object.data?.measure?.kind) return 'measure';
  const type = String(object.type || '').toLowerCase();
  if (type === 'image') return (object.pdfAnnotationType || object.data?.pdfAnnotationType) === 'Stamp' ? 'stamp' : 'image';
  if (type === 'textbox' || type === 'i-text' || type === 'text') return 'text';
  if (type === 'path') return 'ink';
  if (type === 'line' || type === 'arrow' || type === 'polyline') return 'line';
  return 'shape';
}

export const LIBRARY_KIND_LABELS = Object.freeze({
  ink: 'Ink',
  shape: 'Shape',
  line: 'Line',
  text: 'Text',
  callout: 'Callout',
  counter: 'Counter',
  measure: 'Measurement',
  image: 'Image',
  stamp: 'Stamp',
  marker: 'Survey Marker',
});

/** The distinct kinds in a payload, in a fixed order. */
export function summarizeLibraryKinds(payload) {
  const seen = new Set((payload?.items || []).map(libraryKindOf).filter(Boolean));
  return Object.keys(LIBRARY_KIND_LABELS).filter((kind) => seen.has(kind));
}

const finite = (value) => Number.isFinite(Number(value));

/**
 * A library payload from a family clipboard. Text highlights (they belong to
 * the PDF's own words) are left out; so is anything tied to where the marks
 * were copied from. Returns null when nothing is left.
 */
export function libraryPayloadFromClipboard(clipboard) {
  if (!clipboard || !Array.isArray(clipboard.items)) return null;
  const items = [];
  for (const item of clipboard.items) {
    if (item?.kind === 'mark') {
      if (!item.object || isTextMarkup(item.object)) continue;
      items.push({ kind: 'mark', object: stripPlaceBound(clone(item.object)) });
    } else if (item?.kind === 'callout') {
      if (!item.callout) continue;
      const callout = stripPlaceBound(clone(item.callout));
      delete callout.pageNumber;
      items.push({ kind: 'callout', callout });
    } else if (item?.kind === 'marker') {
      if (!item.entry?.bounds) continue;
      const entry = clone(item.entry);
      delete entry.regionId;
      items.push({
        kind: 'marker',
        entry,
        categoryName: item.categoryName ?? null,
        sourceModuleId: item.sourceModuleId ?? null,
      });
    }
  }
  if (items.length === 0) return null;
  const extent = clipboard.extent && ['left', 'top', 'width', 'height'].every((k) => finite(clipboard.extent[k]))
    ? {
      left: Number(clipboard.extent.left),
      top: Number(clipboard.extent.top),
      width: Math.max(0, Number(clipboard.extent.width)),
      height: Math.max(0, Number(clipboard.extent.height)),
    }
    : null;
  const origin = {
    left: finite(clipboard.origin?.left) ? Number(clipboard.origin.left) : (extent?.left ?? 0),
    top: finite(clipboard.origin?.top) ? Number(clipboard.origin.top) : (extent?.top ?? 0),
  };
  return {
    version: LIBRARY_PAYLOAD_VERSION,
    items,
    pageWidth: finite(clipboard.pageWidth) ? Number(clipboard.pageWidth) : 612,
    pageHeight: finite(clipboard.pageHeight) ? Number(clipboard.pageHeight) : 792,
    origin,
    extent: extent || { left: origin.left, top: origin.top, width: 0, height: 0 },
  };
}

/** Bytes the payload takes as JSON (what the 1 MB limit counts, near enough). */
export function libraryPayloadBytes(payload) {
  try {
    const text = JSON.stringify(payload);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  } catch {
    return Infinity;
  }
}

/**
 * Check a payload that came from outside this app run (a database row
 * another version wrote, an imported file). Returns a clean payload or null.
 */
export function sanitizeLibraryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const version = Number(payload.version) || 1;
  if (version > LIBRARY_PAYLOAD_VERSION) return null;
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 2000) return null;
  const items = payload.items.filter((item) => (
    (item?.kind === 'mark' && item.object && typeof item.object === 'object' && !isTextMarkup(item.object))
    || (item?.kind === 'callout' && item.callout && typeof item.callout === 'object')
    || (item?.kind === 'marker' && item.entry?.bounds && typeof item.entry.bounds === 'object')
  ));
  if (items.length === 0) return null;
  return libraryPayloadFromClipboard({ ...payload, items });
}

// ---------------------------------------------------------------------------
// Names and tags
// ---------------------------------------------------------------------------

export function cleanLibraryName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIBRARY_NAME_MAX);
}

/** Trimmed, at most 40 characters each, no repeats (case-insensitive), at most 20. */
export function cleanLibraryTags(tags) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(tags) ? tags : String(tags ?? '').split(',')) {
    const tag = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, LIBRARY_TAG_MAX);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= LIBRARY_TAGS_PER_ITEM) break;
  }
  return out;
}

const firstLine = (text) => String(text ?? '').split('\n').map((s) => s.trim()).find(Boolean) || '';

/** A starting name for a new item: its text when it has some, else what it is. */
export function defaultLibraryItemName(payload) {
  const items = payload?.items || [];
  for (const item of items) {
    const text = item.kind === 'callout' ? item.callout?.text : item.object?.text;
    const line = firstLine(text);
    if (line) return cleanLibraryName(line.length > 40 ? `${line.slice(0, 40).trim()}…` : line);
  }
  if (items.length === 1) {
    if (items[0].kind === 'marker' && items[0].categoryName) return cleanLibraryName(items[0].categoryName);
    return LIBRARY_KIND_LABELS[libraryKindOf(items[0])] || 'Mark';
  }
  return `${items.length} marks`;
}

/** "Name copy", "Name copy 2", ... not already in `names`. */
export function libraryCopyName(name, names = []) {
  const taken = new Set((names || []).map((n) => String(n).toLowerCase()));
  const base = cleanLibraryName(`${cleanLibraryName(name) || 'Mark'} copy`);
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const next = cleanLibraryName(`${base} ${n}`);
    if (!taken.has(next.toLowerCase())) return next;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Find, sort and group (the panel's search box and "..." menu)
// ---------------------------------------------------------------------------

export function libraryTagsOf(items) {
  const byKey = new Map();
  for (const item of items || []) {
    for (const tag of item?.tags || []) {
      const key = String(tag).toLowerCase();
      if (!byKey.has(key)) byKey.set(key, tag);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Items whose name, tags or kinds hold every word of `query`. */
export function filterLibraryItems(items, { query = '', tag = null } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const tagKey = tag ? String(tag).toLowerCase() : null;
  return (items || []).filter((item) => {
    if (tagKey && !(item.tags || []).some((t) => String(t).toLowerCase() === tagKey)) return false;
    if (words.length === 0) return true;
    const hay = [
      item.name,
      ...(item.tags || []),
      ...(item.kinds || []).map((kind) => LIBRARY_KIND_LABELS[kind] || kind),
    ].join(' ').toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

export const LIBRARY_SORTS = Object.freeze([
  { id: 'recent', label: 'Recently used' },
  { id: 'name', label: 'Name' },
  { id: 'newest', label: 'Newest' },
]);

/**
 * Sort a copy of `items`. 'recent' puts the ones this person placed last
 * first (`recents`: item id → time), then the newest.
 */
export function sortLibraryItems(items, sort = 'recent', recents = {}) {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true });
  const byNewest = (a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || byName(a, b);
  const list = [...(items || [])];
  if (sort === 'name') return list.sort(byName);
  if (sort === 'newest') return list.sort(byNewest);
  return list.sort((a, b) => ((Number(recents?.[b.id]) || 0) - (Number(recents?.[a.id]) || 0)) || byNewest(a, b));
}

/** [{ tag, items }] with one group per tag (an item shows under each of its tags), "No tag" last. */
export function groupLibraryItemsByTag(items) {
  const groups = new Map();
  const untagged = [];
  for (const item of items || []) {
    const tags = item.tags || [];
    if (tags.length === 0) { untagged.push(item); continue; }
    for (const tag of tags) {
      const key = String(tag).toLowerCase();
      if (!groups.has(key)) groups.set(key, { tag, items: [] });
      groups.get(key).items.push(item);
    }
  }
  const list = [...groups.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
  if (untagged.length) list.push({ tag: null, items: untagged });
  return list;
}

/**
 * Add / remove tags on several items at once (the select mode's Tags card).
 * Returns [{ id, tags }] for the items that change.
 */
export function planBulkTagChange(items, { add = [], remove = [] } = {}) {
  const removeKeys = new Set(cleanLibraryTags(remove).map((t) => t.toLowerCase()));
  const adds = cleanLibraryTags(add);
  const changes = [];
  for (const item of items || []) {
    const before = cleanLibraryTags(item.tags || []);
    const next = cleanLibraryTags([...before.filter((t) => !removeKeys.has(t.toLowerCase())), ...adds]);
    if (next.join('\u0000') !== before.join('\u0000')) changes.push({ id: item.id, tags: next });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Who may do what (the database enforces the same rules)
// ---------------------------------------------------------------------------

/**
 * @param {object} item     a library item ({ library, createdBy })
 * @param {object} access   { userId, canAdd, canManage } for the item's project
 */
export function canChangeLibraryItem(item, { userId = null, canAdd = false, canManage = false } = {}) {
  if (!item || !userId) return false;
  if (item.library === 'personal') return item.createdBy === userId;
  return canManage || (canAdd && item.createdBy === userId);
}

// ---------------------------------------------------------------------------
// Dynamic tokens ({{date}}, {{author.name}}, ...)
// ---------------------------------------------------------------------------

export const LIBRARY_TOKENS = Object.freeze([
  { token: 'author.name', label: 'Your name' },
  { token: 'author.first_name', label: 'Your first name' },
  { token: 'author.last_name', label: 'Your last name' },
  { token: 'author.initials', label: 'Your initials' },
  { token: 'author.email', label: 'Your email' },
  { token: 'date', label: 'Today\'s date' },
  { token: 'time', label: 'The time now' },
  { token: 'document.name', label: 'Document name' },
  { token: 'project.name', label: 'Project name' },
  { token: 'page.number', label: 'Page number' },
]);

const TOKEN_RE = /\{\{\s*([a-z_.]+)\s*(?:\|\s*formatDate\s*:\s*["']([^"']{1,40})["']\s*)?\}\}/gi;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n, width = 2) => String(n).padStart(width, '0');

/**
 * Format a date with moment-style tokens (Drawboard's `formatDate`):
 * YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm A a. Text in [brackets]
 * stays as written.
 */
export function formatLibraryDate(date, pattern = 'MMM D, YYYY') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const h12 = d.getHours() % 12 || 12;
  const parts = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    dddd: DAYS[d.getDay()],
    ddd: DAYS[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    hh: pad(h12),
    h: String(h12),
    mm: pad(d.getMinutes()),
    A: d.getHours() < 12 ? 'AM' : 'PM',
    a: d.getHours() < 12 ? 'am' : 'pm',
  };
  return String(pattern).replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|A|a/g,
    (match, literal) => (literal !== undefined ? literal : parts[match]));
}

function nameParts(fullName, email) {
  const name = String(fullName || '').trim() || String(email || '').split('@')[0] || '';
  const words = name.split(/\s+/).filter(Boolean);
  return {
    name,
    first: words[0] || '',
    last: words.length > 1 ? words[words.length - 1] : '',
    initials: words.map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
  };
}

/**
 * Fill {{tokens}} in `text`. Unknown tokens, and known ones with no value
 * here (a document outside any project has no project name), stay as typed.
 * @param {object} ctx { authorName, authorEmail, documentName, projectName, pageNumber, now }
 */
export function resolveLibraryTokens(text, ctx = {}) {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now ?? Date.now());
  const person = nameParts(ctx.authorName, ctx.authorEmail);
  const values = {
    'author.name': person.name,
    'author.full_name': person.name,
    'author.first_name': person.first,
    'author.last_name': person.last,
    'author.initials': person.initials,
    'author.email': ctx.authorEmail || '',
    'document.name': String(ctx.documentName || '').replace(/\.pdf$/i, ''),
    'project.name': ctx.projectName || '',
    'page.number': ctx.pageNumber != null ? String(ctx.pageNumber) : '',
  };
  return text.replace(TOKEN_RE, (match, rawKey, format) => {
    const key = rawKey.toLowerCase();
    if (key === 'date') return formatLibraryDate(now, format || 'MMM D, YYYY');
    if (key === 'time') return formatLibraryDate(now, format || 'h:mm A');
    const value = values[key];
    return value ? value : match;
  });
}

export const hasLibraryTokens = (text) => typeof text === 'string' && /\{\{\s*[a-z_.]+/i.test(text);

/** True when any text in the payload holds a token (the item card shows a badge). */
export function payloadHasTokens(payload) {
  return (payload?.items || []).some((item) => hasLibraryTokens(item.kind === 'callout' ? item.callout?.text : item.object?.text));
}

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

/**
 * The clipboard to paste for one placement of `payload`, and how far to move
 * it so the group's centre lands on `point` (page units) without leaving the
 * page.
 * @param {object} payload
 * @param {object} opts
 *   point        { x, y } page units, or null for the page centre
 *   pageWidth / pageHeight   the landing page
 *   tokens       resolveLibraryTokens context (pageNumber filled in here)
 *   landingScale the landing page's measure scale (pageScaleFromObjects), or null
 *   pageNumber
 * @returns {{ clipboard, dx, dy } | null}
 */
export function planLibraryPlacement(payload, {
  point = null,
  pageWidth = 612,
  pageHeight = 792,
  tokens = {},
  landingScale = null,
  pageNumber = null,
} = {}) {
  const clean = sanitizeLibraryPayload(payload);
  if (!clean) return null;
  const tokenCtx = { ...tokens, pageNumber };
  const items = clean.items.map((item) => {
    if (item.kind === 'mark') {
      const object = item.object;
      if (typeof object.text === 'string') object.text = resolveLibraryTokens(object.text, tokenCtx);
      if (landingScale && object.data?.measure?.kind) {
        object.data = { ...object.data, measure: { ...object.data.measure, scale: { ...landingScale } } };
      }
      return item;
    }
    if (item.kind === 'callout' && typeof item.callout.text === 'string') {
      item.callout.text = resolveLibraryTokens(item.callout.text, tokenCtx);
    }
    return item;
  });
  const extent = clean.extent;
  const target = point && finite(point.x) && finite(point.y)
    ? { x: Number(point.x), y: Number(point.y) }
    : { x: pageWidth / 2, y: pageHeight / 2 };
  let dx = target.x - (extent.left + extent.width / 2);
  let dy = target.y - (extent.top + extent.height / 2);
  // Keep the whole group on the page; a group bigger than the page sits at its top-left.
  const left = extent.left + dx;
  const top = extent.top + dy;
  if (extent.width >= pageWidth) dx -= left; else if (left < 0) dx -= left; else if (left + extent.width > pageWidth) dx -= left + extent.width - pageWidth;
  if (extent.height >= pageHeight) dy -= top; else if (top < 0) dy -= top; else if (top + extent.height > pageHeight) dy -= top + extent.height - pageHeight;
  return {
    clipboard: { ...clean, items, sourcePageNumber: null, mode: 'copy' },
    dx,
    dy,
  };
}

// ---------------------------------------------------------------------------
// Export / import (Drawboard's .drawboardmarkups, ours is .surveymarks JSON)
// ---------------------------------------------------------------------------

export function buildLibraryExportFile(items, { now = new Date() } = {}) {
  return JSON.stringify({
    format: LIBRARY_EXPORT_FORMAT,
    version: LIBRARY_PAYLOAD_VERSION,
    exportedAt: new Date(now).toISOString(),
    items: (items || []).map((item) => ({
      name: cleanLibraryName(item.name),
      tags: cleanLibraryTags(item.tags),
      payload: item.payload,
    })),
  });
}

export function libraryExportFileName(now = new Date()) {
  return `${formatLibraryDate(now, 'YYYY-MM-DD')} Marks${LIBRARY_EXPORT_EXTENSION}`;
}

/**
 * Read an exported file. Returns { items: [{ name, tags, payload, kinds }], skipped }
 * or { error } with a sentence for the person.
 */
export function parseLibraryImportFile(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch {
    return { error: 'That file is not a mark library file.' };
  }
  if (!data || data.format !== LIBRARY_EXPORT_FORMAT || !Array.isArray(data.items)) {
    return { error: 'That file is not a mark library file.' };
  }
  if (Number(data.version) > LIBRARY_PAYLOAD_VERSION) {
    return { error: 'That file comes from a newer Survey. Update the app and try again.' };
  }
  const items = [];
  let skipped = 0;
  for (const raw of data.items.slice(0, LIBRARY_IMPORT_MAX_ITEMS)) {
    const payload = sanitizeLibraryPayload(raw?.payload);
    if (!payload || libraryPayloadBytes(payload) > LIBRARY_PAYLOAD_MAX_BYTES) { skipped += 1; continue; }
    items.push({
      name: cleanLibraryName(raw?.name) || defaultLibraryItemName(payload),
      tags: cleanLibraryTags(raw?.tags),
      payload,
      kinds: summarizeLibraryKinds(payload),
    });
  }
  skipped += Math.max(0, data.items.length - LIBRARY_IMPORT_MAX_ITEMS);
  if (items.length === 0) return { error: 'There were no marks in that file that Survey can use.' };
  return { items, skipped };
}

// ---------------------------------------------------------------------------
// Database rows
// ---------------------------------------------------------------------------

/** A mark_library_items row as the app's item. Null when its payload is unusable. */
export function libraryItemFromRow(row) {
  if (!row?.id) return null;
  const payload = sanitizeLibraryPayload(row.payload);
  if (!payload) return null;
  return {
    id: row.id,
    library: row.library === 'project' ? 'project' : 'personal',
    projectId: row.project_id ?? null,
    createdBy: row.created_by ?? null,
    name: cleanLibraryName(row.name) || defaultLibraryItemName(payload),
    tags: cleanLibraryTags(row.tags || []),
    kinds: Array.isArray(row.kinds) && row.kinds.length ? row.kinds : summarizeLibraryKinds(payload),
    payload,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
  };
}

export function libraryRowFromItem({ library, projectId = null, name, tags = [], payload }) {
  return {
    library: library === 'project' ? 'project' : 'personal',
    project_id: library === 'project' ? projectId : null,
    name: cleanLibraryName(name) || defaultLibraryItemName(payload),
    tags: cleanLibraryTags(tags),
    kinds: summarizeLibraryKinds(payload),
    payload,
  };
}
