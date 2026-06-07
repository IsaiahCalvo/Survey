// src/services/annotationDocStore.js
//
// The Yjs source-of-truth engine for annotations (the rebuild core).
//
// This is the PURE, framework-agnostic half: it owns the mapping between the
// app's `annotationsByPage` render shape and a Y.Doc, and the snapshot+tail
// load math. It imports ONLY 'yjs', so it runs unchanged in the browser app and
// in the Node test runner. All browser/Supabase wiring (y-indexeddb, the
// annotation_updates WAL, Realtime) lives in annotationDocSync.js on top of this.
//
// Model — exactly the Google-Docs/Figma shape:
//   * One Y.Doc per document. Annotations live in a single Y.Map keyed by a
//     STABLE annotation id; each value is { p: <pageNumber>, o: <fabricObject> }.
//   * Every mutation is a Yjs update; persistence is an append-only log of those
//     updates plus a periodic full-state snapshot. Open = applyUpdate(snapshot)
//     then replay the tail updates. No "latest-state row" to lose-update on.
//
// The render shape is `annotationsByPage` = { [pageNumber]: { objects: [...] } }.

import * as Y from 'yjs';

export const ANNOTATIONS_MAP = 'annotations';
export const META_MAP = 'annoMeta';
export const SNAPSHOT_ENCODING_VERSION = 1;

/**
 * Stable id for an annotation object. Annotations carry their durable id at
 * `data.id` (the same key the SVG layer + DB conflict key use); fall back to
 * top-level id / annotationId for older shapes. Returns null when there is no
 * usable id (caller skips such objects rather than inventing an unstable key).
 */
export function extractAnnotationId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const id =
    (obj.data && typeof obj.data === 'object' ? obj.data.id : undefined) ??
    obj.id ??
    obj.annotationId;
  return (typeof id === 'string' && id) || (typeof id === 'number' ? String(id) : null);
}

export function getAnnotationsMap(doc) {
  return doc.getMap(ANNOTATIONS_MAP);
}

/** Read a document-level meta value (e.g. the callouts list). */
export function getMetaValue(doc, key) {
  return doc.getMap(META_MAP).get(key);
}

/**
 * Write a document-level meta value, but only if it actually changed (JSON
 * compare), so re-setting identical state produces zero Yjs updates.
 */
export function setMetaValue(doc, key, value, origin = 'local') {
  const map = doc.getMap(META_MAP);
  const prev = map.get(key);
  if (stableStringify(prev) === stableStringify(value)) return false;
  doc.transact(() => { map.set(key, value); }, origin);
  return true;
}

// --- Survey markers (highlights) ---------------------------------------------
//
// Survey markers are NOT Fabric objects and do NOT live in annotationsByPage —
// they are flat bounding-box + metadata records held in a document-level dict
// { [annotationId]: marker }. They could be numerous (hundreds+), so they get
// their OWN keyed Y.Map (minimal per-marker diff) rather than a coarse whole-
// dict meta blob — a single placement becomes one small bounded op, never a
// giant re-serialization of every marker.

export const SURVEY_MARKERS_MAP = 'surveyMarkers';

export function getSurveyMarkersMap(doc) {
  return doc.getMap(SURVEY_MARKERS_MAP);
}

/** Materialize the survey-marker dict { [annotationId]: marker } from the Y.Doc. */
export function docToSurveyMarkers(doc) {
  const map = getSurveyMarkersMap(doc);
  const out = {};
  map.forEach((value, key) => { if (value && typeof value === 'object') out[key] = value; });
  return out;
}

/**
 * Reconcile the survey-marker Y.Map to a desired dict. Minimal diff: only
 * changed/new markers are set, only removed ids are deleted, and re-applying
 * identical state produces ZERO Yjs updates. Adds/updates are applied in bounded
 * batches (one transaction per batch) so a bulk seed of N markers becomes
 * several resilient ops, never one giant all-or-nothing write.
 */
export function syncSurveyMarkersToDoc(doc, markers, { origin = 'local', batchSize = 250 } = {}) {
  const map = getSurveyMarkersMap(doc);
  const desired = markers || {};
  const ids = Object.keys(desired);
  const desiredSet = new Set(ids);

  let added = 0;
  let updated = 0;
  let removed = 0;

  const toDelete = [];
  map.forEach((_value, key) => { if (!desiredSet.has(key)) toDelete.push(key); });
  if (toDelete.length) {
    doc.transact(() => { for (const k of toDelete) { map.delete(k); removed += 1; } }, origin);
  }

  const changed = [];
  for (const id of ids) {
    const next = desired[id];
    const cur = map.get(id);
    if (cur === undefined) changed.push([id, next, true]);
    else if (stableStringify(cur) !== stableStringify(next)) changed.push([id, next, false]);
  }
  for (let i = 0; i < changed.length; i += batchSize) {
    const batch = changed.slice(i, i + batchSize);
    doc.transact(() => {
      for (const [id, next, isAdd] of batch) { map.set(id, next); if (isAdd) added += 1; else updated += 1; }
    }, origin);
  }

  return { added, updated, removed };
}

/**
 * Materialize the render shape from the Y.Doc. Groups every stored annotation
 * by its page into { [page]: { objects: [...] } }. Object order is the Y.Map's
 * insertion order (stable across reloads of the same update history).
 */
export function docToByPage(doc) {
  const map = getAnnotationsMap(doc);
  const byPage = {};
  map.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const page = entry.p;
    const obj = entry.o;
    if (page == null || !obj) return;
    if (!byPage[page]) byPage[page] = { objects: [] };
    byPage[page].objects.push(obj);
  });
  return byPage;
}

/**
 * Reconcile the Y.Doc to match a render-shape `annotationsByPage`. Computes the
 * minimal set of set/delete operations (so re-saving identical state produces
 * ZERO Yjs updates — never spams the durable log) and applies them in one
 * transaction. Returns { added, updated, removed, skipped } for diagnostics.
 *
 * Performance: when `prevByPage` is supplied, a page whose bucket is the SAME
 * object reference as last time is treated as unchanged — its ids are protected
 * from deletion but its objects are not re-compared (no per-mark stringify). The
 * viewer replaces only the edited page's array, so on a 24k-mark document a
 * single draw re-checks one page, not all of them.
 *
 * `origin` tags the transaction so the local update observer can tell its own
 * writes apart from remote ones.
 */
export function syncByPageToDoc(doc, byPage, { getId = extractAnnotationId, origin = 'local', prevByPage = null } = {}) {
  const map = getAnnotationsMap(doc);

  const desired = new Map();          // id -> {p,o} for CHANGED pages (full compare)
  const desiredByPage = new Map();    // page -> [[id,{p,o}], ...] for per-page transactions
  const keepIds = new Set();          // ids on UNCHANGED pages (protect from delete only)
  let skipped = 0;

  for (const pageKey of Object.keys(byPage || {})) {
    const page = Number(pageKey);
    const bucket = byPage[pageKey];
    const objects = (bucket && Array.isArray(bucket.objects)) ? bucket.objects : [];
    const unchanged = prevByPage && prevByPage[pageKey] === bucket;
    for (const obj of objects) {
      const id = getId(obj);
      if (!id) { skipped += 1; continue; }
      if (unchanged) { keepIds.add(id); continue; }
      const entry = { p: page, o: obj };
      desired.set(id, entry);
      if (!desiredByPage.has(page)) desiredByPage.set(page, []);
      desiredByPage.get(page).push([id, entry]);
    }
  }

  let added = 0;
  let updated = 0;
  let removed = 0;

  // Deletes in their own transaction (one op): keys neither desired nor kept.
  const toDelete = [];
  map.forEach((_value, key) => { if (!desired.has(key) && !keepIds.has(key)) toDelete.push(key); });
  if (toDelete.length) {
    doc.transact(() => { for (const key of toDelete) { map.delete(key); removed += 1; } }, origin);
  }

  // Adds/updates ONE PAGE PER TRANSACTION → one bounded op per page, so a 3000-
  // mark import becomes several resilient writes instead of one giant fragile
  // one. A page with no real changes emits no Yjs update at all.
  for (const [, entries] of desiredByPage) {
    doc.transact(() => {
      for (const [id, next] of entries) {
        const prev = map.get(id);
        if (prev === undefined) { map.set(id, next); added += 1; }
        else if (!shallowEntryEqual(prev, next)) { map.set(id, next); updated += 1; }
      }
    }, origin);
  }

  return { added, updated, removed, skipped };
}

// Compare two { p, o } entries cheaply. Page must match and the object payload
// must be JSON-identical. (Fabric objects are plain JSON here, so stringify is a
// correct and fast equality for "did this annotation actually change".)
function shallowEntryEqual(a, b) {
  if (!a || !b) return false;
  if (a.p !== b.p) return false;
  return stableStringify(a.o) === stableStringify(b.o);
}

// Order-insensitive JSON stringify so key ordering differences don't read as a
// change (Fabric serialization can reorder keys between runs).
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Full-state snapshot for the fast-open baseline. */
export function encodeSnapshot(doc) {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Build a Y.Doc from a stored snapshot plus the tail of op-log updates recorded
 * after it. This is the entire open/hydrate path: one applyUpdate for the
 * snapshot, then the ordered tail. Order-independent merges mean re-applying an
 * already-included update is a harmless no-op (CRDT).
 *
 * @param {Uint8Array|null} snapshotBytes
 * @param {Uint8Array[]} tailUpdates  ordered ascending by seq
 * @param {Y.Doc} doc  the target doc (from the registry, or a fresh one in tests)
 */
export function hydrateDoc(snapshotBytes, tailUpdates, doc) {
  if (!doc) throw new Error('hydrateDoc: a target Y.Doc is required');
  if (snapshotBytes && snapshotBytes.length) {
    Y.applyUpdate(doc, snapshotBytes, 'hydrate');
  }
  for (const upd of tailUpdates) {
    if (upd && upd.length) Y.applyUpdate(doc, upd, 'hydrate');
  }
  return doc;
}
