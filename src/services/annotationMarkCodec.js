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
//     makes from the mark's own `path` with the mark's own `fillRule`
//     ('evenodd', else 'nonzero') are stored as a short marker string and
//     rebuilt on read. "Exactly" is checked at write time, number for number
//     (Object.is), so a read gives back the very same numbers; anything else
//     (user pen strokes, floating-point differences, a derivation made with
//     another rule) keeps its explicit array. The marker names no rule on
//     purpose: `path`, `fillRule` and `polygons` are separate stored keys, so
//     after concurrent edits the marker always rebuilds from the path AND
//     rule that won (review A, w33).
//
// Every write goes through toStoredMarkObject and every read through
// fromStoredMarkObject (annotationMarkStore.js), so the rest of the app only
// ever sees plain marks with real polygons.
//
// Pure module: runs in Node tests.

import { filledOutlineCommandsToPolygonSet } from '../utils/paperAnnotationGeometry.js';

// v1 = filledOutlineCommandsToPolygonSet with its default curve tolerance
// (0.05) and the mark's own fill rule. If that function's output ever
// changes, bump the version (tests pin it); a marker a build does not know
// reads as no polygons.
export const DERIVED_POLYGONS_PREFIX = '~polygons-from-path:';
export const DERIVED_POLYGONS_MARKER = `${DERIVED_POLYGONS_PREFIX}v1`;

export function polygonFillRuleOf(object) {
  return object?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
}

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

/** Whether the mark's own path and fill rule reproduce `polygons` exactly. */
function polygonsDerivable(object) {
  const { polygons, path } = object;
  if (!Array.isArray(polygons) || polygons.length === 0) return false;
  if (!Array.isArray(path) || path.length === 0) return false;
  const derived = derivePolygonsFromPath(path, polygonFillRuleOf(object));
  return Boolean(derived) && exactlyEqual(derived, polygons);
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
  if (polygonsDerivable(object)) out = { ...out, polygons: DERIVED_POLYGONS_MARKER };
  return out;
}

/**
 * A stored mark as the app sees it (derived polygons rebuilt). Returns
 * `object` itself when nothing changes; otherwise a shallow copy.
 */
export function fromStoredMarkObject(object) {
  if (!isPlainRecord(object) || !isDerivedPolygonsMarker(object.polygons)) return object;
  const out = { ...object };
  // An unknown marker (a newer build's): no polygons rather than a string
  // where an array belongs. The renderer draws from `path`; polygons are
  // clipping / hit-testing only.
  if (object.polygons !== DERIVED_POLYGONS_MARKER) {
    delete out.polygons;
    return out;
  }
  // Rebuilt the first time something reads them (2026-11-10): an open
  // decoded every imported ink mark's outline with polygon clipping (~0.12 s
  // of a phone's cold open on a 36-sheet set) though only hit-testing and
  // the eraser read them. The property is an ordinary enumerable one to
  // every reader (spread, JSON, structured clone, Object.keys); on first
  // read it turns into a plain data property. A path the derivation cannot
  // read gives no polygons (the key reads as undefined).
  const { path } = object;
  const fillRule = polygonFillRuleOf(object);
  let derived;
  let done = false;
  const derive = () => {
    if (!done) {
      done = true;
      const value = derivePolygonsFromPath(path, fillRule);
      derived = Array.isArray(value) ? value : undefined;
    }
    return derived;
  };
  Object.defineProperty(out, 'polygons', {
    configurable: true,
    enumerable: true,
    get() {
      const value = derive();
      settle(this, value);
      return value;
    },
    set(value) {
      settle(this, value);
    },
  });
  return out;
}

function settle(target, value) {
  try {
    if (value === undefined) delete target.polygons;
    else Object.defineProperty(target, 'polygons', { value, writable: true, enumerable: true, configurable: true });
  } catch { /* frozen: keeps answering from the cached value */ }
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
