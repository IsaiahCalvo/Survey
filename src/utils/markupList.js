// The Markups list (Nightly flag 'markup-list', Drawboard Projects + PDF Pro
// trial audit 2026-11-09): every mark in the document in one list, grouped
// by kind, with who made it, a search, a kind filter and a CSV copy.
// Drawboard has this; Survey only had History (changes, not marks).
//
// Pure part: the page lists in, rows out.
import { historyTypeKey } from './historyFeed.js';
import { getAnnotationAuthorId } from '../lib/collab/permissionScope.js';
import { buildMeasureLabel, getMeasureKind } from './measure/measureScale.js';

// Kinds the list shows, in this order, with their words.
export const MARKUP_KINDS = Object.freeze([
  ['cloud', 'Cloud', 'Clouds'],
  ['callout', 'Callout', 'Callouts'],
  ['text', 'Text box', 'Text boxes'],
  ['rect', 'Rectangle', 'Rectangles'],
  ['ellipse', 'Ellipse', 'Ellipses'],
  ['polygon', 'Polygon', 'Polygons'],
  ['polyline', 'Polyline', 'Polylines'],
  ['line', 'Line', 'Lines'],
  ['arrow', 'Arrow', 'Arrows'],
  ['measure', 'Measurement', 'Measurements'],
  ['counter', 'Counter', 'Counters'],
  ['pen', 'Pen', 'Pen strokes'],
  ['highlighter', 'Highlighter', 'Highlighter strokes'],
  ['markup', 'Text highlight', 'Text highlights'],
  ['image', 'Image or stamp', 'Images and stamps'],
  ['mark', 'Other mark', 'Other marks'],
]);
const KIND_WORD = Object.fromEntries(MARKUP_KINDS.map(([key, one]) => [key, one]));
const KIND_ORDER = Object.fromEntries(MARKUP_KINDS.map(([key], i) => [key, i]));

// Page furniture the list leaves out: Spaces' regions, form fields, Survey
// Markers (they have their own panel), and helper objects.
const SKIP_KINDS = new Set(['space', 'region', 'formField', 'surveyMarker']);

function kindOf(obj) {
  const data = obj?.data || {};
  if (getMeasureKind(obj)) return 'measure';
  if (data.type === 'counter') return 'counter'; // drawn as a circle, listed as what it is
  const type = data.type === 'callout' ? 'callout' : (data.type === 'text-markup' ? 'text-markup' : obj?.type);
  return historyTypeKey(type, obj);
}

function textOf(obj) {
  const data = obj?.data || {};
  if (getMeasureKind(obj)) {
    try {
      const label = buildMeasureLabel(obj, data.measure?.scale || null);
      if (label?.text) return String(label.text);
    } catch { /* a broken measure still lists, without its reading */ }
  }
  const raw = typeof obj?.text === 'string' ? obj.text
    : typeof data.text === 'string' ? data.text
      : typeof data.calloutText === 'string' ? data.calloutText
        : typeof data.label === 'string' ? data.label : '';
  return raw.replace(/\s+/g, ' ').trim();
}

function colorOf(obj) {
  // A counter's colour is its disc (its ring is white).
  const counter = obj?.data?.type === 'counter' && typeof obj?.fill === 'string' && obj.fill !== 'transparent';
  const c = counter ? obj.fill : (obj?.stroke && obj.stroke !== 'transparent' ? obj.stroke : obj?.fill);
  return typeof c === 'string' && c !== 'transparent' ? c : null;
}

// One shape for Created: an ISO time, whether the mark kept a time string or
// a raw epoch number (counters stamp Date.now()).
function createdAtOf(obj) {
  const raw = obj?.meta?.createdAt || obj?.data?.createdAt || null;
  if (raw == null || raw === '') return null;
  const asNumber = typeof raw === 'number' ? raw : (/^\d{10,13}$/.test(String(raw)) ? Number(raw) : null);
  if (asNumber != null) {
    const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return String(raw);
}

function idOf(obj, pageNumber, index) {
  const id = obj?.id ?? obj?.data?.id ?? obj?.meta?.id;
  return id != null ? String(id) : `p${pageNumber}-i${index}`;
}

/**
 * Every listable mark: { id, pageNumber, index, kind, kindLabel, text,
 * color, authorId, createdAt, calloutId }. Pages in order, marks in stacking
 * order. `byPage` = { [page]: { objects } }.
 */
export function buildMarkupRows(byPage) {
  const rows = [];
  const pages = Object.keys(byPage || {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  for (const pageNumber of pages) {
    const objects = (byPage[pageNumber] || byPage[String(pageNumber)])?.objects;
    if (!Array.isArray(objects)) continue;
    objects.forEach((obj, index) => {
      if (!obj || obj.visible === false || obj?.data?.helper) return;
      const kind = kindOf(obj);
      if (SKIP_KINDS.has(kind)) return;
      const listed = KIND_WORD[kind] ? kind : 'mark';
      rows.push({
        id: idOf(obj, pageNumber, index),
        pageNumber,
        index,
        kind: listed,
        kindLabel: KIND_WORD[listed],
        text: textOf(obj),
        color: colorOf(obj),
        authorId: getAnnotationAuthorId(obj) || null,
        createdAt: createdAtOf(obj),
        calloutId: obj?.data?.type === 'callout' && obj?.data?.id != null ? String(obj.data.id) : null,
      });
    });
  }
  return rows;
}

/** Who made a mark, in words: "You", a member's name, or "Someone". */
export function authorLabel(authorId, { viewerId = null, peopleById = null } = {}) {
  if (!authorId) return 'Unknown';
  if (viewerId && String(authorId) === String(viewerId)) return 'You';
  const person = peopleById?.get?.(String(authorId)) || peopleById?.[String(authorId)];
  if (person) return person.name || (person.email ? String(person.email).split('@')[0] : 'Someone');
  return 'Someone';
}

/**
 * Rows that match the search words (kind, text, page "p3" / "page 3", author)
 * and the picked kinds / authors. Empty filters keep everything.
 */
export function filterMarkupRows(rows, { query = '', kinds = null, authors = null, labelFor = null } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (rows || []).filter((row) => {
    if (kinds && kinds.size > 0 && !kinds.has(row.kind)) return false;
    if (authors && authors.size > 0 && !authors.has(row.authorId || '')) return false;
    if (!words.length) return true;
    const hay = [
      row.kindLabel,
      row.text,
      `p${row.pageNumber}`,
      `page ${row.pageNumber}`,
      labelFor ? labelFor(row.authorId) : '',
    ].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Rows grouped by kind, in MARKUP_KINDS order: [{ kind, label, rows }]. */
export function groupMarkupRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    if (!groups.has(row.kind)) groups.set(row.kind, []);
    groups.get(row.kind).push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => (KIND_ORDER[a[0]] ?? 99) - (KIND_ORDER[b[0]] ?? 99))
    .map(([kind, list]) => {
      const entry = MARKUP_KINDS.find(([key]) => key === kind);
      return { kind, label: entry ? entry[2] : 'Other marks', rows: list };
    });
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The rows as CSV text (header + one line per mark). */
export function markupRowsToCsv(rows, { labelFor = null } = {}) {
  const lines = [['Page', 'Kind', 'Text', 'Colour', 'Author', 'Created'].join(',')];
  for (const row of rows || []) {
    lines.push([
      row.pageNumber,
      row.kindLabel,
      row.text,
      row.color || '',
      labelFor ? labelFor(row.authorId) : (row.authorId || ''),
      row.createdAt || '',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
