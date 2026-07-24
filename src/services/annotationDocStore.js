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
import {
  intersectErasedPathSurvivors,
  rebaseErasedPathSurvivor,
} from '../utils/pageSpaceEraser.js';
import {
  createAnnotationStorageKeyResolver,
  getAnnotationStorageKey,
  normalizeAnnotationIdentity,
  normalizeByPageAnnotationIdentities,
  setAnnotationStorageKey,
} from '../utils/annotationStorageIdentity.js';

export const ANNOTATIONS_MAP = 'annotations';
export const ERASER_OPS_MAP = 'annotationEraserOps';
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

export function getEraserOpsMap(doc) {
  return doc.getMap(ERASER_OPS_MAP);
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
 *
 * Stage 0 safety contract:
 *   * `origin: 'excel-import'` makes the reconcile ADDITIVE/patch-only — it may
 *     add or update markers but NEVER deletes a key the imported dict omits. A
 *     flat Excel sheet can't tell "deleted" from "filtered/sorted", and an
 *     un-exported app marker is simply absent from the sheet; deleting it here is
 *     the durable-store corruption bug. Excel-side removals flow through the
 *     explicit (app-origin) tombstone path instead, not this reconcile.
 *   * `protectedIds` (iterable) are never deleted regardless of origin — used to
 *     shield app-created-not-yet-exported markers even on a local reconcile.
 */
export function syncSurveyMarkersToDoc(doc, markers, { origin = 'local', batchSize = 250, protectedIds = null } = {}) {
  const map = getSurveyMarkersMap(doc);
  const desired = markers || {};
  const ids = Object.keys(desired);
  const desiredSet = new Set(ids);
  const protectedSet = protectedIds ? new Set(protectedIds) : null;
  // Excel imports are additive: never delete keys the sheet omits.
  const allowDeletes = origin !== 'excel-import';
  // Clamp batch size so a 0/negative/NaN value can never stall the update loop.
  const step = Math.max(1, Math.floor(batchSize) || 1);

  let added = 0;
  let updated = 0;
  let removed = 0;

  const toDelete = [];
  if (allowDeletes) {
    map.forEach((_value, key) => {
      if (desiredSet.has(key)) return;
      if (protectedSet && protectedSet.has(key)) return;
      toDelete.push(key);
    });
  }
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
  for (let i = 0; i < changed.length; i += step) {
    const batch = changed.slice(i, i + step);
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
export function docToByPage(doc, { replayStats = null } = {}) {
  const map = getAnnotationsMap(doc);
  const byPage = {};
  const baseLocations = new Map();
  map.forEach((entry, storageKey) => {
    if (!entry || typeof entry !== 'object') return;
    const page = entry.p;
    const storedObject = entry.o;
    if (page == null || !storedObject) return;
    if (!byPage[page]) byPage[page] = { objects: [] };
    // The Y.Map key is authoritative provenance for legacy sentinel/duplicate
    // entries. Promote it into serialized data.id on materialization so the
    // identity survives JSON cloning and z-order changes; WeakMap is cache only.
    setAnnotationStorageKey(storedObject, storageKey);
    const obj = normalizeAnnotationIdentity(storedObject).object;
    setAnnotationStorageKey(obj, storageKey);
    baseLocations.set(String(storageKey), {
      page: Number(page),
      index: byPage[page].objects.length,
    });
    byPage[page].objects.push(obj);
  });

  // Each writer owns one replaceable survivor lane per annotation. Sequential
  // gestures update that lane instead of appending replayable operations;
  // concurrent lanes compose by intersection and any delete lane wins.
  const lanesByAnnotation = new Map();
  let laneEntries = 0;
  getEraserOpsMap(doc).forEach((lane, laneKey) => {
    if (!lane || typeof lane !== 'object' || lane.storageKey == null) return;
    laneEntries += 1;
    const storageKey = String(lane.storageKey);
    if (!lanesByAnnotation.has(storageKey)) lanesByAnnotation.set(storageKey, []);
    lanesByAnnotation.get(storageKey).push([String(laneKey), lane]);
    const pageNumber = Number(lane.pageNumber);
    if (!Number.isFinite(pageNumber)) return;
    if (!byPage[pageNumber]) byPage[pageNumber] = { objects: [] };
    const materializedIds = new Set(
      byPage[pageNumber].eraserMaterializedMutationIds || [],
    );
    if (lane.operationId) materializedIds.add(String(lane.operationId));
    byPage[pageNumber].eraserMaterializedMutationIds = [...materializedIds].sort();
  });
  let annotationsWithLanes = 0;
  let polygonIntersections = 0;
  for (const [storageKey, lanes] of lanesByAnnotation) {
    annotationsWithLanes += 1;
    lanes.sort(([a], [b]) => a.localeCompare(b));
    const location = baseLocations.get(storageKey);
    const page = location?.page ?? Number(lanes[0][1].pageNumber);
    const pageAnnotations = byPage[page];
    if (!pageAnnotations || !location) continue;
    const objectIndex = pageAnnotations.objects.findIndex(
      (object) => getAnnotationStorageKey(object) === storageKey,
    );
    if (objectIndex < 0) continue;
    if (lanes.some(([, lane]) => lane.deleted === true)) {
      byPage[page] = {
        ...pageAnnotations,
        objects: pageAnnotations.objects.filter((_object, index) => index !== objectIndex),
      };
      continue;
    }
    const baseObject = pageAnnotations.objects[objectIndex];
    const survivors = lanes.map(([, lane]) => (
      rebaseErasedPathSurvivor(baseObject, lane.base, lane.survivor)
    )).filter(Boolean);
    if (!survivors.length) continue;
    polygonIntersections += Math.max(0, survivors.length - 1);
    const survivor = intersectErasedPathSurvivors(survivors);
    if (survivor) setAnnotationStorageKey(survivor, storageKey);
    byPage[page] = {
      ...pageAnnotations,
      objects: survivor
        ? pageAnnotations.objects.map((object, index) => (index === objectIndex ? survivor : object))
        : pageAnnotations.objects.filter((_object, index) => index !== objectIndex),
    };
  }
  if (replayStats && typeof replayStats === 'object') {
    replayStats.laneEntries = laneEntries;
    replayStats.annotationsWithLanes = annotationsWithLanes;
    replayStats.polygonIntersections = polygonIntersections;
  }
  return byPage;
}

function collectEraserMutations(byPage, writerId) {
  const mutations = [];
  for (const [pageKey, page] of Object.entries(byPage || {})) {
    const mutation = page?.eraserMutation;
    const id = mutation?.id;
    if (id == null) continue;
    const objectMutations = (mutation.objectMutations || [])
      .filter((entry) => entry && entry.storageKey != null)
      .map((entry) => ({
        storageKey: String(entry.storageKey),
        annotationId: entry.annotationId == null ? null : String(entry.annotationId),
        base: entry.base || null,
        deleted: entry.deleted === true,
        survivor: entry.deleted === true ? null : entry.survivor,
      }));
    const deletedIds = new Set((mutation.deletedIds || []).filter(Boolean).map(String));
    const annotationIds = [...new Set((mutation.touchedIds || []).filter(Boolean).map(String))];
    if (!annotationIds.length && !objectMutations.length) continue;
    const objectsById = new Map((page?.objects || []).map((object) => [
      String(extractAnnotationId(object)),
      object,
    ]));
    mutations.push({
      id: String(id),
      writerId: String(writerId || mutation.writerId || 'local'),
      pageNumber: Number(mutation.pageNumber ?? pageKey),
      annotationIds,
      deletedIds,
      objectsById,
      objectMutations,
    });
  }
  return mutations;
}

export function clearEraserOpsForAnnotationIds(doc, annotationIds, origin = 'local') {
  let writerId = null;
  if (origin && typeof origin === 'object') {
    writerId = origin.writerId == null ? null : String(origin.writerId);
    origin = origin.origin || 'local';
  }
  const ids = new Set((annotationIds || []).filter(Boolean).map(String));
  if (ids.size === 0) return 0;
  const map = getEraserOpsMap(doc);
  const toDelete = [];
  map.forEach((lane, laneKey) => {
    if (writerId != null && String(lane?.writerId) !== writerId) return;
    if (
      ids.has(String(lane?.annotationId))
      || ids.has(String(lane?.storageKey))
      || (lane?.touchedIds || []).some((id) => ids.has(String(id)))
    ) {
      toDelete.push(laneKey);
    }
  });
  if (toDelete.length > 0) {
    doc.transact(() => {
      for (const operationId of toDelete) map.delete(operationId);
    }, origin);
  }
  return toDelete.length;
}

function exactInkDuplicateSignature(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const page = entry.p;
  const object = entry.o;
  if (page == null || !object || typeof object !== 'object') return null;
  if (String(object.type || '').toLowerCase() !== 'path') return null;
  if (!Array.isArray(object.path) || object.path.length === 0) return null;

  // Scope the destructive repair to geometry already produced by partial
  // erase. Fresh pen/highlighter copies may be intentionally stacked (notably
  // multiply-blended highlighter); they must remain distinct even if their
  // sampled paths happen to be byte-identical.
  if (object.paperEraserGeometry !== 'v1') return null;

  // Annotation identity is expected to differ across the corrupt copies.
  // Strip ONLY identity: all geometry, styling, transforms, permissions, and
  // provenance stay in the signature, making this an exact-match repair.
  const comparable = { ...object };
  delete comparable.id;
  delete comparable.annotationId;
  if (object.data && typeof object.data === 'object' && !Array.isArray(object.data)) {
    comparable.data = { ...object.data };
    delete comparable.data.id;
  }
  return `${stableStringify(page)}|${stableStringify(comparable)}`;
}

/**
 * Collapse byte-equivalent filled-ink records stacked at the same page-space
 * geometry. Old import/sync races could save one stroke repeatedly under fresh
 * ids; after a partial erase those copies become identical thin fragments, so
 * removing one merely reveals the next and looks like the streak regenerated.
 *
 * This deliberately does NOT use fuzzy bounds/IoU matching. Only identity may
 * differ, and only already-partially-erased ink is eligible. Fresh ink,
 * shapes, text, different pages, styles, transforms, and even a one-coordinate
 * path change remain distinct.
 */
export function repairStackedInkDuplicates(
  doc,
  { origin = 'annoflat-dedupe' } = {},
) {
  if (!doc) {
    return {
      scanned: 0,
      duplicateGroups: 0,
      removed: 0,
      removedIds: [],
    };
  }

  const map = getAnnotationsMap(doc);
  const groups = new Map();
  let scanned = 0;
  map.forEach((entry, id) => {
    const signature = exactInkDuplicateSignature(entry);
    if (!signature) return;
    scanned += 1;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push({
      id,
      hasCanonicalKey: String(id) === String(extractAnnotationId(entry?.o)),
    });
  });

  const removedIds = [];
  let duplicateGroups = 0;
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    duplicateGroups += 1;
    // A mismatched map key would be recreated by the next capture under the
    // object's embedded id. Prefer a copy whose key already matches that id.
    const survivor = entries.find((entry) => entry.hasCanonicalKey) || entries[0];
    for (const entry of entries) {
      if (entry !== survivor) removedIds.push(entry.id);
    }
  }

  if (removedIds.length > 0) {
    doc.transact(() => {
      for (const id of removedIds) map.delete(id);
    }, origin);
  }

  return {
    scanned,
    duplicateGroups,
    removed: removedIds.length,
    removedIds,
  };
}

/**
 * Yjs stores annotation objects, not page-local presentation epochs. Preserve
 * the latest local eraser epoch while applying a remote materialization so an
 * in-flight SVG/canvas handoff cannot lose the token it is waiting to paint.
 */
export function preserveTransientPagePresentationState(previousByPage, nextByPage) {
  let merged = nextByPage;
  for (const [pageKey, previousPage] of Object.entries(previousByPage || {})) {
    const previousRevision = previousPage?.eraserPresentationRevision;
    const nextPage = nextByPage?.[pageKey];
    if (
      !previousRevision
      || nextPage?.eraserPresentationRevision
    ) {
      continue;
    }
    if (merged === nextByPage) merged = { ...(nextByPage || {}) };
    merged[pageKey] = {
      ...(nextPage || { objects: [] }),
      eraserPresentationRevision: previousRevision,
    };
  }
  return merged;
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
export function syncByPageToDoc(doc, byPage, {
  getId = extractAnnotationId,
  origin = 'local',
  prevByPage = null,
  eraserWriterId = null,
} = {}) {
  const identityNormalization = normalizeByPageAnnotationIdentities(byPage);
  byPage = identityNormalization.byPage;
  const map = getAnnotationsMap(doc);
  const eraserOpsMap = getEraserOpsMap(doc);
  const eraserMutations = collectEraserMutations(byPage, eraserWriterId);
  const eraserProtectedIds = new Set();
  const eraserProtectedStorageKeys = new Set();

  if (eraserMutations.length > 0) {
    doc.transact(() => {
      for (const mutation of eraserMutations) {
        if (mutation.objectMutations.length > 0) {
          for (const item of mutation.objectMutations) {
            const laneKey = `${mutation.writerId}\u0000${item.storageKey}`;
            const baseEntry = map.get(item.storageKey);
            const previous = eraserOpsMap.get(laneKey);
            const base = baseEntry?.o || item.base || previous?.base || null;
            const survivor = item.deleted
              ? null
              : rebaseErasedPathSurvivor(base, item.base, item.survivor, {
                  geometryBase: previous?.base || item.base,
                });
            const lane = {
              writerId: mutation.writerId,
              storageKey: item.storageKey,
              annotationId: item.annotationId ?? extractAnnotationId(baseEntry?.o),
              pageNumber: mutation.pageNumber,
              operationId: mutation.id,
              base,
              deleted: previous?.deleted === true || item.deleted,
              survivor,
            };
            if (stableStringify(previous) !== stableStringify(lane)) {
              eraserOpsMap.set(laneKey, lane);
            }
          }
          continue;
        }
        for (const annotationId of mutation.annotationIds) {
          const laneKey = `${mutation.writerId}\u0000${annotationId}`;
          const lane = {
            writerId: mutation.writerId,
            storageKey: annotationId,
            annotationId,
            pageNumber: mutation.pageNumber,
            operationId: mutation.id,
            deleted: mutation.deletedIds.has(annotationId),
            survivor: mutation.deletedIds.has(annotationId)
              ? null
              : mutation.objectsById.get(annotationId) || null,
          };
          const previous = eraserOpsMap.get(laneKey);
          if (stableStringify(previous) !== stableStringify(lane)) {
            eraserOpsMap.set(laneKey, lane);
          }
        }
      }
    }, origin);
  }
  // Every page commit contains materialized lane output, even when this save
  // did not create a new eraser mutation (for example z-order/reload/history).
  // Always protect lane-owned base objects so a survivor can never replace its
  // original base and be erased a second time.
  eraserOpsMap.forEach((lane) => {
    if (lane?.annotationId) eraserProtectedIds.add(String(lane.annotationId));
    if (lane?.storageKey != null) eraserProtectedStorageKeys.add(String(lane.storageKey));
  });

  const desired = new Map();          // id -> {p,o} for CHANGED pages (full compare)
  const desiredByPage = new Map();    // page -> [[id,{p,o}], ...] for per-page transactions
  const keepIds = new Set();          // ids on UNCHANGED pages (protect from delete only)
  let skipped = 0;
  const resolveStorageKey = createAnnotationStorageKeyResolver();

  for (const pageKey of Object.keys(byPage || {})) {
    const page = Number(pageKey);
    const bucket = byPage[pageKey];
    const objects = (bucket && Array.isArray(bucket.objects)) ? bucket.objects : [];
    const unchanged = prevByPage && prevByPage[pageKey] === bucket;
    for (const obj of objects) {
      // Callout-unification Slice 6 (2026-07-17): the historical write-
      // contamination guard (`data.type==='callout'` skipped here) is GONE.
      // annotationsByPage is the single in-memory truth post-flip (R2.2 Slice 2),
      // and projected callout groups now persist per-id in this same `annotations`
      // Y.Map like every other object — carrying their verbatim
      // `data.legacyCallout` payload, so the byPage⇄doc round-trip is lossless.
      // The coarse `calloutsList` META blob is retired (one-time migration +
      // tombstone in calloutMetaMigration.js).
      if (!obj || typeof obj !== 'object') { skipped += 1; continue; }
      const embeddedId = getId(obj);
      const id = resolveStorageKey(obj, page, embeddedId);
      if (eraserProtectedIds.has(String(id)) || eraserProtectedStorageKeys.has(String(id))) {
        keepIds.add(String(id));
        continue;
      }
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
  map.forEach((_value, key) => {
    if (
      !desired.has(key)
      && !keepIds.has(key)
      && !eraserProtectedIds.has(String(key))
      && !eraserProtectedStorageKeys.has(String(key))
    ) {
      toDelete.push(key);
    }
  });
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

  return {
    added,
    updated,
    removed,
    skipped,
    ...(identityNormalization.changed
      ? { normalizedByPage: byPage, identityChanged: true }
      : {}),
  };
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
