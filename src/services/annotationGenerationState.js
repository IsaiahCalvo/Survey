import * as Y from 'yjs';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { docToByPage, docToDeletedPdfAnnotations,
  deletedPdfAnnotationStorageKey } from './annotationDocStore.js';

const ROOTS = new Set(['annotations', 'annotationEraserOps', 'deletedPdfAnnotations',
  'surveyMarkers', 'annoMeta', 'eraseOutbox']);

function invalid(reason) {
  const error = new Error(`Annotation generation state cannot be captured: ${reason}`);
  error.code = 'ANNOTATION_GENERATION_STATE_INVALID';
  throw error;
}

// Copy before materialization: Yjs JSON values are mutable references, and the
// normal reader promotes legacy identities on objects. Neither may affect the
// caller's accepted document. JSON.stringify alone silently loses bad values.
function copyJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') invalid('unsupported JSON value');
  if (ancestors.has(value)) invalid('cyclic JSON value');
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    invalid('non-JSON object');
  }
  ancestors.add(value);
  const next = array ? [] : {};
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) invalid('sparse or extended array');
  for (const key of keys) {
    if (array && key === 'length') continue;
    if (array && (!/^(0|[1-9]\d*)$/.test(String(key)) || Number(key) >= value.length)) {
      invalid('extended array');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid('unsupported JSON property');
    }
    Object.defineProperty(next, key, { value: copyJson(descriptor.value, ancestors), enumerable: true,
      writable: true, configurable: true });
  }
  ancestors.delete(value);
  return next;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const pageNumber = value => Number.isSafeInteger(value) && value > 0;
const nonempty = value => typeof value === 'string' && value.length > 0;

function validateRecord(name, key, value) {
  if (name === 'annoMeta') return;
  if (!nonempty(key)) invalid('empty map key');
  if (!record(value)) invalid(`malformed ${name} record`);
  if (name === 'annotations') {
    if (!pageNumber(value.p) || !record(value.o) || !nonempty(value.o.type)
      || Object.keys(value).some(field => field !== 'p' && field !== 'o')) invalid('malformed annotation');
  } else if (name === 'surveyMarkers') {
    if (!pageNumber(value.pageNumber)) invalid('malformed survey marker');
  } else if (name === 'deletedPdfAnnotations') {
    if (!pageNumber(value.pageNumber) || !nonempty(value.pdfAnnotationId)
      || key !== deletedPdfAnnotationStorageKey(value.pageNumber, value.pdfAnnotationId)) invalid('malformed native deletion');
  } else if (name === 'annotationEraserOps') {
    if (!nonempty(value.writerId) || !nonempty(value.storageKey) || !nonempty(value.operationId)
      || key !== `${value.writerId}\u0000${value.storageKey}` || !pageNumber(value.pageNumber)
      || typeof value.deleted !== 'boolean'
      || (value.deleted ? value.survivor !== null : !record(value.base) || !record(value.survivor))) {
      invalid('malformed eraser lane');
    }
    if (value.deletedPdfAnnotation != null) {
      const tombstone = value.deletedPdfAnnotation;
      if (!record(tombstone) || !pageNumber(tombstone.pageNumber) || !nonempty(tombstone.pdfAnnotationId)) {
        invalid('malformed eraser native deletion');
      }
    }
  } else if (name === 'eraseOutbox') {
    if (value.status !== 'acknowledged' || value.mutationId !== key
      || !Array.isArray(value.effects) || value.effects.length !== 0
      || !Array.isArray(value.acknowledgedEffectKeys) || value.acknowledgedEffectKeys.length !== 0
      || !Number.isSafeInteger(value.effectCount) || value.effectCount < 0) {
      invalid('pending or ambiguous erase outbox');
    }
  }
}

const canonicalJson = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};

function validateMaterialization(owned) {
  const deletions = new Map();
  const addDeletion = value => {
    const key = deletedPdfAnnotationStorageKey(value.pageNumber, value.pdfAnnotationId);
    if (deletions.has(key) && canonicalJson(deletions.get(key)) !== canonicalJson(value)) {
      invalid('ambiguous native deletion');
    }
    deletions.set(key, value);
  };
  owned.getMap('deletedPdfAnnotations').forEach(addDeletion);
  const lanes = new Map();
  owned.getMap('annotationEraserOps').forEach(lane => {
    if (lane.deleted && lane.deletedPdfAnnotation) addDeletion(lane.deletedPdfAnnotation);
    const group = lanes.get(lane.storageKey) || [];
    group.push(lane); lanes.set(lane.storageKey, group);
  });
  for (const [key, group] of lanes) {
    const base = owned.getMap('annotations').get(key);
    // Orphan lanes stay in old history; no visible base exists to flatten.
    if (!base || group.some(lane => lane.deleted)) continue;
    if (group.some(lane => lane.pageNumber !== base.p)) invalid('eraser lane page mismatch');
    // The display reader has legacy first-survivor fallbacks for mixed or
    // unsupported analytic intersections. Do not make such a fallback a new
    // permanent base. A future proven analytic merger can relax this gate.
    if (group.length > 1 && group.some(lane => !Array.isArray(lane.survivor.polygons)
      || lane.survivor.polygons.length === 0)) invalid('ambiguous eraser lanes');
  }
}

/** Materialize only Yjs semantic state. The caller proves acceptance and owns
 * page remapping; this does not capture sidebar state or build a checkpoint. */
export function materializeAnnotationGenerationState(doc) {
  if (!(doc instanceof Y.Doc) || doc.isDestroyed) invalid('live Y.Doc required');
  if (doc.store.pendingStructs || doc.store.pendingDs) invalid('unresolved Yjs history');
  const owned = createDetachedYDoc();
  try {
    for (const [name, root] of doc.share) {
      // Decoded roots start as AbstractType until getMap is called. Reading its
      // map entries through Y.Map does not convert or add roots on the input.
      if (!(root instanceof Y.Map) && root.constructor !== Y.AbstractType) invalid('unsupported root type');
      if (root._start !== null) invalid('non-map root content');
      const entries = [...Y.Map.prototype.entries.call(root)];
      if (!ROOTS.has(name)) {
        if (entries.length) invalid('unknown nonempty root');
        continue;
      }
      for (const [key, value] of entries) {
        const copy = copyJson(value);
        validateRecord(name, key, copy);
        owned.getMap(name).set(key, copy);
      }
    }
    validateMaterialization(owned);
    const annotationsByPage = docToByPage(owned);
    for (const page of Object.values(annotationsByPage)) {
      delete page.eraserMutation;
      delete page.eraserMaterializedMutationIds;
      delete page.eraserPresentationRevision;
    }
    return freeze(copyJson({ version: 1, annotationsByPage,
      deletedPdfAnnotations: docToDeletedPdfAnnotations(owned),
      surveyMarkers: Object.fromEntries(owned.getMap('surveyMarkers').entries()),
      annoMeta: Object.fromEntries(owned.getMap('annoMeta').entries()),
    }));
  } finally {
    owned.destroy();
  }
}
