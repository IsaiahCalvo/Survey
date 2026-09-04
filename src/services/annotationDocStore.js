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
  erasePageAnnotations,
  intersectErasedPathSurvivors,
  rebaseErasedPathSurvivor,
} from '../utils/pageSpaceEraser.js';
import {
  applyInkGeometryMatrix,
  createInkPathAffine,
} from '../utils/inkGeometryTransform.js';
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
export const DELETED_PDF_ANNOTATIONS_MAP = 'deletedPdfAnnotations';

/**
 * Stable id for an annotation object. Annotations carry their durable id at
 * `data.id` (the same key the SVG layer + DB conflict key use); fall back to
 * top-level id / annotationId / native pdfAnnotationId for older shapes.
 * Returns null when there is no
 * usable id (caller skips such objects rather than inventing an unstable key).
 */
export function extractAnnotationId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const id =
    (obj.data && typeof obj.data === 'object' ? obj.data.id : undefined) ??
    obj.id ??
    obj.annotationId ??
    obj.pdfAnnotationId;
  return (typeof id === 'string' && id) || (typeof id === 'number' ? String(id) : null);
}

export function getAnnotationsMap(doc) {
  return doc.getMap(ANNOTATIONS_MAP);
}

export function getEraserOpsMap(doc) {
  return doc.getMap(ERASER_OPS_MAP);
}

export function getDeletedPdfAnnotationsMap(doc) {
  return doc.getMap(DELETED_PDF_ANNOTATIONS_MAP);
}

export function deletedPdfAnnotationStorageKey(pageNumber, pdfAnnotationId) {
  return `${Number(pageNumber || 1)}\u0000${String(pdfAnnotationId)}`;
}

export function docToDeletedPdfAnnotations(doc) {
  const active = new Map();
  getDeletedPdfAnnotationsMap(doc).forEach((entry) => {
    if (!entry?.pdfAnnotationId) return;
    active.set(
      deletedPdfAnnotationStorageKey(entry.pageNumber, entry.pdfAnnotationId),
      structuredClone(entry),
    );
  });
  getEraserOpsMap(doc).forEach((lane) => {
    const entry = lane?.deleted === true ? lane.deletedPdfAnnotation : null;
    if (!entry?.pdfAnnotationId) return;
    active.set(
      deletedPdfAnnotationStorageKey(entry.pageNumber, entry.pdfAnnotationId),
      structuredClone(entry),
    );
  });
  return [...active.values()]
    .sort((left, right) => (
      Number(left.pageNumber || 0) - Number(right.pageNumber || 0)
      || String(left.pdfAnnotationId).localeCompare(String(right.pdfAnnotationId))
    ));
}

function deletedPdfAnnotationEntry(object, pageNumber) {
  if (!object?.pdfAnnotationId) return null;
  const pdfNativeAnnotationIdentity = object?.data?.pdfNativeAnnotationIdentity;
  return {
    pdfAnnotationId: String(object.pdfAnnotationId),
    pageNumber: Number(pageNumber || object.pageNumber || 1),
    pdfAnnotationType: object.pdfAnnotationType || null,
    ...(pdfNativeAnnotationIdentity
      ? { pdfNativeAnnotationIdentity: structuredClone(pdfNativeAnnotationIdentity) }
      : {}),
  };
}

function eraserTransformSignature(object) {
  const finite = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  return JSON.stringify({
    left: finite(object?.left),
    top: finite(object?.top),
    scaleX: finite(object?.scaleX, 1),
    scaleY: finite(object?.scaleY, 1),
    angle: finite(object?.angle),
    pathOffset: object?.pathOffset
      ? {
          x: finite(object.pathOffset.x),
          y: finite(object.pathOffset.y),
        }
      : null,
    skewX: finite(object?.skewX),
    skewY: finite(object?.skewY),
    flipX: object?.flipX === true,
    flipY: object?.flipY === true,
  });
}

const ERASER_REMOVABLE_PRESENTATION_KEYS = [
  'strokeDashArray',
  'strokeDashOffset',
];

function preserveEraserPresentationRemovals(rebased, sourceBase, sourceSurvivor) {
  if (!rebased || !sourceSurvivor) return rebased;
  const next = { ...rebased };
  for (const key of ERASER_REMOVABLE_PRESENTATION_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(sourceBase || {}, key)
      && !Object.prototype.hasOwnProperty.call(sourceSurvivor, key)
    ) {
      delete next[key];
    }
  }
  return next;
}

const analyticEraserBaseGeometrySignature = (object) => JSON.stringify({
  type: String(object?.type || '').toLowerCase(),
  path: object?.path || null,
  cmds: object?.cmds || null,
  sourceWidth: object?.sourceWidth ?? null,
  strokeWidth: object?.strokeWidth ?? null,
  strokeLineCap: object?.strokeLineCap ?? null,
  strokeLineJoin: object?.strokeLineJoin ?? null,
  strokeMiterLimit: object?.strokeMiterLimit ?? null,
  strokeDashArray: object?.strokeDashArray ?? null,
  strokeDashOffset: object?.strokeDashOffset ?? null,
  fillRule: object?.fillRule ?? null,
  pdfStrokeHairline: object?.pdfStrokeHairline === true
    || object?.data?.pdfStrokeHairline === true,
});

const stableSum = (...values) => {
  const direct = values.reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(direct)) return direct;
  const scale = Math.max(0, ...values.map((value) => Math.abs(value)));
  return scale === 0
    ? 0
    : scale * values.reduce((sum, value) => sum + value / scale, 0);
};

const multiplyAffineMatrices = (left, right) => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    stableSum(a1 * a2, c1 * b2),
    stableSum(b1 * a2, d1 * b2),
    stableSum(a1 * c2, c1 * d2),
    stableSum(b1 * c2, d1 * d2),
    stableSum(a1 * e2, c1 * f2, e1),
    stableSum(b1 * e2, d1 * f2, f1),
  ];
};

const invertAffineMatrix = (matrix) => {
  const [a, b, c, d, e, f] = matrix;
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  const na = a / scale;
  const nb = b / scale;
  const nc = c / scale;
  const nd = d / scale;
  const normalizedDeterminant = na * nd - nb * nc;
  if (normalizedDeterminant === 0 || !Number.isFinite(normalizedDeterminant)) return null;
  const inverseScale = 1 / (scale * normalizedDeterminant);
  const ia = nd * inverseScale;
  const ib = -nb * inverseScale;
  const ic = -nc * inverseScale;
  const id = na * inverseScale;
  const inverse = [
    ia,
    ib,
    ic,
    id,
    -stableSum(ia * e, ic * f),
    -stableSum(ib * e, id * f),
  ];
  return inverse.every(Number.isFinite) ? inverse : null;
};

function rebaseAnalyticEraserSurvivor(currentBase, capturedBase, survivor) {
  if (
    !currentBase
    || !capturedBase
    || !survivor
    || !Array.isArray(survivor.path)
    || survivor.polygons?.length
    || analyticEraserBaseGeometrySignature(currentBase)
      !== analyticEraserBaseGeometrySignature(capturedBase)
  ) {
    return null;
  }
  const capturedCommands = capturedBase.path || capturedBase.cmds;
  const currentCommands = currentBase.path || currentBase.cmds;
  if (!Array.isArray(capturedCommands) || !Array.isArray(currentCommands)) return null;
  const capturedMatrix = createInkPathAffine(capturedBase, capturedCommands).matrix;
  const currentMatrix = createInkPathAffine(currentBase, currentCommands).matrix;
  if (JSON.stringify(capturedMatrix) === JSON.stringify(currentMatrix)) {
    return structuredClone(survivor);
  }
  const capturedInverse = invertAffineMatrix(capturedMatrix);
  if (!capturedInverse) return null;
  const pageMatrix = multiplyAffineMatrices(currentMatrix, capturedInverse);
  if (!pageMatrix.every(Number.isFinite)) return null;
  return applyInkGeometryMatrix(survivor, pageMatrix);
}

function rebaseStoredEraserSurvivor(currentBase, capturedBase, survivor, options) {
  const rebased = rebaseErasedPathSurvivor(
    currentBase,
    capturedBase,
    survivor,
    options,
  ) || rebaseAnalyticEraserSurvivor(currentBase, capturedBase, survivor);
  return preserveEraserPresentationRemovals(rebased, capturedBase, survivor);
}

const normalizedLaneGesture = (gesture) => {
  const points = Array.isArray(gesture?.points)
    ? gesture.points
      .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
  const radius = Number(gesture?.radius);
  if (!points.length || !Number.isFinite(radius) || radius <= 0) return null;
  return {
    mode: gesture?.mode === 'entire' || gesture?.mode === 'full' ? 'full' : 'partial',
    points,
    radius,
  };
};

function transformLaneGesture(gesture, capturedBase, currentBase) {
  const normalized = normalizedLaneGesture(gesture);
  if (!normalized || normalized.mode !== 'partial') return null;
  const capturedCommands = capturedBase?.path || capturedBase?.cmds;
  const currentCommands = currentBase?.path || currentBase?.cmds;
  if (!Array.isArray(capturedCommands) || !Array.isArray(currentCommands)) return null;
  const capturedMatrix = createInkPathAffine(capturedBase, capturedCommands).matrix;
  const currentMatrix = createInkPathAffine(currentBase, currentCommands).matrix;
  const capturedInverse = invertAffineMatrix(capturedMatrix);
  if (!capturedInverse) return null;
  const pageMatrix = multiplyAffineMatrices(currentMatrix, capturedInverse);
  const [a, b, c, d, e, f] = pageMatrix;
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  const orthogonality = Math.abs(a * c + b * d);
  const tolerance = Number.EPSILON * 128 * Math.max(1, scaleX * scaleY);
  if (
    !(scaleX > 0)
    || !(scaleY > 0)
    || Math.abs(scaleX - scaleY) > tolerance
    || orthogonality > tolerance
  ) {
    return null;
  }
  return {
    ...normalized,
    radius: normalized.radius * ((scaleX + scaleY) / 2),
    points: normalized.points.map((point) => ({
      x: stableSum(a * point.x, c * point.y, e),
      y: stableSum(b * point.x, d * point.y, f),
    })),
  };
}

function intersectAnalyticEraserLanes(currentBase, lanes) {
  let current = currentBase;
  for (const [, lane] of lanes) {
    const gestures = Array.isArray(lane?.gestures) ? lane.gestures : [];
    if (!gestures.length) return { supported: false, survivor: null };
    for (const gesture of gestures) {
      const transformed = transformLaneGesture(gesture, lane.base, currentBase);
      if (!transformed) return { supported: false, survivor: null };
      const erased = erasePageAnnotations({
        pageAnnotations: { objects: [current] },
        eraserPoints: transformed.points,
        eraserRadius: transformed.radius,
        mode: 'partial',
      });
      const mutation = erased.objectMutations?.find((item) => item?.index === 0);
      if (!mutation) continue;
      if (mutation.deleted === true) return { supported: true, survivor: null };
      current = mutation.survivor;
    }
  }
  return { supported: true, survivor: current };
}

/**
 * Build one writer's lane from that writer's own survivor (or the immutable
 * base), never from the all-writer materialized intersection. This matters
 * when B erases after seeing A: B's lane must encode only B's bite so Undoing
 * A can restore A's pixels while preserving B.
 */
export function deriveWriterEraserLane({
  writerId,
  storageKey,
  annotationId = null,
  pageNumber,
  operationId,
  baseObject,
  capturedBase = null,
  preferCapturedSurvivor = false,
  previousLane = null,
  deleted = false,
  survivor = null,
  gesture = null,
} = {}) {
  let laneDeleted = previousLane?.deleted === true || deleted === true;
  let laneSurvivor = laneDeleted ? null : survivor;
  const requestedMode = gesture?.mode === 'entire' || gesture?.mode === 'full'
    ? 'full'
    : 'partial';
  const points = Array.isArray(gesture?.points) ? gesture.points : [];
  const radius = Number(gesture?.radius);
  const currentGesture = normalizedLaneGesture(gesture);
  const previousGestures = Array.isArray(previousLane?.gestures)
    ? previousLane.gestures.map((value) => structuredClone(value))
    : [];
  const previousSurvivor = previousLane?.deleted === true
    ? null
    : rebaseStoredEraserSurvivor(
        baseObject,
        previousLane?.base,
        previousLane?.survivor,
        { geometryBase: previousLane?.base },
    );
  const writerSource = previousLane?.deleted === true
    ? null
    : (previousSurvivor || baseObject || null);
  const capturedSurvivor = capturedBase && survivor
    ? rebaseStoredEraserSurvivor(
        baseObject,
        capturedBase,
        survivor,
        { geometryBase: previousLane?.base || capturedBase },
    )
    : null;
  const capturedWasMaterialized = capturedBase?.paperEraserGeometry === 'v1';
  const capturedTransform = capturedBase?.paperEraserBaseTransform || capturedBase;
  const useCapturedSurvivor = Boolean(capturedBase) && (
    (preferCapturedSurvivor && Boolean(capturedSurvivor))
    || !capturedWasMaterialized
    || (
      previousLane
      && (
        !previousSurvivor
        || eraserTransformSignature(capturedTransform)
          !== eraserTransformSignature(baseObject)
      )
    )
  );

  if (
    !laneDeleted
    && requestedMode === 'partial'
    && useCapturedSurvivor
  ) {
    laneSurvivor = capturedSurvivor;
  } else if (
    !laneDeleted
    && requestedMode === 'partial'
    && writerSource
    && String(writerSource.type || '').toLowerCase() === 'path'
    && points.length > 0
    && Number.isFinite(radius)
    && radius > 0
  ) {
    const rebased = erasePageAnnotations({
      pageAnnotations: { objects: [writerSource] },
      eraserPoints: points,
      eraserRadius: radius,
      mode: 'partial',
    });
    const mutation = rebased.objectMutations?.find((item) => item?.index === 0);
    if (!mutation) {
      throw new Error(`partial eraser lane could not be replayed for ${String(storageKey)}`);
    }
    laneDeleted = mutation.deleted === true;
    laneSurvivor = laneDeleted ? null : mutation.survivor;
  }

  return {
    writerId: String(writerId),
    storageKey: String(storageKey),
    annotationId: annotationId == null ? null : String(annotationId),
    pageNumber: Number(pageNumber),
    operationId: String(operationId),
    base: baseObject || previousLane?.base || null,
    deleted: laneDeleted,
    survivor: laneDeleted ? null : laneSurvivor,
    gestures: currentGesture
      ? [...previousGestures, currentGesture]
      : previousGestures,
  };
}

const ERASER_GEOMETRY_KEYS = [
  'type',
  'path',
  'polygons',
  'cmds',
  'left',
  'top',
  'width',
  'height',
  'scaleX',
  'scaleY',
  'angle',
  'skewX',
  'skewY',
  'flipX',
  'flipY',
  'originX',
  'originY',
  'pathOffset',
  'inkGeometrySpace',
  'inkGeometryOrigin',
  'fillRule',
  'paperInkGeometry',
  'paperEraserGeometry',
  'paperEraserBaseTransform',
  'paperSourceStroke',
  'paperEraserCuts',
  'sourceWidth',
  'strokeDashArray',
  'strokeDashOffset',
];
const ERASER_STALE_GEOMETRY_KEYS = [
  'paperCenterline',
  'paperCenterlineRuns',
];
const IMPORTED_EDIT_KEYS = [
  'pdfImportedEditState',
  'pdfImportedEditedAt',
  'pdfImportedEditedBy',
  'pdfImportedEditSource',
];

function projectEraserGeometryOntoCurrentBase(baseObject, survivor) {
  if (!baseObject || !survivor) return survivor;
  const next = { ...baseObject };
  for (const key of [...ERASER_GEOMETRY_KEYS, ...ERASER_STALE_GEOMETRY_KEYS]) {
    delete next[key];
  }
  for (const key of ERASER_GEOMETRY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(survivor, key)) {
      next[key] = structuredClone(survivor[key]);
    }
  }
  for (const key of IMPORTED_EDIT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(survivor, key)) {
      next[key] = survivor[key];
    }
  }
  next.data = {
    ...(survivor.data || {}),
    ...(baseObject.data || {}),
    ...(survivor.data?.pdfImportedEditState
      ? { pdfImportedEditState: survivor.data.pdfImportedEditState }
      : {}),
    ...(survivor.data?.inkGeometrySpace
      ? { inkGeometrySpace: survivor.data.inkGeometrySpace }
      : {}),
  };
  if (
    survivor.inkGeometrySpace === 'page'
    || survivor.data?.inkGeometrySpace === 'page'
  ) {
    delete next.inkGeometryOrigin;
    delete next.data.inkGeometryOrigin;
  }
  if (survivor.paperEraserGeometry === 'v1') {
    const baseFill = String(baseObject.fill || '').toLowerCase();
    const paint = baseFill && baseFill !== 'none' && baseFill !== 'transparent'
      ? baseObject.fill
      : baseObject.stroke;
    if (paint) next.fill = paint;
    next.stroke = 'transparent';
    next.strokeWidth = 0;
  }
  return next;
}

function deriveCounterPresentationNumbers(byPage) {
  const groups = new Map();
  for (const [pageKey, page] of Object.entries(byPage || {})) {
    (page?.objects || []).forEach((object, index) => {
      if (object?.data?.type !== 'counter') return;
      const seriesKey = String(object.data.seriesId || '__legacy__');
      if (!groups.has(seriesKey)) groups.set(seriesKey, []);
      groups.get(seriesKey).push({
        pageKey,
        index,
        object,
        createdAt: Number(object.data.createdAt) || 0,
      });
    });
  }
  const copiedPages = new Set();
  for (const records of groups.values()) {
    records.sort((left, right) => (
      left.createdAt - right.createdAt
      || String(extractAnnotationId(left.object)).localeCompare(
        String(extractAnnotationId(right.object)),
      )
    ));
    const seriesStart = Number(records[0]?.object?.data?.seriesStart) || 1;
    records.forEach((record, index) => {
      const displayNumber = seriesStart + index;
      if (
        record.object.data.displayNumber === displayNumber
        && record.object.data.seriesStart === seriesStart
      ) return;
      if (!copiedPages.has(record.pageKey)) {
        byPage[record.pageKey] = {
          ...byPage[record.pageKey],
          objects: [...byPage[record.pageKey].objects],
        };
        copiedPages.add(record.pageKey);
      }
      const next = {
        ...record.object,
        data: {
          ...record.object.data,
          displayNumber,
          seriesStart,
        },
      };
      const storageKey = getAnnotationStorageKey(record.object);
      if (storageKey != null) setAnnotationStorageKey(next, storageKey);
      byPage[record.pageKey].objects[record.index] = next;
    });
  }
  return byPage;
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
    const location = baseLocations.get(storageKey);
    const pageNumber = location?.page ?? Number(lane.pageNumber);
    if (!Number.isFinite(pageNumber) || !byPage[pageNumber]) return;
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
      rebaseStoredEraserSurvivor(baseObject, lane.base, lane.survivor)
    )).filter(Boolean);
    if (!survivors.length) continue;
    const onlyAnalyticSurvivors = survivors.every(
      (value) => !Array.isArray(value?.polygons) || value.polygons.length === 0,
    );
    if (!onlyAnalyticSurvivors) {
      polygonIntersections += Math.max(0, survivors.length - 1);
    }
    // A single analytic hairline survivor has no polygon carrier by design.
    // Preserve it directly; the polygon intersection helper intentionally
    // accepts only filled-outline survivors.
    let intersected;
    if (survivors.length === 1) {
      [intersected] = survivors;
    } else if (onlyAnalyticSurvivors) {
      const combined = intersectAnalyticEraserLanes(baseObject, lanes);
      // Old lanes predate gesture retention. Fail closed by keeping one real
      // survivor instead of treating an unsupported analytic intersection as
      // a full deletion.
      intersected = combined.supported ? combined.survivor : survivors[0];
    } else if (survivors.some(
      (value) => !Array.isArray(value?.polygons) || value.polygons.length === 0,
    )) {
      intersected = survivors[0];
    } else {
      intersected = intersectErasedPathSurvivors(survivors);
    }
    const survivor = intersected
      ? projectEraserGeometryOntoCurrentBase(
        pageAnnotations.objects[objectIndex],
        intersected,
      )
      : null;
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
  return deriveCounterPresentationNumbers(byPage);
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
      gesture: {
        points: Array.isArray(mutation.points) ? mutation.points : [],
        radius: mutation.radius,
        mode: mutation.mode,
      },
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
  const deletedPdfAnnotations = getDeletedPdfAnnotationsMap(doc);
  const eraserMutations = collectEraserMutations(byPage, eraserWriterId);
  const eraserProtectedIds = new Set();
  const eraserProtectedStorageKeys = new Set();

  if (eraserMutations.length > 0) {
    // Yjs transactions group updates but do not roll back writes when their
    // callback throws. Derive every lane first so one invalid late target
    // cannot leave earlier lanes partially committed.
    const pendingLaneWrites = [];
    const pendingLanesByKey = new Map();
    for (const mutation of eraserMutations) {
      const items = mutation.objectMutations.length > 0
        ? mutation.objectMutations
        : mutation.annotationIds.map((annotationId) => ({
          storageKey: annotationId,
          annotationId,
          deleted: mutation.deletedIds.has(annotationId),
          survivor: mutation.deletedIds.has(annotationId)
            ? null
            : mutation.objectsById.get(annotationId) || null,
        }));
      for (const item of items) {
        const laneKey = `${mutation.writerId}\u0000${item.storageKey}`;
        const baseEntry = map.get(item.storageKey);
        const previous = pendingLanesByKey.has(laneKey)
          ? pendingLanesByKey.get(laneKey)
          : eraserOpsMap.get(laneKey);
        const lane = deriveWriterEraserLane({
          writerId: mutation.writerId,
          storageKey: item.storageKey,
          annotationId: item.annotationId ?? extractAnnotationId(baseEntry?.o),
          pageNumber: mutation.pageNumber,
          operationId: mutation.id,
          deleted: item.deleted,
          survivor: item.survivor,
          baseObject: baseEntry?.o || item.base || previous?.base || null,
          capturedBase: item.base,
          previousLane: previous,
          gesture: mutation.gesture,
        });
        pendingLanesByKey.set(laneKey, lane);
        if (stableStringify(previous) !== stableStringify(lane)) {
          pendingLaneWrites.push([laneKey, lane]);
        }
      }
    }
    doc.transact(() => {
      for (const [laneKey, lane] of pendingLaneWrites) {
        eraserOpsMap.set(laneKey, lane);
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
    doc.transact(() => {
      for (const key of toDelete) {
        const previous = map.get(key);
        const tombstone = deletedPdfAnnotationEntry(previous?.o, previous?.p);
        if (tombstone) {
          deletedPdfAnnotations.set(
            deletedPdfAnnotationStorageKey(
              tombstone.pageNumber,
              tombstone.pdfAnnotationId,
            ),
            tombstone,
          );
        }
        map.delete(key);
        removed += 1;
      }
    }, origin);
  }

  // Adds/updates ONE PAGE PER TRANSACTION → one bounded op per page, so a 3000-
  // mark import becomes several resilient writes instead of one giant fragile
  // one. A page with no real changes emits no Yjs update at all.
  for (const [, entries] of desiredByPage) {
    doc.transact(() => {
      for (const [id, next] of entries) {
        const prev = map.get(id);
        const previousTombstone = deletedPdfAnnotationEntry(prev?.o, prev?.p);
        const nextPdfAnnotationId = next?.o?.pdfAnnotationId
          ? String(next.o.pdfAnnotationId)
          : null;
        if (
          previousTombstone
          && (
            previousTombstone.pdfAnnotationId !== nextPdfAnnotationId
            || Number(previousTombstone.pageNumber) !== Number(next.p)
          )
        ) {
          deletedPdfAnnotations.set(
            deletedPdfAnnotationStorageKey(
              previousTombstone.pageNumber,
              previousTombstone.pdfAnnotationId,
            ),
            previousTombstone,
          );
        }
        if (nextPdfAnnotationId) {
          deletedPdfAnnotations.delete(
            deletedPdfAnnotationStorageKey(next.p, nextPdfAnnotationId),
          );
        }
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
