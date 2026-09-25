// src/services/annotationMarkCodec.js
//
// Compact stored form of a mark (w33, 2026-09-25). Design note:
// docs/ANNOTATION-FIELD-SYNC.md ("Small snapshots").
//
// "Package 2 - Rev 4 -- IC.pdf" stored each imported ink mark 4-5 ways: the
// live `path`, the `polygons` derived from it (clipping / hit-testing), and
// the PDF's own source geometry (`data.pdfInkSourceGeometry`: InkList, the
// appearance path, and every paint operation with its path again). The store
// now keeps ONE geometry, the live `path`:
//
//   * `data.pdfInkSourceGeometry` is not stored. It is provenance only (the
//     importer classifies its own output from it before anything is stored;
//     no renderer, editor, eraser or exporter reads it back from a stored
//     mark), and the PDF file itself still carries it. Owner ruling
//     2026-09-24: no users, data disposable, no old-build compatibility.
//   * `polygons` that are EXACTLY what `filledOutlineCommandsToPolygonSet`
//     makes from the mark's own `path` are stored as a short marker string
//     naming the fill rule used, and rebuilt on read. "Exactly" is checked
//     at write time, number for number (Object.is), so a read gives back the
//     very same numbers; anything else (erased marks, user pen strokes,
//     floating-point differences) keeps its explicit array.
//
// Every write goes through toStoredMarkObject and every read through
// fromStoredMarkObject (annotationMarkStore.js), so the rest of the app only
// ever sees plain marks with real polygons.
//
// Pure module: runs in Node tests.

import { filledOutlineCommandsToPolygonSet } from '../utils/paperAnnotationGeometry.js';

// The marker names the derivation, so a stored value can never be read with a
// different rule than the one checked when it was written. v1 = the default
// curve tolerance of filledOutlineCommandsToPolygonSet (0.05). If that
// function's output ever changes, bump the version (tests pin it).
export const DERIVED_POLYGONS_PREFIX = '~polygons-from-path:v1:';
const DERIVED_RULES = ['nonzero', 'evenodd'];

export const UNSTORED_DATA_FIELDS = Object.freeze(['pdfInkSourceGeometry']);

function isPlainRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactlyEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!exactlyEqual(left[index], right[index])) return false;
  }
  return true;
}

export function derivePolygonsFromPath(path, fillRule) {
  if (!Array.isArray(path) || path.length === 0) return [];
  try {
    return filledOutlineCommandsToPolygonSet(path, { fillRule });
  } catch {
    return null;
  }
}

/** The fill rule whose derivation reproduces `polygons` exactly, or null. */
function derivableRule(object) {
  const { polygons, path } = object;
  if (!Array.isArray(polygons) || polygons.length === 0) return null;
  if (!Array.isArray(path) || path.length === 0) return null;
  const preferred = object.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  const rules = [preferred, ...DERIVED_RULES.filter((rule) => rule !== preferred)];
  for (const rule of rules) {
    const derived = derivePolygonsFromPath(path, rule);
    if (derived && exactlyEqual(derived, polygons)) return rule;
  }
  return null;
}

export function isDerivedPolygonsMarker(value) {
  return typeof value === 'string' && value.startsWith(DERIVED_POLYGONS_PREFIX);
}

/**
 * The form a mark is stored in. Returns `object` itself when nothing changes
 * (never mutates it).
 */
export function toStoredMarkObject(object) {
  if (!isPlainRecord(object)) return object;
  let out = object;
  if (isPlainRecord(object.data) && UNSTORED_DATA_FIELDS.some((key) => object.data[key] !== undefined)) {
    const data = { ...object.data };
    for (const key of UNSTORED_DATA_FIELDS) delete data[key];
    out = { ...out, data };
  }
  const rule = derivableRule(object);
  if (rule) out = { ...out, polygons: `${DERIVED_POLYGONS_PREFIX}${rule}` };
  return out;
}

/**
 * A stored mark as the app sees it (derived polygons rebuilt). Returns
 * `object` itself when nothing changes; otherwise a shallow copy.
 */
export function fromStoredMarkObject(object) {
  if (!isPlainRecord(object) || !isDerivedPolygonsMarker(object.polygons)) return object;
  const rule = object.polygons.slice(DERIVED_POLYGONS_PREFIX.length);
  const derived = DERIVED_RULES.includes(rule) ? derivePolygonsFromPath(object.path, rule) : null;
  const out = { ...object };
  // An unknown marker (a newer build's) or a path the derivation cannot
  // read: no polygons rather than a string where an array belongs. The
  // renderer draws from `path`; polygons are clipping / hit-testing only.
  if (Array.isArray(derived)) out.polygons = derived;
  else delete out.polygons;
  return out;
}

/** True when the stored form of `object` differs from `object`. */
export function markHasCompactStoredForm(object) {
  return toStoredMarkObject(object) !== object;
}

/**
 * A page map ({ [page]: { objects } }) whose marks carry none of the fields
 * the store does not keep. Used on the embedded import's result before it
 * reaches the screen, so the screen's copies equal what the store reads back
 * (an erase compares the two). Pages and objects without such fields are
 * returned as they are.
 */
export function withoutUnstoredFieldsByPage(byPage) {
  if (!byPage || typeof byPage !== 'object') return byPage;
  let changed = false;
  const out = {};
  for (const [pageKey, page] of Object.entries(byPage)) {
    const objects = Array.isArray(page?.objects) ? page.objects : null;
    if (!objects) { out[pageKey] = page; continue; }
    let pageChanged = false;
    const next = objects.map((object) => {
      if (!isPlainRecord(object?.data) || !UNSTORED_DATA_FIELDS.some((key) => object.data[key] !== undefined)) return object;
      pageChanged = true;
      const data = { ...object.data };
      for (const key of UNSTORED_DATA_FIELDS) delete data[key];
      return { ...object, data };
    });
    out[pageKey] = pageChanged ? { ...page, objects: next } : page;
    changed = changed || pageChanged;
  }
  return changed ? out : byPage;
}
