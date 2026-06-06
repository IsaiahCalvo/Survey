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

// Internal: flatten a byPage render shape to a desired id -> { p, o } map,
// skipping objects without a usable stable id.
function byPageToDesired(byPage, getId) {
  const desired = new Map();
  let skipped = 0;
  for (const pageKey of Object.keys(byPage || {})) {
    const page = Number(pageKey);
    const bucket = byPage[pageKey];
    const objects = (bucket && Array.isArray(bucket.objects)) ? bucket.objects : [];
    for (const obj of objects) {
      const id = getId(obj);
      if (!id) { skipped += 1; continue; }
      desired.set(id, { p: page, o: obj });
    }
  }
  return { desired, skipped };
}

/**
 * Reconcile the Y.Doc to match a render-shape `annotationsByPage`. Computes the
 * minimal set of set/delete operations (so re-saving identical state produces
 * ZERO Yjs updates — never spams the durable log) and applies them in one
 * transaction. Returns { added, updated, removed, skipped } for diagnostics.
 *
 * `origin` tags the transaction so the local update observer can tell its own
 * writes apart from remote ones.
 */
export function syncByPageToDoc(doc, byPage, { getId = extractAnnotationId, origin = 'local' } = {}) {
  const map = getAnnotationsMap(doc);
  const { desired, skipped } = byPageToDesired(byPage, getId);

  let added = 0;
  let updated = 0;
  let removed = 0;

  doc.transact(() => {
    // Deletes: present in the doc but not desired.
    const toDelete = [];
    map.forEach((_value, key) => { if (!desired.has(key)) toDelete.push(key); });
    for (const key of toDelete) { map.delete(key); removed += 1; }

    // Adds / updates: desired entries that are new or changed.
    for (const [id, next] of desired) {
      const prev = map.get(id);
      if (prev === undefined) {
        map.set(id, next);
        added += 1;
      } else if (!shallowEntryEqual(prev, next)) {
        map.set(id, next);
        updated += 1;
      }
    }
  }, origin);

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
