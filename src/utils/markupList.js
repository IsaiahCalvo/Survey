// The Markups list (Nightly flag 'markup-list', Drawboard Projects + PDF Pro
// trial audit 2026-11-09): every mark in the document in one list, grouped
// by kind, with who made it, a search, kind / person / layer filters,
// "measurements only", measurement totals and a CSV copy (with each
// measurement's quantity and unit). Drawboard has this; Survey only had
// History (changes, not marks).
//
// Pure part: the page lists in, rows out.
import { historyTypeKey } from './historyFeed.js';
import { getAnnotationAuthorId } from '../lib/collab/permissionScope.js';
import { normalizeLayerState, resolveLayerId } from './layers.js';
import {
  MEASURE_UNITS,
  buildMeasureLabel,
  getMeasureKind,
  isValidMeasureScale,
  pageScaleFromObjects,
} from './measure/measureScale.js';

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
  // A measurement someone named ("Room 101") lists by its name.
  if (getMeasureKind(obj) && typeof data.measure?.label === 'string' && data.measure.label.trim()) {
    return data.measure.label.replace(/\s+/g, ' ').trim();
  }
  if (getMeasureKind(obj)) {
    try {
      const label = buildMeasureLabel(obj, data.measure?.scale || null);
      // A caption's lines read on one row; with every line switched off the
      // row still shows the reading.
      if (label?.text) return String(label.text).replace(/\s*\n\s*/g, ' · ');
      if (label?.reading) return String(label.reading);
    } catch { /* a broken measure still lists, without its reading */ }
  }
  const raw = typeof obj?.text === 'string' ? obj.text
    : typeof data.text === 'string' ? data.text
      : typeof data.calloutText === 'string' ? data.calloutText
        : typeof data.label === 'string' ? data.label
          // A callout is a group: its words ride on the box child and the
          // callout record it was drawn from.
          : typeof data.legacyCallout?.text === 'string' ? data.legacyCallout.text
            : (calloutBoxOf(obj)?.text ?? '');
  return String(raw).replace(/\s+/g, ' ').trim();
}

function calloutBoxOf(obj) {
  if (obj?.data?.type !== 'callout' || !Array.isArray(obj?.objects)) return null;
  return obj.objects.find((child) => child?.data?.calloutPart === 'textBox') || null;
}

// "rgba(255, 0, 0, 1)" reads as "#FF0000" (with an alpha pair when see-through),
// the way every other colour in the list and the CSV is written.
function plainColour(value) {
  if (typeof value !== 'string') return value;
  const m = value.trim().match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (!m) return value;
  const hex = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0').toUpperCase();
  let alpha = m[4] == null ? 1 : (m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]));
  if (!Number.isFinite(alpha)) alpha = 1;
  const base = `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  return alpha >= 1 ? base : `${base}${hex(alpha * 255)}`;
}

function colorOf(obj) {
  // A counter's colour is its disc (its ring is white).
  const counter = obj?.data?.type === 'counter' && typeof obj?.fill === 'string' && obj.fill !== 'transparent';
  // A callout's colour is its border (the group itself has none).
  const callout = obj?.data?.type === 'callout'
    ? (obj.data.legacyCallout?.style?.borderColor || obj.data.legacyCallout?.style?.lineColor || calloutBoxOf(obj)?.stroke || null)
    : null;
  const c = callout || (counter ? obj.fill : (obj?.stroke && obj.stroke !== 'transparent' ? obj.stroke : obj?.fill));
  return typeof c === 'string' && c !== 'transparent' && c !== '' ? plainColour(c) : null;
}

// One shape for Created: an ISO time, whether the mark kept a time string or
// a raw epoch number (counters stamp Date.now()).
function createdAtOf(obj) {
  const legacy = obj?.data?.legacyCallout;
  const raw = obj?.meta?.createdAt || obj?.data?.createdAt || legacy?.meta?.createdAt || legacy?.createdAt
    || obj?.data?.measure?.createdAt || obj?.createdAt || null;
  if (raw == null || raw === '') return null;
  const asNumber = typeof raw === 'number' ? raw : (/^\d{10,13}$/.test(String(raw)) ? Number(raw) : null);
  if (asNumber != null) {
    const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return String(raw);
}

const MEASURE_NAMES = {
  length: 'Length',
  perimeter: 'Perimeter',
  polylength: 'Polylength',
  area: 'Area',
  wallArea: 'Wall area',
  volume: 'Volume',
};
// What a quantity measures, so totals only add like with like.
const DIMENSION = { length: 'length', perimeter: 'length', polylength: 'length', area: 'area', wallArea: 'area', volume: 'volume' };
const PT_PER_INCH = 72;

/**
 * A measurement's real quantity: { kind, name, text, quantity, unit,
 * dimension, scaled }. Without a page scale the quantity is in paper inches,
 * as the label says.
 */
export function measureQuantity(object, pageScale = null) {
  const kind = getMeasureKind(object);
  if (!kind) return null;
  const own = object?.data?.measure?.scale;
  const scale = isValidMeasureScale(own) ? own : (isValidMeasureScale(pageScale) ? pageScale : null);
  let label = null;
  try { label = buildMeasureLabel(object, scale); } catch { label = null; }
  if (!label || !Number.isFinite(label.value)) return null;
  const dimension = DIMENSION[kind];
  const per = scale ? scale.ptPerUnit : PT_PER_INCH;
  const units = MEASURE_UNITS[scale ? scale.unit : 'in'] || MEASURE_UNITS.in;
  // wallArea's value is perimeter x depth (depth already real); volume's is
  // area x depth.
  let quantity;
  if (kind === 'wallArea') quantity = label.value / per;
  else if (kind === 'volume' || kind === 'area') quantity = label.value / (per * per);
  else quantity = label.value / per;
  const unit = dimension === 'length' ? units.label : (dimension === 'area' ? units.area : units.volume);
  return { kind, name: MEASURE_NAMES[kind], text: String(label.text || ''), quantity: Math.round(quantity * 1000) / 1000, unit, dimension, scaled: Boolean(scale) };
}

function idOf(obj, pageNumber, index) {
  const id = obj?.id ?? obj?.data?.id ?? obj?.meta?.id;
  return id != null ? String(id) : `p${pageNumber}-i${index}`;
}

/**
 * Every listable mark: { id, pageNumber, index, kind, kindLabel, text,
 * color, authorId, createdAt, calloutId, measure, layerId, layerName }.
 * Pages in order, marks in stacking order. `byPage` = { [page]: { objects } };
 * `layerState` (Layers beta) names each mark's layer.
 */
export function buildMarkupRows(byPage, { layerState = null } = {}) {
  const layers = normalizeLayerState(layerState);
  const layerNames = new Map(layers.layers.map((layer) => [layer.id, layer.name]));
  const rows = [];
  const pages = Object.keys(byPage || {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  for (const pageNumber of pages) {
    const objects = (byPage[pageNumber] || byPage[String(pageNumber)])?.objects;
    if (!Array.isArray(objects)) continue;
    const pageScale = pageScaleFromObjects(objects);
    objects.forEach((obj, index) => {
      if (!obj || obj.visible === false || obj?.data?.helper) return;
      const kind = kindOf(obj);
      if (SKIP_KINDS.has(kind)) return;
      const listed = KIND_WORD[kind] ? kind : 'mark';
      const layerId = layerState ? resolveLayerId(obj, layers) : null;
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
        measure: listed === 'measure' ? measureQuantity(obj, pageScale) : null,
        layerId,
        layerName: layerId ? (layerNames.get(layerId) || '') : '',
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
 * Rows that match the search words (kind, text, measurement, layer, page
 * "p3" / "page 3", author) and the picked kinds / authors / layers, and only
 * measurements when `measuresOnly`. Empty filters keep everything.
 */
export function filterMarkupRows(rows, {
  query = '', kinds = null, authors = null, layers = null, measuresOnly = false, labelFor = null,
} = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (rows || []).filter((row) => {
    if (kinds && kinds.size > 0 && !kinds.has(row.kind)) return false;
    if (authors && authors.size > 0 && !authors.has(row.authorId || '')) return false;
    if (layers && layers.size > 0 && !layers.has(row.layerId || '')) return false;
    if (measuresOnly && !row.measure) return false;
    if (!words.length) return true;
    const hay = [
      row.kindLabel,
      row.text,
      row.measure?.name,
      row.measure?.text,
      row.measure?.unit,
      row.layerName,
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

/**
 * Totals of the measurements in `rows`, like with like (same kind, same
 * unit): [{ kind, name, unit, quantity, count }], in measure order.
 */
export function markupTotals(rows) {
  const totals = new Map();
  for (const row of rows || []) {
    const m = row.measure;
    if (!m) continue;
    const key = `${m.kind}|${m.unit}`;
    const item = totals.get(key) || { kind: m.kind, name: m.name, unit: m.unit, quantity: 0, count: 0 };
    item.quantity += m.quantity;
    item.count += 1;
    totals.set(key, item);
  }
  const order = Object.keys(MEASURE_NAMES);
  return [...totals.values()]
    .map((t) => ({ ...t, quantity: Math.round(t.quantity * 100) / 100 }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.unit.localeCompare(b.unit));
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The rows as CSV text (header + one line per mark). A measurement's
 * Quantity is a plain number in its Unit, so a spreadsheet can add it up.
 */
export function markupRowsToCsv(rows, { labelFor = null } = {}) {
  const lines = [['Page', 'Kind', 'Text', 'Colour', 'Author', 'Created', 'Quantity', 'Unit', 'Layer'].join(',')];
  for (const row of rows || []) {
    lines.push([
      row.pageNumber,
      row.kindLabel,
      row.text,
      row.color || '',
      labelFor ? labelFor(row.authorId) : (row.authorId || ''),
      row.createdAt || '',
      row.measure ? row.measure.quantity : '',
      row.measure?.unit || '',
      row.layerName || '',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
