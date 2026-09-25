import {
  createAnnotationStorageKeyResolver,
  getAnnotationStorageKey,
} from './annotationStorageIdentity.js';
import {
  deletedPdfAnnotationStorageKey,
  deriveWriterEraserLane,
  docToByPage,
  getAnnotationsMap,
  getDeletedPdfAnnotationsMap,
  getEraserOpsMap,
  readRawAnnotationEntry,
  writeAnnotationMark,
} from '../services/annotationDocStore.js';
import { counterSeriesMembershipSnapshot } from './counterSeriesMembership.js';
import {
  MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES,
  MAX_ERASE_DELETE_HISTORY_OBJECTS,
} from './annotationEraseLimits.js';

export const ERASE_OUTBOX_MAP = 'eraseOutbox';
export const MAX_ACKNOWLEDGED_ERASE_TOMBSTONES = 256;

const PAGE_DOMAINS = new Set(['page-object', 'callout', 'text-markup']);
const PARTIAL_ERASE_KINDS = new Set(['pen', 'highlighter']);
const VALID_DOMAINS = PAGE_DOMAINS;
const VALID_OPERATIONS = new Set(['replace', 'delete']);
const IMPORTED_EDIT_MARKER_KEYS = [
  'pdfImportedEditState',
  'pdfImportedEditedAt',
  'pdfImportedEditedBy',
  'pdfImportedEditSource',
];

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function nativeAnnotationIdentity(object) {
  return clone(object?.data?.pdfNativeAnnotationIdentity || null);
}

// w33: provenance the store does not keep (annotationMarkCodec.js
// UNSTORED_DATA_FIELDS): a screen copy that still carries it is the same mark.
const UNSTORED_KEYS = new Set(['pdfInkSourceGeometry']);

function stableSerialize(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const keys = Object.keys(value).filter((key) => !UNSTORED_KEYS.has(key)).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function serializedByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function valuesMatch(left, right) {
  return stableSerialize(left) === stableSerialize(right);
}

function counterNumbering(object) {
  return {
    displayNumber: object?.data?.displayNumber ?? null,
    seriesStart: object?.data?.seriesStart ?? null,
  };
}

function acknowledgedOutboxTombstone(entry, mutationId) {
  return {
    mutationId: entry?.mutationId || mutationId,
    actorUserId: entry?.actorUserId || null,
    status: 'acknowledged',
    committedAt: entry?.committedAt || null,
    effectCount: Array.isArray(entry?.effects)
      ? entry.effects.length
      : Number(entry?.effectCount) || 0,
    // The mutation id itself is the durable replay guard. Once every external
    // effect is acknowledged, retaining geometry-rich effect payloads and
    // before snapshots serves no recovery purpose.
    effects: [],
    acknowledgedEffectKeys: [],
  };
}

function pruneAcknowledgedOutboxTombstones(outbox) {
  const acknowledged = [...outbox.entries()]
    .filter(([, entry]) => entry?.status === 'acknowledged')
    .sort(([leftId, left], [rightId, right]) => {
      const timeOrder = String(left?.committedAt || '').localeCompare(
        String(right?.committedAt || ''),
      );
      return timeOrder || String(leftId).localeCompare(String(rightId));
    });
  const excess = acknowledged.length - MAX_ACKNOWLEDGED_ERASE_TOMBSTONES;
  for (let index = 0; index < excess; index += 1) {
    outbox.delete(acknowledged[index][0]);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function isCounterRenumberReplacement(before, after) {
  if (before?.data?.type !== 'counter' || after?.data?.type !== 'counter') return false;
  const withoutNumbering = (value) => {
    const copy = clone(value);
    if (copy?.data) {
      delete copy.data.displayNumber;
      delete copy.data.seriesStart;
    }
    return copy;
  };
  return valuesMatch(withoutNumbering(before), withoutNumbering(after));
}

function normalizeTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new TypeError('erase target must be an object');
  }
  assertNonEmptyString(target.domain, 'target.domain');
  assertNonEmptyString(target.storageKey, 'target.storageKey');
  assertNonEmptyString(target.kind, 'target.kind');
  assertNonEmptyString(target.operation, 'target.operation');
  if (!VALID_DOMAINS.has(target.domain)) {
    throw new TypeError(`unsupported erase domain: ${target.domain}`);
  }
  if (!VALID_OPERATIONS.has(target.operation)) {
    throw new TypeError(`unsupported erase operation: ${target.operation}`);
  }
  const isCounterRenumber = (
    target.kind === 'counter'
    && target.cause === 'counter-renumber'
    && isCounterRenumberReplacement(target.before, target.after)
  );
  if (
    target.operation === 'replace'
    && !PARTIAL_ERASE_KINDS.has(target.kind)
    && !isCounterRenumber
  ) {
    throw new TypeError(`partial erase is not allowed for ${target.kind}`);
  }
  if (target.operation === 'replace' && target.after === undefined) {
    throw new TypeError(`replacement target ${target.storageKey} requires after state`);
  }
  if (
    !PARTIAL_ERASE_KINDS.has(target.kind)
    && target.operation !== 'delete'
    && !isCounterRenumber
  ) {
    throw new TypeError(`${target.kind} must be whole-deleted`);
  }
  return {
    domain: target.domain,
    storageKey: target.storageKey,
    kind: target.kind,
    operation: target.operation,
    before: clone(target.before),
    ...(Number.isInteger(Number(target.pageNumber)) && Number(target.pageNumber) > 0
      ? { pageNumber: Number(target.pageNumber) }
      : {}),
    ...(Number.isInteger(target.index) && target.index >= 0 ? { index: target.index } : {}),
    ...(target.cause ? { cause: String(target.cause) } : {}),
    ...(target.after === undefined ? {} : { after: clone(target.after) }),
  };
}

export function classifyEraseObjectKind(object) {
  if (object?.data?.type === 'callout' || object?.type === 'callout') return 'callout';
  if (object?.data?.type === 'counter') return 'counter';
  const pdfMarkupType = String(object?.pdfAnnotationType || '').toLowerCase();
  if (
    ['highlight', 'underline', 'strikeout', 'squiggly'].includes(pdfMarkupType)
    || ['underline', 'strikeout', 'squiggly', 'text-markup'].includes(object?.data?.tool)
  ) return 'text-markup';
  if (String(object?.type || '').toLowerCase() === 'path') {
    return String(object?.data?.tool || '').toLowerCase().includes('highlight')
      ? 'highlighter'
      : 'pen';
  }
  return object?.data?.tool === 'text' || object?.type === 'textbox' ? 'text' : 'shape';
}

export function eraseObjectDomain(object) {
  const kind = classifyEraseObjectKind(object);
  if (kind === 'callout') return 'callout';
  if (kind === 'text-markup') return 'text-markup';
  return 'page-object';
}

export function getEraseObjectId(object) {
  return (
    object?.data?.id
    ?? object?.data?.annoId
    ?? object?.id
    ?? object?.annotationId
    ?? object?.pdfAnnotationId
    ?? null
  );
}

/**
 * Resolve the exact durable occurrence for each page object. Canonical
 * WeakMap-backed storage identities win; the shared resolver handles legacy
 * duplicate/id-less input until normalization has promoted those identities.
 */
export function createEraseStorageKeyResolver(pageNumber) {
  const resolve = createAnnotationStorageKeyResolver();
  return (object) => resolve(object, pageNumber, getEraseObjectId(object));
}

/**
 * Convert pageSpaceEraser's index-addressed mutation records into atomic
 * transaction targets. Index ownership is deliberate: matching generated
 * survivors by embedded id cross-wires duplicate/id-less siblings when an
 * earlier occurrence is deleted and a later one is carved.
 */
export function buildPageEraseTargets({
  pageNumber,
  originalObjects = [],
  objectMutations = [],
} = {}) {
  const objects = Array.isArray(originalObjects) ? originalObjects : [];
  const mutations = Array.isArray(objectMutations) ? objectMutations : [];
  const resolveStorageKey = createEraseStorageKeyResolver(pageNumber);
  const records = objects.map((object) => ({
    object,
    storageKey: resolveStorageKey(object),
  }));

  return mutations.map((mutation) => {
    const index = Number(mutation?.index);
    const record = Number.isInteger(index) ? records[index] : null;
    if (!record) {
      throw new TypeError(`erase mutation references missing page object index: ${mutation?.index}`);
    }
    const storageKey = mutation?.storageKey ?? getAnnotationStorageKey(record.object) ?? record.storageKey;
    assertNonEmptyString(String(storageKey || ''), 'target.storageKey');
    const kind = classifyEraseObjectKind(record.object);
    const deleted = mutation?.deleted === true || mutation?.survivor == null;
    return {
      domain: eraseObjectDomain(record.object),
      storageKey: String(storageKey),
      kind,
      operation: deleted ? 'delete' : 'replace',
      before: record.object,
      pageNumber: Number(pageNumber),
      index,
      ...(deleted ? {} : { after: mutation.survivor }),
    };
  });
}

/**
 * The local/no-cloud commit path receives pageSpaceEraser's output directly.
 * Callouts are deliberately skipped by that geometry engine and travel as
 * atomic intent targets, so apply their deletions before saving local JSON.
 */
export function applyLocalCalloutEraseTargets(pageAnnotations, targets = []) {
  const deletedIds = new Set(
    targets
      .filter((target) => (
        target?.domain === 'callout'
        && target?.operation === 'delete'
      ))
      .map((target) => getEraseObjectId(target.before))
      .filter((id) => id != null)
      .map(String),
  );
  if (deletedIds.size === 0) return pageAnnotations;
  const objects = Array.isArray(pageAnnotations?.objects) ? pageAnnotations.objects : [];
  return {
    ...(pageAnnotations || {}),
    objects: objects.filter((object) => !(
      classifyEraseObjectKind(object) === 'callout'
      && deletedIds.has(String(getEraseObjectId(object)))
    )),
  };
}

export function buildLocalCalloutEraseMutations(targets = []) {
  return targets
    .filter((target) => (
      target?.domain === 'callout'
      && target?.operation === 'delete'
      && Number.isInteger(target.index)
      && target.index >= 0
    ))
    .map((target) => ({
      index: target.index,
      storageKey: target.storageKey,
      annotationId: getEraseObjectId(target.before),
      base: target.before,
      deleted: true,
      survivor: null,
    }));
}

export function buildEraseIntent({
  mutationId,
  pageNumber,
  renderer,
  gesture,
  targets = [],
  sideEffects = [],
  diagnostics = null,
  presentationRevision = null,
}) {
  assertNonEmptyString(mutationId, 'mutationId');
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new TypeError('pageNumber must be a positive integer');
  }
  assertNonEmptyString(renderer, 'renderer');
  if (!gesture || !Array.isArray(gesture.points)) {
    throw new TypeError('gesture.points must be an array');
  }

  const normalizedTargets = targets.map((target) => normalizeTarget({
    ...target,
    pageNumber: target?.pageNumber ?? pageNumber,
  }));
  const intent = {
    mutationId,
    pageNumber,
    renderer,
    gesture: clone(gesture),
    targets: normalizedTargets,
    sideEffects: sideEffects.map((effect) => {
      assertNonEmptyString(effect?.type, 'sideEffect.type');
      assertNonEmptyString(effect?.targetKey, 'sideEffect.targetKey');
      const normalized = clone(effect);
      if (normalized.payload === undefined) {
        const target = normalizedTargets.find(
          (candidate) => candidate.storageKey === String(effect.targetKey),
        );
        if (target) {
          normalized.payload = {
            domain: target.domain,
            kind: target.kind,
            before: clone(target.before),
          };
        }
      }
      return normalized;
    }),
    ...(diagnostics ? { diagnostics: clone(diagnostics) } : {}),
    ...(presentationRevision ? { presentationRevision: String(presentationRevision) } : {}),
  };
  return deepFreeze(intent);
}

/**
 * Reconstruct the exact pre-gesture history snapshot from immutable intent
 * targets. React state can lag a just-settled queued erase by one render; using
 * that stale snapshot directly would make two rapid gestures share one Undo
 * baseline. Target.before is the CAS-validated predecessor and is authoritative.
 */
export function buildEraseHistoryBeforeSnapshot(snapshot, intent) {
  const next = clone(snapshot || {}) || {};
  const pageTargets = (intent?.targets || []).filter(
    (target) => PAGE_DOMAINS.has(target?.domain) && target?.before,
  );
  if (pageTargets.length > 0) {
    const annotationsByPage = { ...(next.annotationsByPage || {}) };
    const targetsByPage = new Map();
    for (const target of pageTargets) {
      const pageNumber = Number(target.pageNumber ?? intent?.pageNumber);
      if (!Number.isInteger(pageNumber) || pageNumber < 1) continue;
      if (!targetsByPage.has(pageNumber)) targetsByPage.set(pageNumber, []);
      targetsByPage.get(pageNumber).push(target);
    }
    for (const [pageNumber, targets] of targetsByPage) {
      const pageKey = String(pageNumber);
      const currentPage = annotationsByPage[pageKey]
        || annotationsByPage[pageNumber]
        || { objects: [] };
      const objects = Array.isArray(currentPage?.objects) ? [...currentPage.objects] : [];
      const resolveStorageKey = createEraseStorageKeyResolver(pageNumber);
      const indexByStorageKey = new Map(
        objects.map((object, index) => [String(resolveStorageKey(object)), index]),
      );
      const missing = [];
      for (const target of targets) {
        const storageKey = String(target.storageKey);
        const index = indexByStorageKey.get(storageKey);
        if (index == null) {
          missing.push(target);
          continue;
        }
        objects[index] = clone(target.before);
      }
      missing
        .sort((left, right) => (left.index ?? objects.length) - (right.index ?? objects.length))
        .forEach((target) => {
          const index = Number.isInteger(target.index)
            ? Math.max(0, Math.min(target.index, objects.length))
            : objects.length;
          objects.splice(index, 0, clone(target.before));
        });
      annotationsByPage[pageKey] = {
        ...currentPage,
        objects,
      };
    }
    next.annotationsByPage = annotationsByPage;
  }

  return next;
}

// `stored` is the plain { p, o } view of the per-field mark (store v2).
function getStoredTarget(doc, annotations, target, materializePageTarget) {
  const stored = readRawAnnotationEntry(doc, target.storageKey);
  return {
    map: annotations,
    stored,
    current: typeof materializePageTarget === 'function'
      ? materializePageTarget(target)
      : (stored?.o ?? stored),
  };
}

function cancelled(intent, reason) {
  return {
    status: 'cancelled',
    reason,
    mutationId: intent.mutationId,
  };
}

/**
 * Authorize and prepare every domain before opening the sole mutation boundary.
 * No callback capable of failing runs inside the Y.Doc transaction.
 */
export async function commitEraseIntent({
  doc,
  intent,
  origin = 'erase-local',
  undoManager,
  actorUserId = null,
  permissionContext,
  getDocumentLocked = () => false,
  validateTarget = () => true,
  materializePageTarget = null,
  eraserWriterId = null,
  injectFailure,
}) {
  if (!doc || typeof doc.getMap !== 'function') {
    throw new TypeError('doc must be a Y.Doc');
  }
  if (!intent?.mutationId || !Array.isArray(intent.targets)) {
    throw new TypeError('intent must be built by buildEraseIntent');
  }

  const annotations = getAnnotationsMap(doc);
  const outbox = doc.getMap(ERASE_OUTBOX_MAP);
  const eraserOps = getEraserOpsMap(doc);
  const deletedPdfAnnotations = getDeletedPdfAnnotationsMap(doc);
  const foreignEraserLaneStorageKeys = new Set();
  if (eraserWriterId) {
    eraserOps.forEach((lane) => {
      if (
        lane?.storageKey != null
        && String(lane.writerId) !== String(eraserWriterId)
      ) {
        foreignEraserLaneStorageKeys.add(String(lane.storageKey));
      }
    });
  }

  if (outbox.has(intent.mutationId)) {
    return { status: 'noop', mutationId: intent.mutationId };
  }
  if (
    permissionContext?.mode !== 'local-only'
    && (
      permissionContext?.mode !== 'registered'
      || typeof permissionContext.viewerId !== 'string'
      || permissionContext.viewerId.length === 0
      || typeof permissionContext.documentOwnerId !== 'string'
      || permissionContext.documentOwnerId.length === 0
    )
  ) {
    return cancelled(intent, 'permission-context');
  }
  const initiatingActorId = typeof actorUserId === 'string' ? actorUserId.trim() : '';
  if (
    permissionContext?.mode === 'registered'
    && initiatingActorId !== permissionContext.viewerId
  ) {
    return cancelled(intent, 'permission-context');
  }
  if (getDocumentLocked()) {
    return cancelled(intent, 'document-lock');
  }
  const counterSeriesPreconditions = Array.isArray(
    intent?.diagnostics?.counterSeriesPreconditions,
  )
    ? intent.diagnostics.counterSeriesPreconditions
    : [];
  const counterSeriesMembershipMatches = () => {
    if (counterSeriesPreconditions.length === 0) return true;
    const seriesKeys = counterSeriesPreconditions.map((entry) => entry.seriesKey);
    return valuesMatch(
      counterSeriesMembershipSnapshot(docToByPage(doc), seriesKeys),
      counterSeriesPreconditions,
    );
  };
  if (!counterSeriesMembershipMatches()) {
    return cancelled(intent, 'conflict');
  }

  const prepared = [];
  let activeDomain = null;
  const finishDomainPlan = () => {
    if (activeDomain) injectFailure?.(`plan:${activeDomain}`);
  };

  for (const target of intent.targets) {
    if (target.domain !== activeDomain) {
      finishDomainPlan();
      activeDomain = target.domain;
    }
    const snapshot = getStoredTarget(doc, annotations, target, materializePageTarget);
    if (snapshot.current === undefined) {
      return cancelled(intent, 'conflict');
    }
    // Pointer-up is compare-and-swap, not "erase whatever happens to be at
    // this key now." A collaborator may edit the same target while the local
    // drag is held; applying geometry computed from stale pointer-down state
    // would silently erase their edit.
    if (!valuesMatch(snapshot.current, target.before)) {
      return cancelled(intent, 'conflict');
    }
    if (!validateTarget({ target, current: clone(snapshot.current), intent })) {
      return cancelled(intent, 'permission');
    }
    const laneKey = `${String(eraserWriterId)}\u0000${target.storageKey}`;
    const previousLane = eraserWriterId ? eraserOps.get(laneKey) : null;
    const usesEraserLane = (
      eraserWriterId
      && target.cause !== 'counter-renumber'
    );
    let lane = usesEraserLane
      ? deriveWriterEraserLane({
        writerId: eraserWriterId,
        storageKey: target.storageKey,
        annotationId: getEraseObjectId(target.before),
        pageNumber: target.pageNumber ?? intent.pageNumber,
        operationId: intent.mutationId,
        baseObject: snapshot.stored?.o ?? snapshot.stored,
        capturedBase: target.before,
        // pageSpaceEraser already computed target.after in a worker. When no
        // other writer has a lane for this object, that survivor is also this
        // writer's exact lane result. Replaying the same cut here used to block
        // the browser thread after every pointer release. Keep the replay only
        // for the cross-writer case where it is needed to isolate each bite.
        preferCapturedSurvivor: !foreignEraserLaneStorageKeys.has(
          String(target.storageKey),
        ),
        previousLane,
        deleted: target.operation === 'delete',
        survivor: target.operation === 'delete' ? null : clone(target.after),
        gesture: intent.gesture,
      })
      : null;
    if (lane?.survivor && target.operation === 'replace') {
      const importedEditMarkers = {};
      for (const key of IMPORTED_EDIT_MARKER_KEYS) {
        if (Object.prototype.hasOwnProperty.call(target.after || {}, key)) {
          importedEditMarkers[key] = target.after[key];
        }
      }
      lane = {
        ...lane,
        survivor: {
          ...lane.survivor,
          ...importedEditMarkers,
          data: {
            ...(lane.survivor.data || {}),
            ...(target.after?.data?.pdfImportedEditState
              ? { pdfImportedEditState: target.after.data.pdfImportedEditState }
              : {}),
          },
        },
      };
    }
    if (lane?.deleted === true && target.before?.pdfAnnotationId) {
      const pdfNativeAnnotationIdentity = nativeAnnotationIdentity(target.before);
      lane = {
        ...lane,
        deletedPdfAnnotation: {
          pdfAnnotationId: String(target.before.pdfAnnotationId),
          pageNumber: Number(target.pageNumber ?? snapshot.stored?.p ?? intent.pageNumber),
          pdfAnnotationType: target.before?.pdfAnnotationType || null,
          ...(pdfNativeAnnotationIdentity ? { pdfNativeAnnotationIdentity } : {}),
        },
      };
    }
    prepared.push({
      target,
      map: snapshot.map,
      stored: clone(snapshot.stored),
      laneKey,
      previousLane: clone(previousLane),
      lane,
    });
  }
  finishDomainPlan();

  const preparedByStorageKey = new Map(
    prepared.map((entry) => [String(entry.target.storageKey), entry]),
  );
  const historyEffects = intent.sideEffects.filter(
    (effect) => effect?.type === 'annotation-delete-history',
  );
  const historyMutations = historyEffects
    .flatMap((effect) => (
      Array.isArray(effect?.payload?.mutations) ? effect.payload.mutations : []
    ))
    .map((mutation) => {
      const entry = preparedByStorageKey.get(String(mutation?.storageKey));
      if (
        mutation?.operation !== 'delete'
        || !entry?.lane
        || entry.lane.deleted !== true
      ) return clone(mutation);
      const compactMutation = clone(mutation);
      delete compactMutation.before;
      delete compactMutation.after;
      return {
        ...compactMutation,
        eraseDeleteLane: {
          writerId: entry.lane.writerId,
          operationId: entry.lane.operationId,
          storageKey: String(entry.target.storageKey),
        },
      };
    });
  const historyMutationId = String(
    historyEffects[0]?.payload?.mutationId || intent.mutationId,
  );
  const historyBatches = [];
  let currentHistoryBatch = [];
  for (const mutation of historyMutations) {
    const candidate = [...currentHistoryBatch, mutation];
    const candidatePayload = {
      mutationId: historyMutationId,
      batchIndex: Number.MAX_SAFE_INTEGER,
      batchTotal: Number.MAX_SAFE_INTEGER,
      gestureTotalCount: historyMutations.length,
      mutations: candidate,
    };
    if (
      currentHistoryBatch.length > 0
      && (
        candidate.length > MAX_ERASE_DELETE_HISTORY_OBJECTS
        || serializedByteLength(candidatePayload)
          > MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES
      )
    ) {
      historyBatches.push(currentHistoryBatch);
      currentHistoryBatch = [mutation];
    } else {
      currentHistoryBatch = candidate;
    }
    const singlePayload = {
      ...candidatePayload,
      mutations: currentHistoryBatch,
    };
    if (serializedByteLength(singlePayload) > MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES) {
      return cancelled(intent, 'history-payload-too-large');
    }
  }
  if (currentHistoryBatch.length > 0) historyBatches.push(currentHistoryBatch);

  const rebuiltHistoryEffects = historyBatches.map((mutations, batchIndex) => ({
    type: 'annotation-delete-history',
    targetKey: `${historyMutationId}:delete-history:${batchIndex + 1}-of-${historyBatches.length}`,
    payload: {
      mutationId: historyMutationId,
      batchIndex,
      batchTotal: historyBatches.length,
      gestureTotalCount: historyMutations.length,
      mutations,
    },
  }));
  if (rebuiltHistoryEffects.some(
    (effect) => (
      effect.payload.mutations.length > MAX_ERASE_DELETE_HISTORY_OBJECTS
      || serializedByteLength(effect.payload) > MAX_ERASE_DELETE_HISTORY_EFFECT_BYTES
    ),
  )) {
    return cancelled(intent, 'history-payload-too-large');
  }
  const normalizedEffects = [];
  let insertedHistory = false;
  for (const effect of intent.sideEffects) {
    if (effect?.type === 'annotation-delete-history') {
      if (!insertedHistory) {
        normalizedEffects.push(...rebuiltHistoryEffects);
        insertedHistory = true;
      }
      continue;
    }
    normalizedEffects.push(clone(effect));
  }
  const effects = normalizedEffects.map((effect) => ({
    ...effect,
    idempotencyKey: `${intent.mutationId}:${effect.type}:${effect.targetKey}`,
  }));
  if (effects.length > 0 && !initiatingActorId) {
    return cancelled(intent, 'permission-context');
  }
  const outboxEntry = {
    mutationId: intent.mutationId,
    actorUserId: initiatingActorId || null,
    status: effects.length === 0 ? 'acknowledged' : 'pending',
    committedAt: new Date().toISOString(),
    effects,
    acknowledgedEffectKeys: [],
  };
  injectFailure?.('plan:outbox');

  // Re-check the held-drag lock immediately before the only mutation boundary.
  if (getDocumentLocked()) {
    return cancelled(intent, 'document-lock');
  }
  injectFailure?.('before-core-commit');
  if (!counterSeriesMembershipMatches()) {
    return cancelled(intent, 'conflict');
  }

  undoManager?.stopCapturing();
  doc.transact(() => {
    for (const { target, map, stored, laneKey, lane } of prepared) {
      const pdfAnnotationId = target.before?.pdfAnnotationId
        ? String(target.before.pdfAnnotationId)
        : null;
      if (pdfAnnotationId && !lane) {
        const pageNumber = Number(target.pageNumber ?? stored?.p ?? intent.pageNumber);
        const tombstoneKey = deletedPdfAnnotationStorageKey(
          pageNumber,
          pdfAnnotationId,
        );
        if (target.operation === 'delete') {
          deletedPdfAnnotations.set(tombstoneKey, {
            pdfAnnotationId,
            pageNumber,
            pdfAnnotationType: target.before?.pdfAnnotationType || null,
            ...(nativeAnnotationIdentity(target.before)
              ? { pdfNativeAnnotationIdentity: nativeAnnotationIdentity(target.before) }
              : {}),
          });
        } else {
          deletedPdfAnnotations.delete(tombstoneKey);
        }
      }
      if (lane) {
        eraserOps.set(laneKey, lane);
      } else if (target.operation === 'delete') {
        map.delete(target.storageKey);
      } else {
        // Only the fields the erase changed are written (per-field store), so
        // a collaborator's concurrent edit to another field survives.
        writeAnnotationMark(
          doc,
          target.storageKey,
          stored?.p ?? target.pageNumber ?? intent.pageNumber,
          clone(target.after),
          stored?.o ? { base: stored.o, basePage: stored.p } : {},
        );
      }
    }
    outbox.set(intent.mutationId, outboxEntry);
    pruneAcknowledgedOutboxTombstones(outbox);
  }, origin);
  undoManager?.stopCapturing();

  return {
    status: 'committed',
    mutationId: intent.mutationId,
    historyTransition: {
      version: 1,
      mutationId: intent.mutationId,
      lanes: prepared
        .filter(({ lane }) => lane)
        .map(({ laneKey, previousLane, lane }) => ({
          laneKey,
          previousLane: previousLane || null,
          nextLane: clone(lane),
        })),
      counterRenumbers: prepared
        .filter(({ target, lane }) => !lane && target.cause === 'counter-renumber')
        .map(({ target }) => ({
          storageKey: String(target.storageKey),
          previous: counterNumbering(target.before),
          next: counterNumbering(target.after),
        })),
    },
  };
}

/**
 * Undo/Redo one committed eraser gesture by changing only that gesture's
 * writer lanes and derived counter numbering fields. The stable annotation
 * object is never replaced, so later collaborator style/metadata edits survive.
 */
export function applyEraseHistoryTransitionOnDoc({
  doc,
  transition,
  direction,
  origin = 'erase-history-local',
} = {}) {
  if (!doc || typeof doc.getMap !== 'function') {
    throw new TypeError('doc must be a Y.Doc');
  }
  if (!transition || transition.version !== 1) {
    return { status: 'conflict', reason: 'invalid-transition' };
  }
  if (direction !== 'undo' && direction !== 'redo') {
    throw new TypeError('direction must be undo or redo');
  }
  const eraserOps = getEraserOpsMap(doc);
  const lanePlans = (transition.lanes || []).map((entry) => {
    const current = eraserOps.get(entry.laneKey) ?? null;
    const expected = direction === 'undo'
      ? (entry.nextLane ?? null)
      : (entry.previousLane ?? null);
    const desired = direction === 'undo'
      ? (entry.previousLane ?? null)
      : (entry.nextLane ?? null);
    return { ...entry, current, expected, desired };
  });
  const counterPlans = (transition.counterRenumbers || []).map((entry) => {
    const stored = readRawAnnotationEntry(doc, entry.storageKey);
    const current = stored?.o;
    const expected = direction === 'undo' ? entry.next : entry.previous;
    const desired = direction === 'undo' ? entry.previous : entry.next;
    return { ...entry, stored, current, expected, desired };
  });
  if (lanePlans.some((entry) => !valuesMatch(entry.current, entry.expected))) {
    return { status: 'conflict', reason: 'lane-conflict' };
  }
  if (counterPlans.some((entry) => (
    !entry.current
    || !valuesMatch(counterNumbering(entry.current), entry.expected)
  ))) {
    return { status: 'conflict', reason: 'counter-conflict' };
  }
  if (lanePlans.length === 0 && counterPlans.length === 0) {
    return { status: 'noop', mutationId: transition.mutationId || null };
  }

  doc.transact(() => {
    for (const entry of lanePlans) {
      if (entry.desired == null) eraserOps.delete(entry.laneKey);
      else eraserOps.set(entry.laneKey, clone(entry.desired));
    }
    for (const entry of counterPlans) {
      const nextObject = {
        ...entry.current,
        data: {
          ...(entry.current.data || {}),
          displayNumber: entry.desired.displayNumber,
          seriesStart: entry.desired.seriesStart,
        },
      };
      // Only the counter's numbering fields are written.
      writeAnnotationMark(doc, entry.storageKey, entry.stored.p, nextObject, {
        base: entry.current,
        basePage: entry.stored.p,
      });
    }
  }, origin);
  return {
    status: 'applied',
    mutationId: transition.mutationId || null,
  };
}

/**
 * Restore full-delete eraser History actions by retiring only the exact writer
 * lane captured by that immutable History row. A later lane from the same
 * writer, or a concurrent delete lane from another writer, is never removed.
 */
export function restoreEraseDeletionOnDoc({
  doc,
  restoreActions,
  origin = 'erase-history-restore',
  validateTarget = () => true,
} = {}) {
  if (!doc || typeof doc.getMap !== 'function') {
    throw new TypeError('doc must be a Y.Doc');
  }
  const actions = (Array.isArray(restoreActions) ? restoreActions : [restoreActions])
    .filter(Boolean);
  if (actions.length === 0) {
    return { status: 'noop', restored: 0 };
  }

  const eraserOps = getEraserOpsMap(doc);
  const plans = [];
  const seenLaneKeys = new Set();

  for (const action of actions) {
    const laneRef = action?.eraseDeleteLane;
    const writerId = typeof laneRef?.writerId === 'string' ? laneRef.writerId : '';
    const operationId = typeof laneRef?.operationId === 'string' ? laneRef.operationId : '';
    const storageKey = String(laneRef?.storageKey || action?.storageKey || '');
    if (!writerId || !operationId || !storageKey) {
      return { status: 'conflict', reason: 'invalid-delete-lane' };
    }
    const laneKey = `${writerId}\u0000${storageKey}`;
    if (seenLaneKeys.has(laneKey)) continue;
    seenLaneKeys.add(laneKey);

    const lane = eraserOps.get(laneKey);
    const stored = readRawAnnotationEntry(doc, storageKey);
    const annotation = clone(stored?.o);
    if (!annotation) {
      return { status: 'conflict', reason: 'stable-base-missing' };
    }
    if (!lane) {
      if (!validateTarget({
        action: clone(action),
        annotation: clone(annotation),
        lane: null,
      })) {
        return { status: 'cancelled', reason: 'permission' };
      }
      continue;
    }
    if (
      lane.deleted !== true
      || String(lane.writerId || '') !== writerId
      || String(lane.operationId || '') !== operationId
      || String(lane.storageKey || '') !== storageKey
    ) {
      return { status: 'conflict', reason: 'lane-conflict' };
    }
    if (!validateTarget({
      action: clone(action),
      annotation: clone(annotation),
      lane: clone(lane),
    })) {
      return { status: 'cancelled', reason: 'permission' };
    }
    plans.push({
      action,
      annotation,
      lane,
      laneKey,
      storageKey,
      pageNumber: Number(action.pageNumber ?? lane.pageNumber ?? 1),
    });
  }

  if (plans.length === 0) {
    return { status: 'noop', restored: 0 };
  }

  doc.transact(() => {
    for (const plan of plans) {
      eraserOps.delete(plan.laneKey);
    }
  }, origin);

  return { status: 'applied', restored: plans.length };
}

/**
 * Retry-safe consumer for the durable erase side-effect outbox.
 *
 * Core annotation state commits before any effect runs. Each successful effect
 * is acknowledged under its stable idempotency key. A crash after the external
 * effect but before that ack intentionally retries the same key.
 */
export async function drainEraseOutbox({
  doc,
  executeEffect,
  validateEntry = null,
  actorUserId,
  origin = 'erase-outbox',
  injectFailure,
} = {}) {
  if (!doc || typeof doc.getMap !== 'function') {
    throw new TypeError('doc must be a Y.Doc');
  }
  if (typeof executeEffect !== 'function') {
    throw new TypeError('executeEffect must be a function');
  }
  const drainingActorId = typeof actorUserId === 'string' ? actorUserId.trim() : '';

  const outbox = doc.getMap(ERASE_OUTBOX_MAP);
  let acknowledged = 0;
  let pending = 0;
  const effectErrors = [];
  const entries = [...outbox.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)));

  for (const [mutationId] of entries) {
    let entry = outbox.get(mutationId);
    if (!entry || typeof entry !== 'object') continue;
    const effects = Array.isArray(entry.effects) ? entry.effects : [];
    // Cloud-backed callers gate irreversible effects on the exact core
    // mutation having reached authoritative accepted state. Optimistic
    // live/IndexedDB-only entries remain pending and are retried after WAL ack.
    if (
      typeof validateEntry === 'function'
      && !validateEntry({ mutationId, entry: clone(entry) })
    ) {
      if (entry.status !== 'acknowledged') pending += 1;
      continue;
    }

    // Old/pre-fix empty entries must self-heal instead of retrying forever.
    if (effects.length === 0 && entry.status !== 'acknowledged') {
      doc.transact(() => {
        const latest = outbox.get(mutationId);
        if (!latest || typeof latest !== 'object') return;
        outbox.set(mutationId, acknowledgedOutboxTombstone(latest, mutationId));
        pruneAcknowledgedOutboxTombstones(outbox);
      }, origin);
      entry = outbox.get(mutationId);
    }
    // External cleanup belongs to the collaborator who initiated the erase.
    // Another opener can materialize the shared core mutation, but must never
    // attribute History or run trash/Excel/legacy writes using their identity.
    // Actorless legacy effect entries fail closed; the initiating actor can
    // recover all new entries because commit persists this field atomically.
    if (
      effects.length > 0
      && (
        !drainingActorId
        || typeof entry.actorUserId !== 'string'
        || entry.actorUserId !== drainingActorId
      )
    ) {
      continue;
    }

    for (const effect of effects) {
      entry = outbox.get(mutationId);
      if (!entry || typeof entry !== 'object') break;
      const acknowledgedKeys = new Set(entry.acknowledgedEffectKeys || []);
      if (acknowledgedKeys.has(effect.idempotencyKey)) continue;

      try {
        await executeEffect(clone(effect), {
          mutationId,
          committedAt: entry.committedAt || null,
          idempotencyKey: effect.idempotencyKey,
          actorUserId: entry.actorUserId,
        });
      } catch (error) {
        // One recoverable destination (History/Excel/trash/etc.) must not
        // prevent independent cleanup effects in the same gesture. Leave this
        // key pending, continue, then surface the failure after every effect
        // has had one attempt so the scheduler retries the remaining keys.
        effectErrors.push({ mutationId, effect: clone(effect), error });
        continue;
      }
      injectFailure?.('after-effect-before-ack', {
        mutationId,
        effect: clone(effect),
      });

      doc.transact(() => {
        const latest = outbox.get(mutationId);
        if (!latest || typeof latest !== 'object') return;
        if (latest.actorUserId !== drainingActorId) return;
        const latestKeys = new Set(latest.acknowledgedEffectKeys || []);
        latestKeys.add(effect.idempotencyKey);
        const allAcknowledged = (latest.effects || []).every(
          (candidate) => latestKeys.has(candidate.idempotencyKey),
        );
        outbox.set(
          mutationId,
          allAcknowledged
            ? acknowledgedOutboxTombstone(latest, mutationId)
            : {
              ...latest,
              status: 'pending',
              acknowledgedEffectKeys: [...latestKeys],
            },
        );
        if (allAcknowledged) pruneAcknowledgedOutboxTombstones(outbox);
      }, origin);
      acknowledged += 1;
    }

    entry = outbox.get(mutationId);
    if (entry?.status !== 'acknowledged') pending += 1;
  }

  if (effectErrors.length > 0) {
    const error = new AggregateError(
      effectErrors.map((entry) => entry.error),
      `${effectErrors.length} erase outbox effect(s) failed`,
    );
    error.eraseOutboxResult = {
      status: 'failed',
      acknowledged,
      pending,
      failures: effectErrors.map(({ mutationId, effect, error: cause }) => ({
        mutationId,
        idempotencyKey: effect.idempotencyKey,
        message: cause?.message || String(cause),
      })),
    };
    throw error;
  }

  return {
    status: 'drained',
    acknowledged,
    pending,
  };
}
