// Markup list (Nightly, flag 'markup-list'; Drawboard deep test gap): every
// mark on the document in one list, with search, filters, measurement values
// and totals, and a CSV of what the list shows. Pure: no React, no Supabase,
// so node tests import it (tests/markupList.test.mjs).

import { historyGlyphFor, historyTypeKey } from '../utils/historyFeed.js';
import { getAnnotationAuthorId, getSurveyMarkerAuthorId } from '../lib/collab/permissionScope.js';
import { normalizeLayerState, resolveLayerId } from '../utils/layers.js';
import {
  MEASURE_UNITS,
  buildMeasureLabel,
  getMeasureKind,
  isValidMeasureScale,
  pageScaleFromObjects,
} from '../utils/measure/measureScale.js';

export const NO_AUTHOR = 'pdf';

const TYPE_NAMES = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  polyline: 'Polyline',
  polygon: 'Polygon',
  cloud: 'Cloud',
  pen: 'Pen',
  highlighter: 'Highlighter',
  text: 'Text box',
  callout: 'Callout',
  counter: 'Counter',
  surveyMarker: 'Survey Marker',
  image: 'Image',
  markup: 'Text highlight',
  formField: 'Form field',
  mark: 'Mark',
};

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

const markId = (object) => object?.data?.id || object?.data?.annoId || object?.id || object?.annotationId || object?.pdfAnnotationId || null;

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function markText(object) {
  const data = object?.data || {};
  return cleanText(object?.text) || cleanText(data.text) || cleanText(data.calloutText) || cleanText(data.label) || cleanText(data.contents);
}

function markColor(object) {
  for (const value of [object?.stroke, object?.fill, object?.data?.color]) {
    if (typeof value === 'string' && value && value !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(value)) return value;
  }
  return '';
}

/**
 * A measurement's real quantity: { kind, text, quantity, unit, dimension }.
 * Without a page scale the quantity is in paper inches, as the label says.
 */
export function measureQuantity(object, pageScale = null) {
  const kind = getMeasureKind(object);
  if (!kind) return null;
  const own = object?.data?.measure?.scale;
  const scale = isValidMeasureScale(own) ? own : (isValidMeasureScale(pageScale) ? pageScale : null);
  const label = buildMeasureLabel(object, scale);
  if (!label) return null;
  const dimension = DIMENSION[kind];
  const per = scale ? scale.ptPerUnit : PT_PER_INCH;
  const unitKey = scale ? scale.unit : 'in';
  const units = MEASURE_UNITS[unitKey] || MEASURE_UNITS.in;
  let quantity;
  // wallArea's value is perimeter x depth (depth already real); volume's is area x depth.
  if (kind === 'wallArea') quantity = label.value / per;
  else if (kind === 'volume' || kind === 'area') quantity = label.value / (per * per);
  else quantity = label.value / per;
  const unit = dimension === 'length' ? units.label : (dimension === 'area' ? units.area : units.volume);
  return { kind, name: MEASURE_NAMES[kind], text: label.text, quantity: Math.round(quantity * 1000) / 1000, unit, dimension, scaled: Boolean(scale) };
}

/**
 * Every mark as one row, page by page: { id, kind: 'mark' | 'surveyMarker',
 * pageNumber, typeKey, typeName, glyph, text, color, authorId, layerId,
 * layerName, measure }. Callouts appear once (their page object).
 */
export function markupRows({ annotationsByPage = {}, surveyMarkers = {}, layerState = null } = {}) {
  const layers = normalizeLayerState(layerState);
  const layerName = new Map(layers.layers.map((l) => [l.id, l.name]));
  const rows = [];
  const pages = Object.keys(annotationsByPage || {}).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  for (const pageNumber of pages) {
    const objects = annotationsByPage[pageNumber]?.objects || annotationsByPage[String(pageNumber)]?.objects || [];
    const pageScale = pageScaleFromObjects(objects);
    objects.forEach((object, index) => {
      if (!object || typeof object !== 'object') return;
      const typeKey = historyTypeKey(object?.data?.type || object?.type, object);
      if (typeKey === 'space' || typeKey === 'region') return;
      const measure = measureQuantity(object, pageScale);
      const authorId = getAnnotationAuthorId(object);
      const layerId = resolveLayerId(object, layers);
      rows.push({
        id: String(markId(object) ?? `p${pageNumber}-${index}`),
        kind: 'mark',
        pageNumber,
        typeKey,
        typeName: measure ? measure.name : (TYPE_NAMES[typeKey] || 'Mark'),
        glyph: historyGlyphFor(typeKey),
        text: markText(object),
        color: markColor(object),
        authorId: typeof authorId === 'string' && authorId ? authorId : NO_AUTHOR,
        layerId,
        layerName: layerName.get(layerId) || '',
        measure,
      });
    });
  }
  const markers = Object.entries(surveyMarkers || {})
    .filter(([, m]) => m && typeof m === 'object' && !m.deletedAt && !m.deleted && Number(m.pageNumber) > 0)
    .sort((a, b) => Number(a[1].pageNumber) - Number(b[1].pageNumber) || String(a[1].name || '').localeCompare(String(b[1].name || '')));
  for (const [id, marker] of markers) {
    const authorId = getSurveyMarkerAuthorId(marker);
    rows.push({
      id: String(id),
      kind: 'surveyMarker',
      pageNumber: Number(marker.pageNumber),
      typeKey: 'surveyMarker',
      typeName: TYPE_NAMES.surveyMarker,
      glyph: historyGlyphFor('surveyMarker'),
      text: cleanText(marker.name),
      color: '',
      authorId: typeof authorId === 'string' && authorId ? authorId : NO_AUTHOR,
      layerId: null,
      layerName: '',
      measure: null,
    });
  }
  return rows.sort((a, b) => a.pageNumber - b.pageNumber);
}

/** The choices a filter offers, from the rows: [{ id, label, count }], most first. */
export function markupFacets(rows, { nameOf = () => '' } = {}) {
  const count = (keyOf, labelOf) => {
    const map = new Map();
    for (const row of rows || []) {
      const key = keyOf(row);
      if (key == null || key === '') continue;
      const item = map.get(key) || { id: key, label: labelOf(row), count: 0 };
      item.count += 1;
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  return {
    types: count((r) => r.typeName, (r) => r.typeName),
    authors: count((r) => r.authorId, (r) => (r.authorId === NO_AUTHOR ? 'No author' : (nameOf(r.authorId) || 'Someone'))),
    layers: count((r) => r.layerId, (r) => r.layerName || 'Default layer'),
  };
}

/**
 * Rows that match `query` (type, words, measurement, author, page "p3") and
 * every chosen filter ({ types, authors, layers }: arrays, or null for all;
 * measuresOnly).
 */
export function filterMarkupRows(rows, { query = '', types = null, authors = null, layers = null, measuresOnly = false } = {}, { nameOf = () => '' } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const typeSet = Array.isArray(types) ? new Set(types) : null;
  const authorSet = Array.isArray(authors) ? new Set(authors) : null;
  const layerSet = Array.isArray(layers) ? new Set(layers) : null;
  return (rows || []).filter((row) => {
    if (typeSet && !typeSet.has(row.typeName)) return false;
    if (authorSet && !authorSet.has(row.authorId)) return false;
    if (layerSet && !layerSet.has(row.layerId)) return false;
    if (measuresOnly && !row.measure) return false;
    if (words.length === 0) return true;
    const author = row.authorId === NO_AUTHOR ? 'no author' : String(nameOf(row.authorId) || '');
    const hay = [row.typeName, row.text, row.measure?.text, row.measure?.unit, author, row.layerName, `p${row.pageNumber}`, `page ${row.pageNumber}`]
      .join(' ')
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Totals of the measurements in `rows`, like with like: [{ name, quantity, unit }]. */
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

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) || /^[=+\-@\t\r]/.test(text)
    ? `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
    : text;
};

/** The list as CSV, in list order (deliverCsv adds the BOM Excel needs). */
export function markupCsv(rows, { nameOf = () => '', documentName = '' } = {}) {
  const out = [['Document', 'Page', 'Type', 'Text', 'Measurement', 'Quantity', 'Unit', 'Author', 'Layer', 'Color']];
  for (const row of rows || []) {
    out.push([
      documentName,
      row.pageNumber,
      row.typeName,
      row.text,
      row.measure?.text || '',
      row.measure ? row.measure.quantity : '',
      row.measure?.unit || '',
      row.authorId === NO_AUTHOR ? 'No author' : (nameOf(row.authorId) || 'Someone'),
      row.layerName,
      row.color,
    ]);
  }
  return `${out.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** "Plan A-101 markups.csv" beside the PDF. */
export function markupCsvFileName(pdfName) {
  const base = String(pdfName || 'Document').replace(/\.pdf$/i, '').trim() || 'Document';
  return `${base} markups.csv`;
}
