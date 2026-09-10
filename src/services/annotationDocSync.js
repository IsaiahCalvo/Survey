// src/services/annotationDocSync.js
//
// The durable wiring on top of annotationDocStore's pure engine. Makes a
// document's Y.Doc survive everything:
//   * INSTANT local durability via y-indexeddb (works fully offline).
//   * DURABLE cloud persistence via the append-only annotation_updates log —
//     every Y.Doc mutation is written as one row BEFORE anything else, so a
//     mark can never be "rendered but never saved" again. There is no
//     documentId-timing gate: the moment a documentId exists, ops flush.
//   * FAST open via the latest annotation_snapshots row + the tail of ops after
//     it (Y.applyUpdate(snapshot) then replay).
//   * LIVE multi-device via Realtime inserts on annotation_updates.
//
// The Supabase + Yjs core is injectable-free of the browser: pass
// enableLocal:false / enableRealtime:false and it runs headlessly in Node
// against the real backend (see agent-cli/yjs-roundtrip.mjs), which is how the
// durable path is proved before the viewer is wired to it.

import * as Y from 'yjs';
import { getLegacyYDocDocumentPrefix } from '../lib/collab/legacyYDocScope.js';
import {
  createDetachedYDoc,
  getOrCreateYDoc,
  purgeYDoc,
  purgeYDocsByPrefix,
  releaseYDoc,
} from '../lib/collab/ydocRegistry.js';
import {
  createAnnotationOutbox,
  annotationOutboxRecordKey,
} from './annotationDocOutbox.js';
import { bindAnnotationGenerationOutbox } from './annotationGenerationOutbox.js';
import { createAnnotationGenerationTransport } from './annotationGenerationTransport.js';
import { readCheckedGenerationBootstrap } from './documentGenerationReader.js';
import { materializeSurveyCrdtV2, updateSurveyMarkersV2, updateSurveySpacesV2 }
  from './documentSurveyCrdtV2.js';
import { normalizeAnnotationSequence as sequence, compareAnnotationSequences as compareSequence,
  nextAnnotationSequence, maxAnnotationSequence, annotationSequenceToSafeInteger } from './annotationSequence.js';
import { materializeAnnotationGenerationState } from './annotationGenerationState.js';
import { erasedPathSurvivorsShareGeometry } from '../utils/pageSpaceEraser.js';
import {
  ERASE_OUTBOX_MAP,
  applyEraseHistoryTransitionOnDoc,
  commitEraseIntent as commitEraseIntentOnDoc,
  drainEraseOutbox as drainEraseOutboxOnDoc,
  restoreEraseDeletionOnDoc,
} from '../utils/annotationEraseTransaction.js';
import { getAnnotationAuthorId } from '../lib/collab/permissionScope.js';
import {
  createAnnotationStorageKeyResolver,
  normalizeByPageAnnotationIdentities,
} from '../utils/annotationStorageIdentity.js';
import {
  ANNOTATIONS_MAP,
  DELETED_PDF_ANNOTATIONS_MAP,
  ERASER_OPS_MAP,
  META_MAP,
  SURVEY_MARKERS_MAP,
  deletedPdfAnnotationStorageKey,
  getAnnotationsMap,
  getDeletedPdfAnnotationsMap,
  getEraserOpsMap,
  getSurveyMarkersMap,
  extractAnnotationId,
  docToByPage,
  docToDeletedPdfAnnotations,
  syncByPageToDoc,
  encodeSnapshot,
  getMetaValue,
  setMetaValue,
  docToSurveyMarkers,
  syncSurveyMarkersToDoc,
  repairStackedInkDuplicates,
} from './annotationDocStore.js';

// The flat annotation store gets its OWN registry-managed Y.Doc, keyed apart
// from the legacy CRDT doc so the two never share a map. (The applyUpdate-only
// invariant requires all Y.Doc construction to live in the registry module.)
const REGISTRY_PREFIX = 'annoflat:';
// Keep the binding across module reloads. A generation-bound live Y.Doc must
// never bridge actors or PDF generations. Legacy shared-doc behavior stays as is.
const DOC_SCOPE_BINDINGS = globalThis.__annotationDocScopeBindings__ ??= new WeakMap();

const SNAPSHOT_AFTER_OPS = 40;      // compact to a fresh snapshot every N ops
const SNAPSHOT_DEBOUNCE_MS = 1200;  // after edits settle, write a full-state checkpoint
const SNAPSHOT_RETRIES = 4;         // the checkpoint is the durability guarantee — retry hard
const SNAPSHOT_ENC_GZIP = 2;        // encoding_version 2 = gzipped Y.encodeStateAsUpdate
const CLOUD_REQUEST_TIMEOUT_MS = 15_000;
const GAP_REPAIR_RETRY_MS = 1_000;
const GAP_REPAIR_RETRY_MAX_MS = 30_000;
const REMOTE_ORIGIN = 'remote';
const HYDRATE_ORIGIN = 'hydrate';
const GENERATED_STATE_BYTES = 64 * 1024 * 1024;
const GENERATED_TAIL_PAGES = 1000;
const PERMISSION_ROLLBACK_ORIGIN = 'permission-rollback';
const DURABLE_MAP_NAMES = [
  ANNOTATIONS_MAP,
  DELETED_PDF_ANNOTATIONS_MAP,
  ERASER_OPS_MAP,
  META_MAP,
  SURVEY_MARKERS_MAP,
  ERASE_OUTBOX_MAP,
];
const ACTIVE_STATES = (globalThis.__annotationDocSyncActiveStates__ ??= new Map());
// Retired handles are no longer active, but an inactive viewer may still hold
// their receipt. A purge must invalidate those receipts before its first await.
const LOCAL_RECEIPT_PURGE_EPOCHS = (globalThis.__annotationLocalReceiptPurgeEpochs__ ??= new Map());
const ISSUED_LOCAL_RECEIPTS = new WeakMap();
const ISSUED_ACCEPTED_CAPTURES = new WeakMap();
const COMPACTED_RECEIPT_WITHOUT_SEQUENCE = Symbol('compacted-receipt-without-sequence');

function historyQuarantineDedupeKey(state, evidenceKeys = []) {
  const normalizedKeys = [...new Set(
    (evidenceKeys || []).map((key) => String(key || '').trim()).filter(Boolean),
  )].sort();
  if (normalizedKeys.length === 0) return null;
  return [
    state.documentId,
    state.actorUserId,
    state.documentIncarnation,
    ...normalizedKeys,
  ].join('\u0001');
}

function deletedDocumentError(documentId) {
  const error = new Error(`annotation document ${documentId} was deleted`);
  error.code = 'ANNOTATION_DOCUMENT_DELETED';
  return error;
}

function assertStateWritable(state) {
  if (state.deleted) throw deletedDocumentError(state.documentId);
  if (state.generationBlocked) throw state.generationError;
}

// Conditional reads are refresh work, not queued writes. Once close starts,
// their bytes must never enter a reused registry doc or replace its prefix.
function assertConditionalReadLive(state) {
  assertStateWritable(state);
  if (state.closePromise || state.destroyed) {
    const error = new Error(`annotation handle for ${state.documentId} is closed`);
    error.code = 'ANNOTATION_HANDLE_CLOSED';
    throw error;
  }
}

// Public callers must not mutate through a retired handle. Internal queued
// appends use assertStateWritable so pre-close work can still finish safely.
function assertHandleWritable(state) {
  assertStateWritable(state);
  if (state.closePromise || state.destroyed) {
    const error = new Error(`annotation handle for ${state.documentId} is closed`);
    error.code = 'ANNOTATION_HANDLE_CLOSED';
    throw error;
  }
  if (state.generationTransport) annotationSequenceToSafeInteger(nextAnnotationSequence(state.clientSeq));
}

function registerActiveState(state) {
  let states = ACTIVE_STATES.get(state.documentId);
  if (!states) {
    states = new Set();
    ACTIVE_STATES.set(state.documentId, states);
  }
  states.add(state);
}

function unregisterActiveState(state) {
  const states = ACTIVE_STATES.get(state.documentId);
  if (!states) return;
  states.delete(state);
  if (states.size === 0) ACTIVE_STATES.delete(state.documentId);
}

function invalidateDeletedState(state, error = deletedDocumentError(state.documentId)) {
  if (state.deleted) return;
  state.deleted = true;
  state.destroyed = true;
  state.conditionalCheckpointPrefix = null;
  unregisterActiveState(state);
  if (state.snapshotTimer) {
    clearTimeout(state.snapshotTimer);
    state.snapshotTimer = null;
  }
  if (state.outboxReplayTimer) {
    clearTimeout(state.outboxReplayTimer);
    state.outboxReplayTimer = null;
  }
  state.eraseOutboxClosing = true;
  clearEraseOutboxRetry(state);
  clearGapRepairTimer(state);
  if (state.onDocUpdate) {
    try { state.doc.off('update', state.onDocUpdate); } catch { /* already detached */ }
    state.onDocUpdate = null;
  }
  state.doc.transact(() => {
    for (const mapName of DURABLE_MAP_NAMES) {
      const map = state.doc.getMap(mapName);
      for (const key of [...map.keys()]) map.delete(key);
    }
  }, PERMISSION_ROLLBACK_ORIGIN);
  state.lastByPage = null;
  markSyncHealth(state, false, error);
  notifyChange(state);
  destroyLocalPersistence(state);
}

// Gzip the checkpoint so heavy documents stay well under request-size limits
// (a many-thousand-mark Y.Doc compresses several-fold). Available in browsers
// and Node 18+.
async function gzip(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// PostgREST returns/accepts bytea as '\x<hex>'.
function bytesToPgHex(u8) {
  let hex = '';
  for (let i = 0; i < u8.length; i += 1) hex += u8[i].toString(16).padStart(2, '0');
  return `\\x${hex}`;
}
function pgHexToBytes(str) {
  if (str instanceof Uint8Array) return str;
  const hex = (typeof str === 'string' && str.startsWith('\\x')) ? str.slice(2) : (str || '');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function randomClientId() {
  return crypto.randomUUID();
}

function persistenceActorScope(actorUserId) {
  return encodeURIComponent(String(actorUserId));
}

function persistenceGenerationKey(documentId, actorUserId, pdfGenerationId = null) {
  return `annotationPersistenceGeneration:${documentId}:${persistenceActorScope(actorUserId)}${pdfGenerationId == null ? '' : `:pdf-generation:${pdfGenerationId}`}`;
}

function persistenceActorsKey(documentId) {
  return `annotationPersistenceActors:${documentId}`;
}

function registerPersistenceActor(documentId, actorUserId, pdfGenerationId = null) {
  try {
    const key = persistenceActorsKey(documentId);
    const actors = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
    actors.add(persistenceActorScope(actorUserId) + (pdfGenerationId == null ? '' : `:pdf-generation:${pdfGenerationId}`));
    localStorage.setItem(key, JSON.stringify([...actors]));
  } catch { /* local persistence unavailable */ }
}

function persistenceDatabaseName(documentId, actorUserId, generation, pdfGenerationId = null) {
  return `anno-${documentId}-actor-${persistenceActorScope(actorUserId)}${pdfGenerationId == null ? '' : `:pdf-generation:${pdfGenerationId}`}-g${generation}`;
}

function readPersistenceGeneration(documentId, actorUserId, pdfGenerationId = null) {
  try {
    return Math.max(
      0,
      Number(localStorage.getItem(persistenceGenerationKey(documentId, actorUserId, pdfGenerationId))) || 0,
    );
  } catch {
    return 0;
  }
}

function writePersistenceGeneration(documentId, actorUserId, generation, pdfGenerationId = null) {
  try {
    localStorage.setItem(
      persistenceGenerationKey(documentId, actorUserId, pdfGenerationId),
      String(generation),
    );
  } catch { /* local persistence unavailable */ }
}

/** A per-install stable client id (browser). Node callers pass one in. */
export function getClientId() {
  try {
    if (typeof localStorage !== 'undefined') {
      let id = localStorage.getItem('annoClientId');
      if (!id) { id = randomClientId(); localStorage.setItem('annoClientId', id); }
      return id;
    }
  } catch { /* ignore */ }
  return randomClientId();
}

/**
 * Open (or create) a durable annotation document.
 *
 * @returns {Promise<AnnotationDocHandle>}
 */
export async function openAnnotationDoc({
  documentId,
  pdfGenerationId = null,
  checkedBundle = null,
  supabase,
  clientId = getClientId(),
  writerId = null,
  enableLocal = true,
  enableRealtime = true,
  doc = null,
  localPersistenceFactory = null,
  legacyPersistenceFactory = null,
  localSyncTimeoutMs = 3000,
  requestTimeoutMs = CLOUD_REQUEST_TIMEOUT_MS,
  snapshotRetryDelayMs = 400,
  repairRetryDelayMs = GAP_REPAIR_RETRY_MS,
  outboxStore = null,
  actorUserId,
  eraseEffectConsumer = null,
  eraseOutboxRetryBaseMs = 250,
  eraseOutboxRetryMaxMs = 30_000,
}) {
  if (!documentId) throw new Error('openAnnotationDoc: documentId required');
  if (!actorUserId) throw new Error('openAnnotationDoc: actorUserId required');
  if (pdfGenerationId != null && (typeof pdfGenerationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pdfGenerationId))) {
    throw new Error('openAnnotationDoc: pdfGenerationId must be a canonical UUID or null');
  }
  if (pdfGenerationId != null && typeof supabase?.rpc !== 'function') {
    throw new Error('openAnnotationDoc: PDF generations require the checked RPC transport');
  }
  // Only the reader's completed result can supply accepted bytes. Capture its
  // private copy before any registry acquisition, local store work or await;
  // a caller-created object or a mutated public byte array grants no authority.
  const checkedBootstrap = checkedBundle == null ? null : readCheckedGenerationBootstrap(
    checkedBundle, { documentId, actorUserId, pdfGenerationId },
  );
  const contentModelVersion = checkedBootstrap?.contentModelVersion ?? 1;
  const contentModelProtocolModern = checkedBootstrap != null
    && Object.hasOwn(checkedBootstrap, 'contentModelVersion');

  // Default: a dedicated registry-managed Y.Doc for this document's flat store.
  const registryKey = `${REGISTRY_PREFIX}${documentId}:${actorUserId}${pdfGenerationId == null ? '' : `:pdf-generation:${pdfGenerationId}:content-model:${contentModelVersion}`}`;
  const ownsRegistryDoc = !doc;
  const activeDoc = doc || getOrCreateYDoc(registryKey);
  const priorScope = DOC_SCOPE_BINDINGS.get(activeDoc);
  const priorKey = typeof priorScope === 'string' ? priorScope : priorScope?.registryKey;
  const wasGenerated = typeof priorScope === 'string'
    ? priorScope.includes(':pdf-generation:') : priorScope?.pdfGenerationId != null;
  if ((priorScope && priorKey !== registryKey && (pdfGenerationId != null || wasGenerated))
    || (!priorScope && doc && pdfGenerationId != null
      && (doc.store.clients.size !== 0 || doc.store.pendingStructs || doc.store.pendingDs))) {
    throw Object.assign(new Error('The supplied annotation document does not belong to this PDF generation'),
      { code: 'ANNOTATION_DOC_SCOPE_MISMATCH' });
  }
  DOC_SCOPE_BINDINGS.set(activeDoc, { registryKey, pdfGenerationId });
  const activeWriterId = writerId || `${clientId}:${randomClientId()}`;
  const useRealtime = Boolean(
    enableRealtime && supabase && typeof supabase.channel === 'function',
  );

  const state = {
    documentId,
    pdfGenerationId,
    contentModelVersion,
    contentModelProtocolModern,
    generationTransport: null,
    generationBlocked: false,
    generationError: null,
    generationRetirement: null,
    generationCatchup: null,
    generationCatchupError: null,
    generationCatchupRequested: false,
    generationRefreshRequested: false,
    generationLastSignal: null,
    conditionalCheckpointPrefix: checkedBootstrap?.conditionalCheckpoint ?? null,
    registryKey,
    ownsRegistryDoc,
    supabase,
    clientId,
    // clientId identifies an installation. WAL idempotency needs a writer
    // identity per OPEN: two tabs otherwise both seed client_seq=N and race
    // different payloads into the same unique key.
    writerId: activeWriterId,
    doc: activeDoc,
    acceptedDoc: createDetachedYDoc(`accepted:${documentId}:${activeWriterId}`),
    stagedDoc: createDetachedYDoc(`staged:${documentId}:${activeWriterId}`),
    persistedDoc: createDetachedYDoc(`persisted:${documentId}:${activeWriterId}`),
    localPersistenceDoc: null,
    onLocalPersistenceUpdate: null,
    map: getAnnotationsMap(activeDoc),
    lastSeq: 0,            // highest annotation_updates.seq we've applied
    coveredSeq: 0,         // highest seq included by an ordered hydrate/catch-up
                           // read. Realtime alone never advances this because a
                           // delivered seq N does not prove a lower transaction
                           // has committed yet.
    replayFromSeq: 0,      // snapshot baseline. Catch-up always replays from
                           // here so a transaction that commits late with a
                           // lower identity seq cannot be skipped.
    snapshotBaseAtSeq: null,
    snapshotBaseWriterId: null,
    snapshotBaseWriterEpoch: 0,
    snapshotGeneration: 0,
    catchupChain: Promise.resolve(), // serializes catch-up reads across reconnects
    realtimePhase: useRealtime ? 'connecting' : 'ready',
    realtimeCatchupGeneration: 0,
    authoritativeChain: Promise.resolve(),
    outboxReplayChain: Promise.resolve(),
    outboxReplayScheduled: false,
    outboxReplayTimer: null,
    outboxReplayRetryAttempt: 0,
    clientSeq: 0,          // monotonic per-(doc,writer-open) op counter
    opsSinceSnapshot: 0,
    lastByPage: null,      // last byPage applied — enables the per-page-ref fast diff
    snapshotTimer: null,   // debounced full-state checkpoint
    repairTimer: null,
    repairRetryAttempt: 0,
    snapshotChain: Promise.resolve(false), // serializes ALL snapshot writes so two
                           // never overlap and clobber each other (debounce vs eager vs destroy)
    editEpoch: 0,          // bumped on every local edit
    snapshottedEpoch: 0,   // highest editEpoch a successful snapshot has captured;
                           // editEpoch > snapshottedEpoch ⇒ uncaptured work remains.
                           // A generation counter, NOT a boolean, so a stale in-flight
                           // snapshot that completes after a newer edit can't wrongly
                           // mark that newer edit as saved.
    destroyed: false,
    closePromise: null,
    deleted: false,
    idbProvider: null,
    realtimeChannel: null,
    changeListeners: new Set(),
    syncListeners: new Set(),
    historyQuarantineListeners: new Set(),
    historyQuarantineGeneration: 0,
    lastHistoryQuarantineEvent: null,
    openHistoryQuarantineEvidenceKeys: new Set(),
    persistedSequenceReceipts: new Map(),
    unresolvedReceiptConflicts: new Set(),
    syncHealthy: true,     // false once an op append fails until it recovers (BL-24)
    durabilityGap: false,  // a locally-applied update is absent from both WAL and snapshot
    durabilityGapGeneration: 0,
    repairCheckpointUpdate: null, // immutable staged prefix through the last append result
    repairCheckpointEpoch: 0,
    repairCheckpointGeneration: 0,
    pendingAppends: 0,
    localMutationOrdinal: 0,
    localReceiptRevision: 0,
    localReceiptPurgeEpoch: LOCAL_RECEIPT_PURGE_EPOCHS.get(documentId) || 0,
    localRecoveryProof: null,
    localWriteTasks: new Set(),
    localCloseReceipt: null,
    permissionRejectedCutoff: 0,
    outbox: outboxStore,
    actorUserId,
    documentIncarnation: 0,
    appendRecords: new Map(),
    acceptedReceiptKeys: new Set(),
    acceptedEditEpoch: 0,
    persistedReconciliationDone: false,
    rebaseLocalMutations: false,
    quarantinedLocalHistory: false,
    lastSyncError: null,
    onPageHide: null,      // window listener that force-checkpoints on real tab close
    onDocUpdate: null,     // the local-mutation observer, kept so teardown can detach it
    flushQueue: Promise.resolve(),
    requestTimeoutMs,
    snapshotRetryDelayMs,
    repairRetryDelayMs,
    localPersistenceFactory,
    legacyPersistenceFactory,
    localSyncTimeoutMs,
    eraseEffectConsumer: typeof eraseEffectConsumer === 'function'
      ? eraseEffectConsumer
      : null,
    eraseOutboxDrain: Promise.resolve({
      status: 'idle',
      acknowledged: 0,
      pending: 0,
    }),
    eraseOutboxRetryTimer: null,
    eraseOutboxRetryAttempt: 0,
    eraseOutboxRetryBaseMs: Math.max(1, Number(eraseOutboxRetryBaseMs) || 250),
    eraseOutboxRetryMaxMs: Math.max(
      Math.max(1, Number(eraseOutboxRetryBaseMs) || 250),
      Number(eraseOutboxRetryMaxMs) || 30_000,
    ),
    eraseOutboxClosing: false,
    eraseOutboxOrigin: Object.freeze({ source: 'erase-outbox', writerId: activeWriterId }),
    persistenceGeneration: readPersistenceGeneration(documentId, actorUserId, pdfGenerationId),
    legacyPersistenceDoc: null,
    legacyClearDocument: null,
    legacyRecoveryPending: false,
    legacyUnresolvedEntries: 0,
  };
  if (pdfGenerationId != null) state.generationTransport = createAnnotationGenerationTransport({
    documentId, pdfGenerationId, actorUserId,
    ...(contentModelProtocolModern ? { contentModelVersion } : {}),
    request: (name, params, label) => withActorRequest(state, () => state.supabase.rpc(name, params), label),
  });

  // Everything below can fail (network, storage). A partially-opened state must
  // not outlive the failure: the update observer would keep appending ops from a
  // handle the caller never received (double-appends + client_seq collisions
  // against the retry's handle), and the registry refcount/IDB provider would
  // leak on every failed open. Tear down whatever was attached, then rethrow so
  // the caller still sees the failure.
  try {
    if (supabase && !state.outbox) {
      state.outbox = await createAnnotationOutbox();
    }
    if (state.outbox) state.outbox = bindAnnotationGenerationOutbox(state.outbox, state);
    if (pdfGenerationId != null && state.outbox?.storageKind !== 'indexeddb') {
      throw Object.assign(new Error('PDF generation recovery requires durable annotation storage'), {
        code: 'ANNOTATION_LOCAL_STORAGE_UNAVAILABLE',
      });
    }
    if (state.outbox) {
      state.documentIncarnation = Number(
        await state.outbox.getDocumentIncarnation?.(documentId),
      ) || 0;
      await hydrateCleanAcceptedState(state);
      await loadPendingOutboxRecords(state);
      const quarantined = await state.outbox.listQuarantined?.(
        state.documentId,
        state.actorUserId,
      );
      for (const record of quarantined || []) {
        if (record?.key) state.openHistoryQuarantineEvidenceKeys.add(record.key);
      }
      state.quarantinedLocalHistory = (
        state.quarantinedLocalHistory
        || (quarantined?.length || 0) > 0
      );
    }
    // --- local instant durability (browser only) ---
    if (enableLocal && typeof indexedDB !== 'undefined') {
      try {
        registerPersistenceActor(documentId, actorUserId, pdfGenerationId);
        const persistenceDoc = createDetachedYDoc(
          `persistence:${documentId}:${activeWriterId}`,
        );
        state.localPersistenceDoc = persistenceDoc;
        if (localPersistenceFactory) {
          state.idbProvider = await localPersistenceFactory(
            persistenceDatabaseName(documentId, actorUserId, state.persistenceGeneration, pdfGenerationId),
            persistenceDoc,
          );
        } else {
          const { IndexeddbPersistence } = await import('y-indexeddb');
          state.idbProvider = new IndexeddbPersistence(
            persistenceDatabaseName(documentId, actorUserId, state.persistenceGeneration, pdfGenerationId),
            persistenceDoc,
          );
        }
        const localReady = await whenSynced(state.idbProvider, localSyncTimeoutMs);
        if (!localReady) {
          // A provider that misses the load bound must never remain attached to
          // the exposed live document. Its eventual replay is untrusted until a
          // future open can load and authorize it from the detached store.
          try { state.idbProvider.destroy(); } catch { /* */ }
          state.idbProvider = null;
          try { persistenceDoc.destroy(); } catch { /* */ }
          state.localPersistenceDoc = null;
          console.warn('[annotationDocSync] indexeddb initial load timed out');
        }
      } catch (err) {
        destroyLocalPersistence(state);
        console.warn('[annotationDocSync] indexeddb unavailable', err?.message);
      }
    }
    // Freeze the detached local cache before backend hydration or new user
    // edits. It is only an authorization candidate; it never seeds acceptedDoc.
    if (!state.quarantinedLocalHistory) {
      const persistedCandidate = state.localPersistenceDoc || activeDoc;
      Y.applyUpdate(
        state.persistedDoc,
        encodeSnapshot(persistedCandidate),
        HYDRATE_ORIGIN,
      );
      // Local-only documents have no backend accepted-state reconciliation.
      // Their actor-scoped IndexedDB snapshot is authoritative on a fresh
      // process, so hydrate it into the exposed doc before any new mutation.
      if (!supabase && state.localPersistenceDoc) {
        Y.applyUpdate(
          activeDoc,
          encodeSnapshot(state.localPersistenceDoc),
          HYDRATE_ORIGIN,
        );
      }
    }

    // --- seed the per-(doc,client) op counter so client_seq stays unique ---
    if (state.generationTransport) {
      state.clientSeq = annotationSequenceToSafeInteger(await generationCall(state, 'writerSequence', state.writerId));
    } else if (supabase) {
      const { data, error } = await withActorRequest(
        state,
        () => supabase
          .from('annotation_updates')
          .select('client_seq')
          .eq('document_id', documentId)
          .eq('client_id', state.writerId)
          .order('client_seq', { ascending: false })
          .limit(1),
        'writer sequence read',
      );
      if (error) throw toSyncError(error, 'writer sequence read failed');
      if (data && data[0]) state.clientSeq = Number(data[0].client_seq) || 0;
    }

    // --- load snapshot + tail from the cloud ---
    if (supabase) await loadFromBackend(state);
    // The accepted shadow is populated only by backend snapshot/WAL bytes.
    // Never seed it from activeDoc: activeDoc may already contain optimistic
    // IndexedDB state that the backend has never authorized.
    Y.applyUpdate(state.stagedDoc, encodeSnapshot(state.acceptedDoc), HYDRATE_ORIGIN);
    if (supabase) {
      if (pdfGenerationId == null) await loadLegacyPersistenceCandidate(state);
      // Reconcile the frozen pre-open local delta before exposing the handle.
      // New edits can therefore enqueue their exact observer bytes immediately
      // and can never overtake an older persisted predecessor while Realtime is
      // still joining (or never joins).
      await replayOutbox(state);
      if (state.quarantinedLocalHistory) {
        publishAcceptedState(state);
        const terminalRecords = [...state.appendRecords.values()].filter((record) => (
          record.status === 'rejected'
          || record.status === 'integrity-error'
          || record.status === 'dependency-error'
        ));
        for (const record of terminalRecords) {
          if (record?.key) state.openHistoryQuarantineEvidenceKeys.add(record.key);
        }
        if (!state.lastHistoryQuarantineEvent) {
          const hasIntegrityFailure = terminalRecords.some((record) => (
            record.status === 'integrity-error'
            || record.status === 'dependency-error'
          ));
          emitHistoryQuarantine(state, {
            reason: hasIntegrityFailure
              ? 'wal-integrity-collision'
              : 'permission-denied',
            code: hasIntegrityFailure ? '23505' : '42501',
            mutationIds: [],
            requiresFullHistoryReset: true,
            evidenceKeys: [...state.openHistoryQuarantineEvidenceKeys],
          });
        }
        state.rebaseLocalMutations = true;
        try { state.persistedDoc?.destroy(); } catch { /* */ }
        state.persistedDoc = null;
      } else {
        await reconcilePersistedLocalState(state);
      }
      if (pdfGenerationId == null) await reconcileLegacyLocalState(state);
    }
    // The provider is attached to a detached Y.Doc so pre-open bytes can be
    // authorized safely. Once reconciliation is complete, mirror subsequent
    // live updates into that detached actor-scoped persistence document.
    attachLocalPersistenceMirror(state);

    // --- observe local mutations → append to the durable log ---
    state.onDocUpdate = (update, origin, _doc, transaction) => {
      if (state.destroyed || state.deleted || state.generationBlocked) return;
      // Include remote updates and delete-only updates, not just local WAL
      // epochs. Any visible change invalidates a receipt already being read.
      state.localReceiptRevision += 1;
      // A closing handle owns only receipts from its already-running effects,
      // not new edits in the registry doc borrowed by the next viewer.
      if (state.closePromise && origin !== state.eraseOutboxOrigin) return;
      if (origin?.source === 'erase-outbox' && origin !== state.eraseOutboxOrigin) return;
      // Ignore writes we didn't originate as user edits: remote ops, the initial
      // hydrate, and the local IndexedDB replay (re-appending those would loop).
      if (origin === REMOTE_ORIGIN) {
        // Never mirror the live doc's derived conflict-resolution update into
        // clean shadows. It can contain a tombstone for the authoritative row
        // when an optimistic same-key item wins by client-id ordering. Only
        // applyAuthoritativeCloudRow's original server bytes are acceptance.
        return;
      }
      if (origin === HYDRATE_ORIGIN) {
        Y.applyUpdate(state.acceptedDoc, update, HYDRATE_ORIGIN);
        Y.applyUpdate(state.stagedDoc, update, HYDRATE_ORIGIN);
        if (state.persistedDoc) Y.applyUpdate(state.persistedDoc, update, HYDRATE_ORIGIN);
        return;
      }
      if (origin === PERMISSION_ROLLBACK_ORIGIN || origin === state.idbProvider) return;
      if (supabase) {
        state.editEpoch += 1;
        const staged = state.rebaseLocalMutations
          ? stageRebasedLocalMutation(state, transaction)
          : stageExactLocalUpdate(state, update);
        if (!staged) {
          // Rebased staging returns null only when this transaction changed no
          // durable map (or its durable projection is already identical).
          // There is nothing to append or roll back. Restoring acceptedDoc here
          // used to hide unrelated, valid pending WAL records until reopen.
          return;
        }
        enqueueAppend(state, staged.update, staged.snapshot, state.editEpoch, {
          historyTag: origin?.historyTag?.mutationId
            ? { ...origin.historyTag }
            : null,
        });
        // The full-state checkpoint is the durability GUARANTEE: even if an
        // individual op insert fails (network), the next checkpoint re-captures
        // the whole doc from memory. Schedule it on every local edit.
        scheduleSnapshot(state);
      }
      // No notifyChange here: the viewer already holds the state it just produced.
      // Pushing it back would clobber per-page render metadata. Remote ops DO
      // notify (see subscribeRealtime).
    };
    activeDoc.on('update', state.onDocUpdate);

    // Recover side effects from a core erase that survived a prior crash.
    // The consumer runs only after local/cloud hydration and observer wiring,
    // so its acknowledgements are themselves persisted like any other edit.
    if (state.eraseEffectConsumer) {
      void queueEraseOutboxDrain(state);
    }

    // --- live multi-device: apply remote ops as they land ---
    if (useRealtime) {
      subscribeRealtime(state);
    }

    // --- crash/tab-close durability: force a final checkpoint when the tab is
    // actually being unloaded (navigation, close, bfcache). React's cleanup
    // destroy() only fires on an orderly unmount; a tab-kill or navigation never
    // runs it, leaving any op that failed to append (BL-24) unrecovered until the
    // next open. We bind ONLY `pagehide` — NOT `visibilitychange` — so an ordinary
    // alt-tab / tab-switch does not trigger a full snapshot upload, and only flush
    // when there is uncaptured local work. Best-effort: the browser may not await
    // an async write during unload, but the local IndexedDB copy already captured
    // the mutation, so this is an extra guard, not the sole one.
    if (supabase && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      state.onPageHide = () => {
        if (
          state.destroyed
          || state.editEpoch === state.snapshottedEpoch
          || state.pendingAppends > 0
        ) return;
        try {
          writeSnapshot(state, captureSnapshotOptions(state))
            .then((result) => finalizeSnapshotResult(state, result));
        } catch { /* best-effort */ }
      };
      window.addEventListener('pagehide', state.onPageHide);
    }
    if (state.outbox?.getDocumentIncarnation) {
      const currentIncarnation = Number(
        await state.outbox.getDocumentIncarnation(documentId),
      ) || 0;
      if (currentIncarnation !== state.documentIncarnation) {
        throw deletedDocumentError(documentId);
      }
    }
    // No await between the final incarnation check and registration: purge
    // either sees this opening state or its bumped incarnation rejects open.
    registerActiveState(state);
  } catch (err) {
    clearEraseOutboxRetry(state);
    state.destroyed = true;
    state.conditionalCheckpointPrefix = null;
    clearGapRepairTimer(state);
    if (state.onDocUpdate) { try { activeDoc.off('update', state.onDocUpdate); } catch { /* */ } }
    if (state.realtimeChannel) { try { state.supabase.removeChannel(state.realtimeChannel); } catch { /* */ } }
    destroyLocalPersistence(state);
    if (state.onPageHide && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pagehide', state.onPageHide);
    }
    try { await state.outbox?.close?.(); } catch { /* */ }
    try { state.acceptedDoc.destroy(); } catch { /* */ }
    try { state.stagedDoc.destroy(); } catch { /* */ }
    try { state.persistedDoc?.destroy(); } catch { /* */ }
    try { state.legacyPersistenceDoc?.destroy(); } catch { /* */ }
    if (ownsRegistryDoc) releaseYDoc(registryKey);
    throw err;
  }

  return makeHandle(state);
}

function destroyLocalPersistence(state) {
  if (state.onLocalPersistenceUpdate) {
    try { state.doc.off('update', state.onLocalPersistenceUpdate); } catch { /* */ }
    state.onLocalPersistenceUpdate = null;
  }
  if (state.idbProvider) {
    try { state.idbProvider.destroy(); } catch { /* */ }
    state.idbProvider = null;
  }
  if (state.localPersistenceDoc) {
    try { state.localPersistenceDoc.destroy(); } catch { /* */ }
    state.localPersistenceDoc = null;
  }
}

function attachLocalPersistenceMirror(state) {
  if (
    state.onLocalPersistenceUpdate
    || !state.localPersistenceDoc
    || state.destroyed
    || state.deleted
  ) return;
  const target = state.localPersistenceDoc;
  state.onLocalPersistenceUpdate = (update, origin) => {
    if (
      state.destroyed
      || state.deleted
      || state.localPersistenceDoc !== target
      // Applying an authoritative row to a live doc with an optimistic
      // same-key winner can re-emit derived conflict DeleteSets. Persist only
      // the original server bytes applied explicitly by
      // applyAuthoritativeCloudUpdate, never that derived live update.
      || origin === REMOTE_ORIGIN
    ) return;
    // This is one-way only: the provider observes `target`; no listener ever
    // applies target updates back to the live doc, so there is no update loop.
    Y.applyUpdate(target, update, HYDRATE_ORIGIN);
  };
  state.doc.on('update', state.onLocalPersistenceUpdate);
}

async function rotateCleanPersistence(state) {
  if (!state.localPersistenceDoc && !state.idbProvider) return;
  destroyLocalPersistence(state);
  state.persistenceGeneration += 1;
  writePersistenceGeneration(
    state.documentId,
    state.actorUserId,
    state.persistenceGeneration,
    state.pdfGenerationId,
  );
  const persistenceDoc = createDetachedYDoc(
    `persistence:${state.documentId}:${state.writerId}:g${state.persistenceGeneration}`,
  );
  Y.applyUpdate(persistenceDoc, encodeSnapshot(state.acceptedDoc), HYDRATE_ORIGIN);
  state.localPersistenceDoc = persistenceDoc;
  try {
    const name = persistenceDatabaseName(
      state.documentId,
      state.actorUserId,
      state.persistenceGeneration,
      state.pdfGenerationId,
    );
    if (state.localPersistenceFactory) {
      state.idbProvider = await state.localPersistenceFactory(name, persistenceDoc);
    } else if (typeof indexedDB !== 'undefined') {
      const { IndexeddbPersistence } = await import('y-indexeddb');
      state.idbProvider = new IndexeddbPersistence(name, persistenceDoc);
    }
    if (state.idbProvider) {
      const ready = await whenSynced(state.idbProvider, state.localSyncTimeoutMs);
      if (!ready) throw new Error('clean persistence reseed timed out');
    }
    attachLocalPersistenceMirror(state);
  } catch (error) {
    destroyLocalPersistence(state);
    console.warn('[annotationDocSync] clean persistence rotation failed', error?.message);
  }
}

function whenSynced(provider, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (provider.synced) return resolve(true);
    let settled = false;
    let timer = null;
    const finish = (synced) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(synced);
    };
    provider.once('synced', () => finish(true));
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

function legacyEntryAuthorId(mapName, value) {
  if (mapName === ANNOTATIONS_MAP) return getAnnotationAuthorId(value?.o);
  if (mapName === SURVEY_MARKERS_MAP) return getAnnotationAuthorId(value);
  return null;
}

async function loadLegacyPersistenceCandidate(state) {
  if (
    !state.supabase
    || (
      typeof indexedDB === 'undefined'
      && !state.legacyPersistenceFactory
    )
  ) return;
  const name = `anno-${state.documentId}`;
  const legacyDoc = createDetachedYDoc(
    `legacy-persistence:${state.documentId}:${state.writerId}`,
  );
  let provider = null;
  try {
    if (state.legacyPersistenceFactory) {
      const created = await state.legacyPersistenceFactory(name, legacyDoc);
      provider = created?.provider ?? created;
      state.legacyClearDocument = created?.clearDocument ?? null;
    } else {
      const { IndexeddbPersistence, clearDocument } = await import('y-indexeddb');
      provider = new IndexeddbPersistence(name, legacyDoc);
      state.legacyClearDocument = () => clearDocument(name);
    }
    const ready = provider
      ? await whenSynced(provider, state.localSyncTimeoutMs)
      : false;
    try { await provider?.destroy?.(); } catch { /* detached load only */ }
    provider = null;
    if (!ready) {
      state.legacyRecoveryPending = true;
      state.legacyUnresolvedEntries = 1;
      try { legacyDoc.destroy(); } catch { /* */ }
      console.warn('[annotationDocSync] legacy IndexedDB recovery load timed out');
      return;
    }
    state.legacyPersistenceDoc = legacyDoc;
  } catch (error) {
    try { await provider?.destroy?.(); } catch { /* */ }
    try { legacyDoc.destroy(); } catch { /* */ }
    state.legacyRecoveryPending = true;
    state.legacyUnresolvedEntries = 1;
    console.warn('[annotationDocSync] legacy IndexedDB recovery unavailable', error?.message);
  }
}

async function reconcileLegacyLocalState(state) {
  const legacyDoc = state.legacyPersistenceDoc;
  if (!legacyDoc) return;
  if (state.appendRecords.size > 0) {
    // Actorless legacy bytes have no exact ordering relationship to the
    // actor-bound outbox. Even a net-zero pending update can carry a touched
    // key only in Yjs history, so visible staged-key comparison is insufficient.
    // Defer all legacy import until every exact outbox record is settled.
    const legacyUpdate = encodeSnapshot(legacyDoc);
    const decoded = Y.decodeUpdate(legacyUpdate);
    if (decoded.structs.length > 0 || decoded.ds.clients.size > 0) {
      state.legacyRecoveryPending = true;
      state.legacyUnresolvedEntries = Math.max(1, state.legacyUnresolvedEntries);
      console.warn('[annotationDocSync] legacy annotations wait for exact pending writes');
    }
    return;
  }
  if (state.quarantinedLocalHistory) {
    const legacyUpdate = encodeSnapshot(legacyDoc);
    const decoded = Y.decodeUpdate(legacyUpdate);
    if (decoded.structs.length > 0 || decoded.ds.clients.size > 0) {
      state.legacyRecoveryPending = true;
      state.legacyUnresolvedEntries = Math.max(1, state.legacyUnresolvedEntries);
      console.warn('[annotationDocSync] legacy annotations remain quarantined after a rejected local write');
    }
    return;
  }
  const mergedDoc = createDetachedYDoc(
    `legacy-merge:${state.documentId}:${state.writerId}`,
  );
  const recoverable = [];
  const ownedSemanticChanges = [];
  const unresolvedConflicts = new Set();
  try {
    // Merge the complete legacy Yjs history over current cloud truth. Unlike
    // iterating visible map entries, this preserves deletion tombstones and
    // lets authoritative cloud tombstones suppress stale legacy additions.
    Y.applyUpdate(mergedDoc, encodeSnapshot(state.acceptedDoc), HYDRATE_ORIGIN);
    Y.applyUpdate(mergedDoc, encodeSnapshot(legacyDoc), HYDRATE_ORIGIN);

    for (const mapName of DURABLE_MAP_NAMES) {
      const accepted = state.acceptedDoc.getMap(mapName);
      const legacy = legacyDoc.getMap(mapName);
      const merged = mergedDoc.getMap(mapName);
      const staged = state.stagedDoc.getMap(mapName);
      const stagedConflicts = new Set();
      for (const [key, value] of legacy.entries()) {
        if (accepted.has(key) && !mapValueEqual(accepted.get(key), value)) {
          // Preserve a visible legacy/cloud value disagreement even when Yjs
          // conflict resolution currently picks the cloud value. Clearing the
          // database would otherwise discard the only copy of that user data.
          unresolvedConflicts.add(`${mapName}\u0000${key}`);
        }
        if (staged.has(key) && !mapValueEqual(staged.get(key), value)) {
          // Ordinary actor-bound outbox rows are newer, exact local evidence.
          // Actorless legacy storage cannot override or re-author a stale
          // same-key value while that exact pending row is unresolved.
          stagedConflicts.add(key);
          unresolvedConflicts.add(`${mapName}\u0000${key}`);
        }
      }
      const keys = new Set([...accepted.keys(), ...merged.keys()]);
      for (const key of keys) {
        if (stagedConflicts.has(key)) continue;
        const acceptedHas = accepted.has(key);
        const mergedHas = merged.has(key);
        const acceptedValue = acceptedHas ? accepted.get(key) : undefined;
        const mergedValue = mergedHas ? merged.get(key) : undefined;
        if (
          acceptedHas === mergedHas
          && (!acceptedHas || mapValueEqual(acceptedValue, mergedValue))
        ) continue;

        const isAddition = !acceptedHas && mergedHas;
        const isDeletion = acceptedHas && !mergedHas;
        if (
          (!isAddition && !isDeletion)
          || (mapName !== ANNOTATIONS_MAP && mapName !== SURVEY_MARKERS_MAP)
        ) {
          unresolvedConflicts.add(`${mapName}\u0000${key}`);
          continue;
        }

        if (isDeletion) {
          // A shipped actorless Yjs tombstone contains a client/clock DeleteSet,
          // not the account that performed the delete. The deleted object's
          // author is not proof of the deleting actor, so never re-author a
          // legacy deletion automatically under whichever account opens next.
          unresolvedConflicts.add(`${mapName}\u0000${key}`);
          continue;
        }

        const authorId = legacyEntryAuthorId(mapName, mergedValue);
        if (String(authorId || '') !== String(state.actorUserId)) {
          unresolvedConflicts.add(`${mapName}\u0000${key}`);
          continue;
        }

        const change = {
          mapName,
          key,
          deleted: isDeletion,
          value: mergedValue,
        };
        ownedSemanticChanges.push(change);
        const stagedAlreadyCovers = isDeletion
          ? !staged.has(key)
          : staged.has(key) && mapValueEqual(staged.get(key), mergedValue);
        if (!stagedAlreadyCovers) recoverable.push(change);
      }
    }

    if (recoverable.length > 0) {
      const before = Y.encodeStateVector(state.stagedDoc);
      state.stagedDoc.transact(() => {
        for (const entry of recoverable) {
          const map = state.stagedDoc.getMap(entry.mapName);
          if (entry.deleted) map.delete(entry.key);
          else map.set(entry.key, entry.value);
        }
      }, HYDRATE_ORIGIN);
      const update = Y.encodeStateAsUpdate(state.stagedDoc, before);
      const decoded = Y.decodeUpdate(update);
      if (decoded.structs.length > 0 || decoded.ds.clients.size > 0) {
        state.editEpoch += 1;
        await enqueueAppend(
          state,
          update,
          encodeSnapshot(state.stagedDoc),
          state.editEpoch,
          { publishAfterAcceptance: true },
        );
        scheduleSnapshot(state);
      }
    }

    let pendingOwnedChanges = 0;
    for (const change of ownedSemanticChanges) {
      const accepted = state.acceptedDoc.getMap(change.mapName);
      const acceptedCovers = change.deleted
        ? !accepted.has(change.key)
        : (
          accepted.has(change.key)
          && mapValueEqual(accepted.get(change.key), change.value)
        );
      if (!acceptedCovers) pendingOwnedChanges += 1;
    }
    state.legacyUnresolvedEntries = unresolvedConflicts.size + pendingOwnedChanges;
    state.legacyRecoveryPending = state.legacyUnresolvedEntries > 0;

    if (state.legacyRecoveryPending) {
      console.warn('[annotationDocSync] legacy annotations quarantined for explicit recovery');
      return;
    }
    publishAcceptedAndVisiblePendingState(state);
    try {
      await state.legacyClearDocument?.();
      try { legacyDoc.destroy(); } catch { /* */ }
      state.legacyPersistenceDoc = null;
    } catch (error) {
      state.legacyRecoveryPending = true;
      state.legacyUnresolvedEntries = Math.max(1, ownedSemanticChanges.length);
      console.warn('[annotationDocSync] legacy IndexedDB retirement deferred', error?.message);
    }
  } finally {
    try { mergedDoc.destroy(); } catch { /* */ }
  }
}

function withCloudRequest(state, request, label) {
  const timeoutMs = Math.max(1, Number(state.requestTimeoutMs) || CLOUD_REQUEST_TIMEOUT_MS);
  let timer = null;
  return Promise.race([
    Promise.resolve(request),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} timed out after ${timeoutMs}ms`);
        error.code = 'ETIMEDOUT';
        reject(error);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function withActorRequest(state, createRequest, label) {
  assertStateWritable(state);
  if (state.generationTransport) {
    try { await state.outbox.assertScopeCurrent(state.documentId, state.actorUserId, state.documentIncarnation); }
    catch (error) {
      if (isGenerationFailure(error)) await retireGenerationState(state, error.replacementGenerationId, error);
      throw error;
    }
    assertStateWritable(state);
  }
  // Older local test adapters have no auth transport. Production Supabase
  // clients must bind each request to the actor who owns this handle/outbox.
  if (typeof state.supabase.auth?.getSession !== 'function') {
    return withCloudRequest(state, createRequest(), label);
  }
  const { data, error } = await withCloudRequest(
    state, state.supabase.auth.getSession(), `${label} session`,
  );
  const session = data?.session;
  if (error || session?.user?.id !== state.actorUserId || !session?.access_token) {
    const mismatch = new Error('Annotation sync is waiting for its original signed-in user');
    mismatch.code = 'ANNOTATION_ACTOR_MISMATCH';
    throw mismatch;
  }
  assertStateWritable(state);
  const request = createRequest();
  if (typeof request?.setHeader !== 'function') {
    throw new Error('Authenticated annotation requests require request-local headers');
  }
  // Request-local only: do not change the shared client's auth or headers.
  // Capturing the JWT also closes the account-switch race before actual fetch.
  return withCloudRequest(
    state, request.setHeader('Authorization', `Bearer ${session.access_token}`), label,
  );
}

function isGenerationFailure(error) {
  return ['SG001', 'SG002', 'SG003', 'ANNOTATION_PDF_GENERATION_RETIRED'].includes(error?.code);
}

async function retireGenerationState(state, replacementGenerationId, error = null) {
  // Seal synchronously. An already-dispatched request may still return an exact
  // receipt, but no queued append, effect, snapshot or observer may start work.
  state.generationBlocked = true;
  state.conditionalCheckpointPrefix = null;
  state.generationError ||= error || Object.assign(new Error('The PDF generation changed; saved edits require recovery review'), {
    code: 'ANNOTATION_PDF_GENERATION_RETIRED', replacementGenerationId,
  });
  state.localReceiptRevision += 1;
  state.eraseOutboxClosing = true;
  clearEraseOutboxRetry(state);
  clearGapRepairTimer(state);
  if (state.snapshotTimer) { clearTimeout(state.snapshotTimer); state.snapshotTimer = null; }
  if (state.outboxReplayTimer) { clearTimeout(state.outboxReplayTimer); state.outboxReplayTimer = null; }
  if (state.onDocUpdate) state.doc.off('update', state.onDocUpdate);
  if (state.realtimeChannel) {
    const channel = state.realtimeChannel; state.realtimeChannel = null;
    try { void Promise.resolve(state.supabase.removeChannel(channel)).catch(() => {}); } catch { /* sealed locally */ }
  }
  markSyncHealth(state, false, state.generationError);
  // SG002 may mean deletion, not a replacement. Never invent a generation or
  // destroy evidence when the server did not provide an explicit successor.
  if (replacementGenerationId == null) return null;
  if (state.generationRetirement) return state.generationRetirement;
  const pending = state.outbox.retireScope(state.documentId, state.actorUserId, state.documentIncarnation, {
    pdfGenerationId: state.pdfGenerationId, replacementGenerationId, reason: 'cloud-generation-replaced',
  });
  state.generationRetirement = pending;
  try { return await pending; }
  catch (failure) { state.generationRetirement = null; throw failure; }
}

async function generationCall(state, method, args) {
  try { return await state.generationTransport[method](args); }
  catch (error) {
    if (isGenerationFailure(error)) {
      await retireGenerationState(state, error.currentGenerationId ?? error.replacementGenerationId, error);
    }
    throw error;
  }
}

function generatedStateError(code = 'ANNOTATION_GENERATION_STATE') {
  return Object.assign(new Error('The complete annotation state could not be verified. Saved edits were kept.'), { code });
}

function requireCompleteGeneratedState(doc) {
  if (doc.store.pendingStructs || doc.store.pendingDs) throw generatedStateError();
}

function applyGeneratedUpdate(doc, update) {
  // A malformed ContentJSON decoder error can quote saved document text.
  // Never attach that exception as a cause or show it in sync diagnostics.
  try { Y.applyUpdate(doc, update, HYDRATE_ORIGIN); }
  catch { throw generatedStateError(); }
}

function generatedStateBytes(value, remaining = GENERATED_STATE_BYTES) {
  if (typeof value !== 'string' || (value.length - 2) / 2 > remaining) {
    throw generatedStateError('ANNOTATION_GENERATION_LIMIT');
  }
  return pgHexToBytes(value);
}

async function gunzipGenerated(state, bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await withCloudRequest(state, reader.read(), 'generation snapshot decode');
      assertStateWritable(state);
      if (done) break;
      length += value.byteLength;
      if (length > GENERATED_STATE_BYTES) throw generatedStateError('ANNOTATION_GENERATION_LIMIT');
      if (value.byteLength) chunks.push(value);
    }
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* a timed-out read may still be pending */ }
  }
}

async function readGeneratedTail(state, afterSeq, throughSeq, apply, usedBytes = 0,
  assertLive = assertStateWritable) {
  let cursor = afterSeq;
  let frontier = throughSeq;
  let pages = 0;
  for (;;) {
    if (++pages > GENERATED_TAIL_PAGES) throw generatedStateError('ANNOTATION_GENERATION_LIMIT');
    const page = await generationCall(state, 'updates', { afterSeq: cursor, throughSeq: frontier, limit: 1000 });
    assertLive(state);
    frontier = page.throughSeq;
    for (const row of page.rows) {
      assertLive(state);
      const update = generatedStateBytes(row.data, GENERATED_STATE_BYTES - usedBytes);
      usedBytes += update.byteLength;
      await apply(row, update);
      assertLive(state);
      cursor = sequence(row.seq);
    }
    if (!page.hasMore) return sequence(frontier);
    if (!page.rows.length) throw new Error('Generation tail page did not advance');
  }
}

async function readGeneratedCheckpoint(state) {
  const candidate = createDetachedYDoc(`generation-read:${state.registryKey}:${randomClientId()}`);
  try {
    const prefix = state.conditionalCheckpointPrefix;
    const conditional = prefix == null ? null : await generationCall(
      state, 'conditionalCheckpoint', { ...prefix.identity },
    );
    if (conditional) assertConditionalReadLive(state);
    const baseline = conditional ?? await generationCall(state, 'snapshot');
    if (conditional) assertConditionalReadLive(state);
    else assertStateWritable(state);
    const snap = conditional ? conditional.snapshot : baseline.snapshot;
    const identity = conditional ? conditional.snapshotIdentity : (snap ? {
      atSeq: snap.at_seq,
      writerId: snap.writer_id,
      writerEpoch: snap.writer_epoch,
      encodingVersion: snap.encoding_version,
      snapshotSha256: null,
    } : null);
    const baseAtSeq = conditional ? sequence(identity.atSeq) : (snap ? sequence(snap.at_seq) : null);
    const tailAfterSeq = conditional?.matched ? sequence(prefix.coveredSeq) : (baseAtSeq ?? 0);
    let baselineBytes = 0;
    if (conditional?.matched) {
      const bytes = new Uint8Array(prefix.update);
      baselineBytes = bytes.byteLength;
      if (baselineBytes > GENERATED_STATE_BYTES) throw generatedStateError('ANNOTATION_GENERATION_LIMIT');
      assertConditionalReadLive(state);
      applyGeneratedUpdate(candidate, bytes);
    } else if (snap?.snapshot) {
      let bytes = generatedStateBytes(snap.snapshot);
      if ((conditional ? identity.encodingVersion : snap.encoding_version) === SNAPSHOT_ENC_GZIP) {
        bytes = await gunzipGenerated(state, bytes);
        if (conditional) assertConditionalReadLive(state);
      }
      baselineBytes = bytes.byteLength;
      if (conditional) assertConditionalReadLive(state);
      else assertStateWritable(state);
      applyGeneratedUpdate(candidate, bytes);
    }
    const receipts = [];
    const coveredSeq = await readGeneratedTail(state, tailAfterSeq, baseline.walHead, async (row, update) => {
      applyGeneratedUpdate(candidate, update);
      if (appendRecordForCloudRow(state, row, update).record) receipts.push(row);
    }, baselineBytes, conditional ? assertConditionalReadLive : assertStateWritable);
    if (conditional) assertConditionalReadLive(state);
    requireCompleteGeneratedState(candidate);
    const update = encodeSnapshot(candidate);
    if (update.byteLength > GENERATED_STATE_BYTES) throw generatedStateError('ANNOTATION_GENERATION_LIMIT');
    const nextConditionalCheckpoint = conditional == null ? null : Object.freeze({
      // `update` is the detached candidate's private encoded result. Yjs only
      // reads it during install, so this prefix can own the same array.
      update,
      coveredSeq,
      identity: Object.freeze({ ...conditional.snapshotIdentity }),
    });
    return { update, coveredSeq, baseAtSeq,
      baseWriterId: conditional ? identity.writerId : (snap?.writer_id ?? null),
      baseWriterEpoch: sequence(conditional ? identity.writerEpoch : (snap?.writer_epoch ?? 0)),
      receipts, nextConditionalCheckpoint };
  } finally { candidate.destroy(); }
}

async function readGeneratedDelta(state) {
  const candidate = createDetachedYDoc(`generation-tail:${state.registryKey}:${randomClientId()}`);
  try {
    const accepted = encodeSnapshot(state.acceptedDoc);
    if (accepted.byteLength > GENERATED_STATE_BYTES) throw generatedStateError('ANNOTATION_GENERATION_LIMIT');
    applyGeneratedUpdate(candidate, accepted);
    const rows = [];
    const coveredSeq = await readGeneratedTail(state, state.coveredSeq, null, (row, update) => {
      applyGeneratedUpdate(candidate, update);
      rows.push(row);
    }, accepted.byteLength);
    requireCompleteGeneratedState(candidate);
    return { rows, coveredSeq };
  } finally { candidate.destroy(); }
}

function applyAuthoritativeCloudUpdate(state, update) {
  // A committed row can be an idempotent self-echo in the optimistic live doc,
  // so its live update event may not fire. Cloud acceptance must still advance
  // every clean shadow explicitly.
  Y.applyUpdate(state.doc, update, REMOTE_ORIGIN);
  Y.applyUpdate(state.acceptedDoc, update, HYDRATE_ORIGIN);
  if (state.localPersistenceDoc) {
    Y.applyUpdate(state.localPersistenceDoc, update, HYDRATE_ORIGIN);
  }
  Y.applyUpdate(state.stagedDoc, update, HYDRATE_ORIGIN);
}

function bytesEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function updateClockRanges(update) {
  const ranges = new Map();
  for (const struct of Y.decodeUpdate(update).structs) {
    const client = Number(struct.id?.client);
    const start = Number(struct.id?.clock);
    const end = start + Number(struct.length || 0);
    if (!Number.isFinite(client) || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const existing = ranges.get(client);
    ranges.set(client, existing
      ? { start: Math.min(existing.start, start), end: Math.max(existing.end, end) }
      : { start, end });
  }
  return ranges;
}

function recordCoveringClock(records, client, clock, excludeKey) {
  for (const candidate of records) {
    if (candidate.key === excludeKey) continue;
    const range = updateClockRanges(candidate.update).get(client);
    if (range && range.start <= clock && clock < range.end) return candidate.key;
  }
  return null;
}

function causalDependenciesForUpdate(state, update, excludeKey = null) {
  const dependencies = new Set();
  const acceptedVector = Y.decodeStateVector(Y.encodeStateVector(state.acceptedDoc));
  const records = [...state.appendRecords.values()];
  const decoded = Y.decodeUpdate(update);
  for (const [client, range] of updateClockRanges(update)) {
    const acceptedClock = Number(acceptedVector.get(client)) || 0;
    if (range.start > acceptedClock) {
      const dependency = recordCoveringClock(
        records,
        client,
        range.start - 1,
        excludeKey,
      );
      if (dependency) dependencies.add(dependency);
    }
  }
  for (const struct of decoded.structs) {
    for (const reference of [struct.origin, struct.rightOrigin, struct.parent]) {
      const client = Number(reference?.client);
      const clock = Number(reference?.clock);
      if (!Number.isFinite(client) || !Number.isFinite(clock)) continue;
      const acceptedClock = Number(acceptedVector.get(client)) || 0;
      if (clock < acceptedClock) continue;
      const dependency = recordCoveringClock(records, client, clock, excludeKey);
      if (dependency) dependencies.add(dependency);
    }
  }
  return [...dependencies].sort();
}

function rejectedRecordClosure(state, rejectedKeys) {
  const rejected = new Set(rejectedKeys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of state.appendRecords.values()) {
      if (rejected.has(record.key)) continue;
      if ((record.dependsOn || []).some((key) => rejected.has(key))) {
        rejected.add(record.key);
        changed = true;
      }
    }
  }
  return rejected;
}

function unresolvedDependencyForRecord(state, record) {
  for (const key of record.dependsOn || []) {
    const dependency = state.appendRecords.get(key);
    if (dependency) return dependency;
    if (!state.acceptedReceiptKeys.has(key)) {
      return { key, status: 'missing' };
    }
  }
  return null;
}

async function quarantineRejectedRecords(
  state,
  rejectedKeys,
  error,
  { terminalStatus = 'rejected' } = {},
) {
  // This can run during replay, after the open-time quarantine sample. Flip the
  // live state immediately so actorless legacy storage cannot be re-enqueued
  // again later in the same open under a fresh writer id.
  state.quarantinedLocalHistory = true;
  const cutoffKeys = state.permissionRejectedCutoff > 0
    ? [...state.appendRecords.values()]
      .filter((record) => (Number(record.ordinal) || 0) <= state.permissionRejectedCutoff)
      .map((record) => record.key)
    : [];
  const closure = rejectedRecordClosure(
    state,
    [...new Set([...rejectedKeys, ...cutoffKeys])],
  );
  const keys = [...closure];
  const records = keys
    .map((key) => state.appendRecords.get(key))
    .filter(Boolean);
  const historyTags = records
    .map((record) => record.historyTag)
    .filter((tag) => tag?.mutationId);
  const mutationIds = historyTags.map((tag) => tag.mutationId);
  const requiresFullHistoryReset = (
    records.length !== keys.length
    || records.some((record) => !record.historyTag?.mutationId)
  );
  // Visible rollback must not depend on IndexedDB cleanup succeeding.
  restoreAcceptedState(state, {
    reason: terminalStatus === 'integrity-error'
      ? 'wal-integrity-collision'
      : 'permission-denied',
    code: error?.code || (terminalStatus === 'integrity-error' ? '23505' : '42501'),
    mutationIds,
    requiresFullHistoryReset,
    evidenceKeys: keys,
  });
  if (terminalStatus === 'integrity-error') {
    const rootKeys = new Set(rejectedKeys);
    for (const key of keys) {
      const record = state.appendRecords.get(key);
      if (!record) continue;
      record.status = rootKeys.has(key) ? 'integrity-error' : 'dependency-error';
      await persistOutboxRecord(state, record).catch((cleanupError) => {
        console.warn('[annotationDocSync] integrity quarantine persistence failed', cleanupError?.message);
      });
    }
    try {
      await rotateCleanPersistence(state);
    } catch (cleanupError) {
      console.warn('[annotationDocSync] integrity persistence rotation failed', cleanupError?.message);
    }
    markSyncHealth(state, false, error);
    return;
  }
  for (const key of keys) {
    const record = state.appendRecords.get(key);
    if (record) record.status = terminalStatus;
  }
  let cleanupFailed = false;
  try {
    await state.outbox?.markRejected?.(keys, state.documentIncarnation);
  } catch (cleanupError) {
    cleanupFailed = true;
    console.warn('[annotationDocSync] rejected outbox quarantine failed', cleanupError?.message);
  }
  let deleted = false;
  try {
    if (typeof state.outbox?.deleteMany === 'function') {
      await state.outbox.deleteMany(keys, state.documentIncarnation);
    } else {
      await Promise.all(keys.map(
        (key) => state.outbox?.delete(key, state.documentIncarnation),
      ));
    }
    deleted = true;
  } catch (cleanupError) {
    cleanupFailed = true;
    console.warn('[annotationDocSync] denied outbox deletion failed', cleanupError?.message);
  }
  if (deleted) {
    for (const key of keys) state.appendRecords.delete(key);
  }
  try {
    await rotateCleanPersistence(state);
  } catch (cleanupError) {
    cleanupFailed = true;
    console.warn('[annotationDocSync] denied outbox cleanup failed', cleanupError?.message);
  }
  if (cleanupFailed) {
    // Keep the handle visibly unhealthy. If both quarantine and deletion failed,
    // the residual row cannot be proven safe across a process restart.
    state.lastSyncError = error;
  }
  markSyncHealth(state, false, error);
}

function appendRecordForCloudRow(state, row, update) {
  const actorUserId = row?.actor_user_id == null ? null : String(row.actor_user_id);
  const writerId = row?.client_id == null ? null : String(row.client_id);
  const clientSeq = row?.client_seq == null ? null : String(row.client_seq);
  if (
    actorUserId !== String(state.actorUserId)
    || !writerId
    || !/^(0|[1-9][0-9]*)$/.test(clientSeq || '')
  ) return { record: null, collision: null };
  const record = [...state.appendRecords.values()].find((candidate) => (
    candidate.documentId === state.documentId
    && String(candidate.actorUserId) === actorUserId
    && candidate.writerId === writerId
    && String(candidate.clientSeq) === clientSeq
    && (candidate.pdfGenerationId ?? null) === state.pdfGenerationId
  ));
  if (!record) return { record: null, collision: null };
  if (!bytesEqual(record.update, update)) {
    const error = new Error('authoritative WAL receipt reused an idempotency key with different bytes');
    error.code = '23505';
    return { record, collision: error };
  }
  return { record, collision: null };
}

async function settleAcceptedRecord(
  state,
  record,
  update = record.update,
  { alreadyApplied = false } = {},
) {
  if (!record) return;
  if (state.acceptedReceiptKeys.has(record.key)) {
    // Snapshot coverage can accept this exact record while its WAL append is
    // still in flight. The later positive WAL sequence is extra receipt proof,
    // not a second acceptance: persist only that enrichment and repeat none of
    // the document, compaction, health, or erase-effect side effects below. A
    // WAL-first receipt may already have been compacted, so never re-settle a
    // sequence that this handle has proved durable.
    if (Object.hasOwn(record, 'seq')) {
      const incomingSequence = sequence(record.seq);
      const persistedSequence = state.persistedSequenceReceipts.get(record.key);
      if (persistedSequence === COMPACTED_RECEIPT_WITHOUT_SEQUENCE) {
        await state.outbox.settleAccepted({ ...record, status: 'accepted', seq: incomingSequence });
        state.persistedSequenceReceipts.set(record.key, incomingSequence);
        state.unresolvedReceiptConflicts.delete(record.key);
        markSyncHealth(state, true);
        return;
      }
      if (persistedSequence !== undefined && persistedSequence !== null) {
        if (compareSequence(persistedSequence, incomingSequence) !== 0) {
          throw Object.assign(new Error('A durable annotation receipt sequence cannot change.'),
            { code: 'ANNOTATION_OUTBOX_SCOPE_MISMATCH' });
        }
        if (state.unresolvedReceiptConflicts.has(record.key)
          && typeof state.outbox?.settleAccepted === 'function') {
          await state.outbox.settleAccepted({ ...record, status: 'accepted', seq: incomingSequence });
          state.unresolvedReceiptConflicts.delete(record.key);
          markSyncHealth(state, true);
        }
        return;
      }
      if (persistedSequence === null) return; // Compacted clean evidence has no per-row receipt left.
      if (typeof state.outbox?.settleAccepted === 'function') {
        await state.outbox.settleAccepted({ ...record, status: 'accepted', seq: incomingSequence });
        state.persistedSequenceReceipts.set(record.key, incomingSequence);
        state.unresolvedReceiptConflicts.delete(record.key);
        markSyncHealth(state, true);
      }
    }
    return;
  }
  if (!alreadyApplied) applyAuthoritativeCloudUpdate(state, update);
  const previousStatus = record.status;
  if (typeof state.outbox?.settleAccepted === 'function') {
    try {
      await state.outbox.settleAccepted({ ...record, status: 'accepted' });
    } catch (error) {
      record.status = previousStatus;
      throw error;
    }
  } else {
    await state.outbox?.delete(record.key, state.documentIncarnation);
  }
  record.status = 'accepted';
  state.acceptedReceiptKeys.add(record.key);
  if (Object.hasOwn(record, 'seq')) state.persistedSequenceReceipts.set(record.key, sequence(record.seq));
  state.appendRecords.delete(record.key);
  state.acceptedEditEpoch = Math.max(
    state.acceptedEditEpoch,
    Number(record.editEpoch) || 0,
  );
  try {
    await state.outbox?.compactAccepted(
      state.documentId,
      state.actorUserId,
      encodeSnapshot(state.acceptedDoc),
      false,
      state.documentIncarnation,
    );
  } catch (error) {
    // The exact accepted delta is already durable in the clean journal. A
    // failed compaction is non-destructive and will be retried later.
    console.warn('[annotationDocSync] accepted cache compaction failed', error?.message);
  }
  if (state.appendRecords.size === 0 && state.durabilityGap) {
    state.durabilityGap = false;
    clearGapRepairTimer(state);
    clearRepairCheckpoint(state);
  }
  if (!state.durabilityGap && state.appendRecords.size === 0) {
    if (state.outboxReplayTimer) {
      clearTimeout(state.outboxReplayTimer);
      state.outboxReplayTimer = null;
    }
    clearEraseOutboxRetry(state);
    state.outboxReplayRetryAttempt = 0;
    markSyncHealth(state, true);
  }
  // Core acceptance is the authorization boundary for irreversible erase
  // effects. Wake the worker from every receipt path, including snapshot
  // coverage and Realtime—not only the direct append caller.
  void queueEraseOutboxDrain(state);
  if (state.appendRecords.size > 0) scheduleOutboxReplay(state);
}

function snapshotSemanticallyCoversUpdate(snapshotUpdate, update) {
  const before = createDetachedYDoc(`coverage-before:${randomClientId()}`);
  const after = createDetachedYDoc(`coverage-after:${randomClientId()}`);
  try {
    Y.applyUpdate(before, snapshotUpdate, HYDRATE_ORIGIN);
    Y.applyUpdate(after, snapshotUpdate, HYDRATE_ORIGIN);
    Y.applyUpdate(after, update, HYDRATE_ORIGIN);
    return durableDocsEqual(before, after);
  } finally {
    try { before.destroy(); } catch { /* */ }
    try { after.destroy(); } catch { /* */ }
  }
}

async function settleSnapshotCoveredRecords(state, snapshotUpdate, epochAtStart) {
  if (!snapshotUpdate || state.appendRecords.size === 0) return;
  const snapshotVector = Y.encodeStateVectorFromUpdate(snapshotUpdate);
  const records = [...state.appendRecords.values()]
    .filter((record) => (
      (Number(record.editEpoch) || 0) <= (Number(epochAtStart) || 0)
    ))
    .sort((left, right) => (
      (left.ordinal || 0) - (right.ordinal || 0)
      || String(left.key).localeCompare(String(right.key))
    ));
  for (const record of records) {
    const missing = Y.diffUpdate(record.update, snapshotVector);
    if (Y.decodeUpdate(missing).structs.length > 0) continue;
    if (!snapshotSemanticallyCoversUpdate(snapshotUpdate, record.update)) continue;
    await settleAcceptedRecord(state, record, record.update, { alreadyApplied: true });
  }
}

async function applyAuthoritativeCloudRow(state, row) {
  assertStateWritable(state);
  const update = pgHexToBytes(row.data);
  applyAuthoritativeCloudUpdate(state, update);
  const { record, collision } = appendRecordForCloudRow(state, row, update);
  if (collision && record) {
    state.permissionRejectedCutoff = state.localMutationOrdinal;
    await quarantineRejectedRecords(
      state,
      [record.key],
      collision,
      { terminalStatus: 'integrity-error' },
    );
    return update;
  }
  if (record) {
    if (state.generationTransport) record.seq = sequence(row.seq);
    await settleAcceptedRecord(state, record, update, { alreadyApplied: true });
  }
  return update;
}

async function hydrateCleanAcceptedState(state) {
  const clean = await state.outbox?.loadCleanState?.(
    state.documentId,
    state.actorUserId,
  );
  const updates = [
    clean?.checkpointUpdate,
    ...(clean?.records || []).map((record) => record.update),
  ].filter(Boolean).map((update) => new Uint8Array(update));
  for (const key of clean?.acceptedKeys || []) state.acceptedReceiptKeys.add(key);
  for (const record of clean?.records || []) {
    state.acceptedReceiptKeys.add(record.key);
    if (Object.hasOwn(record, 'seq')) state.persistedSequenceReceipts.set(record.key, sequence(record.seq));
  }
  const proofByKey = new Map((clean?.acceptedReceiptProofs || []).map(proof => [proof.key, proof]));
  for (const key of clean?.acceptedKeys || []) {
    const proof = proofByKey.get(key);
    state.persistedSequenceReceipts.set(key, !proof ? null
      : proof.seq === null ? COMPACTED_RECEIPT_WITHOUT_SEQUENCE : sequence(proof.seq));
  }
  for (const conflict of clean?.acceptedReceiptConflicts || []) {
    state.unresolvedReceiptConflicts.add(conflict.key);
  }
  for (const update of updates) {
    Y.applyUpdate(state.doc, update, HYDRATE_ORIGIN);
    Y.applyUpdate(state.acceptedDoc, update, HYDRATE_ORIGIN);
    Y.applyUpdate(state.stagedDoc, update, HYDRATE_ORIGIN);
  }
  if (state.unresolvedReceiptConflicts.size > 0) {
    markSyncHealth(state, false, new Error(
      'A saved annotation receipt has an unresolved server conflict.',
    ));
  }
}

async function loadPendingOutboxRecords(state) {
  const records = await (
    state.outbox?.list(state.documentId, state.actorUserId) ?? []
  );
  for (const rawRecord of records) {
    const record = {
      ...rawRecord,
      update: new Uint8Array(rawRecord.update),
      checkpointUpdate: rawRecord.checkpointUpdate
        ? new Uint8Array(rawRecord.checkpointUpdate)
        : null,
    };
    if (
      record.status === 'rejected'
      || record.status === 'integrity-error'
      || record.status === 'dependency-error'
    ) {
      // Terminal pending evidence is itself a quarantine boundary. It can
      // survive a crash before a rejected record is copied to the dedicated
      // quarantine store, and integrity/dependency failures never enter that
      // store at all. A cold open must not re-author detached local bytes while
      // any of those unresolved records remain.
      state.quarantinedLocalHistory = true;
      state.openHistoryQuarantineEvidenceKeys.add(record.key);
      state.appendRecords.set(record.key, record);
      markSyncHealth(
        state,
        false,
        new Error(record.status === 'rejected'
          ? 'a rejected local annotation update is quarantined'
          : 'an annotation idempotency collision requires repair'),
      );
      continue;
    }
    state.appendRecords.set(record.key, record);
    state.localMutationOrdinal = Math.max(
      state.localMutationOrdinal,
      Number(record.ordinal) || 0,
    );
    if (record.writerId === state.writerId) {
      state.clientSeq = Math.max(state.clientSeq, Number(record.clientSeq) || 0);
    }
  }
  for (const record of state.appendRecords.values()) {
    if (!Array.isArray(record.dependsOn)) {
      record.dependsOn = causalDependenciesForUpdate(state, record.update, record.key);
    }
  }
}

async function loadFromBackend(state) {
  const { supabase, documentId, doc } = state;
  if (state.generationTransport) {
    // The checked bundle authorizes the immutable PDF and fixes this handle's
    // actor, generation and content model. Its annotation bytes can age while
    // local storage opens, including when a newer snapshot keeps the same WAL
    // head. Pair a fresh snapshot with the tail fixed to that response.
    const checkpoint = await readGeneratedCheckpoint(state);
    assertStateWritable(state);
    applyAuthoritativeCloudUpdate(state, checkpoint.update);
    state.lastSeq = maxAnnotationSequence(state.lastSeq, checkpoint.coveredSeq);
    state.coveredSeq = maxAnnotationSequence(state.coveredSeq, checkpoint.coveredSeq);
    state.replayFromSeq = checkpoint.baseAtSeq ?? 0;
    state.snapshotBaseAtSeq = checkpoint.baseAtSeq;
    state.snapshotBaseWriterId = checkpoint.baseWriterId;
    state.snapshotBaseWriterEpoch = checkpoint.baseWriterEpoch;
    state.snapshotGeneration = maxAnnotationSequence(state.snapshotGeneration, checkpoint.baseWriterEpoch);
    for (const row of checkpoint.receipts) {
      if (checkpoint.nextConditionalCheckpoint) assertConditionalReadLive(state);
      await applyAuthoritativeCloudRow(state, row);
      if (checkpoint.nextConditionalCheckpoint) assertConditionalReadLive(state);
    }
    await state.outbox.compactAccepted(documentId, state.actorUserId, encodeSnapshot(state.acceptedDoc), true, state.documentIncarnation);
    if (checkpoint.nextConditionalCheckpoint) {
      assertConditionalReadLive(state);
      state.conditionalCheckpointPrefix = checkpoint.nextConditionalCheckpoint;
    }
    return;
  }
  // 1. snapshot baseline
  const { data: snapRow, error: snapshotError } = await withActorRequest(
    state,
    () => supabase
      .from('annotation_snapshots')
      .select('snapshot, at_seq, encoding_version, writer_id, writer_epoch')
      .eq('document_id', documentId)
      .maybeSingle(),
    'snapshot read',
  );
  if (snapshotError) throw toSyncError(snapshotError, 'snapshot read failed');
  if (snapRow && snapRow.snapshot) {
    let bytes = pgHexToBytes(snapRow.snapshot);
    if (snapRow.encoding_version === SNAPSHOT_ENC_GZIP) {
      try {
        bytes = await gunzip(bytes);
      } catch (err) {
        throw new Error(`snapshot decode failed: ${err?.message || 'invalid gzip'}`, { cause: err });
      }
    }
    if (bytes) {
      try {
        Y.applyUpdate(doc, bytes, HYDRATE_ORIGIN);
        Y.applyUpdate(state.acceptedDoc, bytes, HYDRATE_ORIGIN);
        if (state.localPersistenceDoc) {
          Y.applyUpdate(state.localPersistenceDoc, bytes, HYDRATE_ORIGIN);
        }
      } catch (err) {
        throw new Error(`snapshot decode failed: ${err?.message || 'invalid Yjs update'}`, { cause: err });
      }
      state.lastSeq = sequence(snapRow.at_seq ?? 0);
      state.replayFromSeq = state.lastSeq;
      state.snapshotBaseAtSeq = state.lastSeq;
      state.snapshotBaseWriterId = snapRow.writer_id ?? null;
      state.snapshotBaseWriterEpoch = sequence(snapRow.writer_epoch ?? 0);
      state.snapshotGeneration = maxAnnotationSequence(
        state.snapshotGeneration,
        state.snapshotBaseWriterEpoch,
      );
    }
  }
  // 2. tail ops after the snapshot, in order
  let cursor = state.lastSeq;
  for (;;) {
    const { data: rows, error } = await withActorRequest(
      state,
      () => supabase
        .from('annotation_updates')
        .select('seq, data, client_id, client_seq, actor_user_id')
        .eq('document_id', documentId)
        .gt('seq', cursor)
        .order('seq', { ascending: true })
        .limit(1000),
      'annotation tail read',
    );
    if (error) throw new Error(`tail read: ${error.message}`);
    const batch = rows || [];
    for (const row of batch) {
      await applyAuthoritativeCloudRow(state, row);
      cursor = sequence(row.seq);
    }
    state.lastSeq = cursor;
    if (batch.length < 1000) break;
  }
  state.coveredSeq = cursor;
  // One acknowledged custom IndexedDB transaction is the clean-cache receipt.
  // y-indexeddb's update observer is fire-and-forget and cannot authorize
  // deleting an outbox record or claiming crash durability by call order.
  await state.outbox?.compactAccepted?.(
    state.documentId,
    state.actorUserId,
    encodeSnapshot(state.acceptedDoc),
    true,
    state.documentIncarnation,
  );
}

// Close the hydrate-vs-subscribe gap: Postgres realtime only forwards rows
// inserted AFTER the channel is live, so an op another device commits between
// our tail read and the SUBSCRIBED confirmation would otherwise stay invisible
// until the next full reopen. Whenever the channel (re)confirms SUBSCRIBED we
// re-read the log from the accepted snapshot baseline. Y.applyUpdate is
// idempotent, so the intentional overlap with prior catch-up/realtime delivery
// is harmless and a late lower sequence remains discoverable.
function catchUpGenerated(state, refresh = false) {
  if (state.destroyed || state.generationBlocked) return Promise.resolve(false);
  state.generationCatchupRequested = true;
  state.generationRefreshRequested ||= refresh;
  if (state.generationCatchup) return state.generationCatchup;
  const task = state.catchupChain.then(async () => {
    const realtimeGeneration = state.realtimeCatchupGeneration;
    while (state.generationCatchupRequested) {
      if (state.destroyed || state.generationBlocked) return false;
      const needsRefresh = state.generationRefreshRequested;
      state.generationCatchupRequested = false;
      state.generationRefreshRequested = false;
      if (needsRefresh) {
        // Merge checked cloud state; never replace the optimistic document or
        // discard pending local rows when a same-head snapshot changes.
        await loadFromBackend(state);
      } else {
        // Unlike legacy identity sequences, private generation WAL allocation
        // is serialized by the document lock: a covered prefix cannot gain a
        // late lower row. Own appends only advance this prefix by one.
        // Stage the whole fixed frontier before changing the live/accepted
        // documents or settling journal receipts. A later bad page or missing
        // Yjs dependency must not publish an earlier partial result.
        const checked = await readGeneratedDelta(state);
        assertStateWritable(state);
        for (const row of checked.rows) await applyAuthoritativeCloudRow(state, row);
        state.lastSeq = maxAnnotationSequence(state.lastSeq, checked.coveredSeq);
        state.coveredSeq = maxAnnotationSequence(state.coveredSeq, checked.coveredSeq);
      }
      assertStateWritable(state);
      notifyChange(state);
      void queueEraseOutboxDrain(state);
    }
    state.generationCatchupError = null;
    if (realtimeGeneration === state.realtimeCatchupGeneration
      && state.realtimePhase === 'ready' && !state.durabilityGap
      && !state.repairCheckpointUpdate && !state.quarantinedLocalHistory) {
      markSyncHealth(state, true);
    }
    return true;
  }).catch(error => {
    if ((state.closePromise || state.destroyed) && error?.code === 'ANNOTATION_HANDLE_CLOSED') {
      return false;
    }
    state.generationCatchupError = error;
    state.generationLastSignal = null; // a duplicate notice may retry a failed read
    state.generationCatchupRequested = false;
    state.generationRefreshRequested = false;
    markSyncHealth(state, false, error);
    console.warn('[annotationDocSync] generation catch-up failed', error?.message);
    return false;
  }).finally(() => {
    state.generationCatchup = null;
    // A hint can arrive after the loop resolves but before this promise's
    // finally runs. Keep that last request rather than losing its wake-up.
    if (state.generationCatchupRequested) void catchUpGenerated(state, state.generationRefreshRequested);
  });
  state.generationCatchup = task;
  state.catchupChain = task;
  return task;
}

function handleGenerationSignal(state, payload) {
  if (state.destroyed || state.generationBlocked) return;
  const row = payload?.new;
  let hint;
  try {
    if (row?.document_id !== state.documentId || row?.generation_id !== state.pdfGenerationId) {
      throw new Error('changed or missing generation');
    }
    if (state.contentModelProtocolModern
      ? row.content_model_version !== state.contentModelVersion
      : row.content_model_version != null && row.content_model_version !== 1) {
      throw new Error('changed or missing content model');
    }
    hint = { head: sequence(row.last_seq), wake: sequence(row.wake_revision),
      epoch: sequence(row.snapshot_writer_epoch) };
  } catch {
    // Hints select a read strategy only. Missing, unsafe JS integers, DELETE,
    // or another generation always require a complete checked refresh.
    void catchUpGenerated(state, true);
    return;
  }
  const prior = state.generationLastSignal;
  if (prior && compareSequence(prior.head, hint.head) === 0
    && compareSequence(prior.wake, hint.wake) === 0
    && compareSequence(prior.epoch, hint.epoch) === 0) return;
  state.generationLastSignal = hint;
  const refresh = compareSequence(hint.epoch, state.snapshotBaseWriterEpoch) !== 0;
  // A checked prefix and snapshot already cover this hint. In particular, an
  // echo of our own append needs neither another tail nor a full checkpoint.
  if (!refresh && compareSequence(hint.head, state.coveredSeq) <= 0) return;
  void catchUpGenerated(state, refresh);
}

function catchUpTail(state, { refresh = false } = {}) {
  if (state.generationTransport) return catchUpGenerated(state, refresh);
  state.catchupChain = state.catchupChain.then(async () => {
    if (state.destroyed || state.generationBlocked || !state.supabase) return false;
    // PostgreSQL identity values are allocated before commit. A transaction
    // with seq=N can legally become visible after seq=N+1. Replaying from the
    // last accepted snapshot (rather than the last observed row) makes the
    // lower late commit visible on the next sweep; Yjs makes overlap free.
    let cursor = state.replayFromSeq;
    let applied = 0;
    for (;;) {
      let response;
      try {
        response = await withActorRequest(
          state,
          () => state.supabase
            .from('annotation_updates')
            .select('seq, data, client_id, client_seq, actor_user_id')
            .eq('document_id', state.documentId)
            .gt('seq', cursor)
            .order('seq', { ascending: true })
            .limit(1000),
          'realtime catch-up read',
        );
      } catch (error) {
        console.warn('[annotationDocSync] post-subscribe catch-up read failed', error.message);
        return false;
      }
      const { data: rows, error } = response;
      if (error) {
        console.warn('[annotationDocSync] post-subscribe catch-up read failed', error.message);
        return false; // coveredSeq untouched — the next SUBSCRIBED retries from here
      }
      const batch = rows || [];
      for (const row of batch) {
        if (state.destroyed) return false; // handle torn down mid-sweep — stop touching the doc
        try {
          // clientId is stable per install, not per open handle. Another tab or
          // a handle still tearing down can therefore author a row with OUR
          // clientId that this doc has never seen. Always apply; Yjs makes an
          // actual self-echo idempotent.
          await applyAuthoritativeCloudRow(state, row);
          applied += 1;
        } catch (err) {
          // Do NOT advance past bytes that never made it into the doc: cursor
          // stays on the last good row, so this seq is retried on the next
          // SUBSCRIBED instead of being permanently marked covered (and a
          // snapshot's at_seq can never over-claim it).
          console.warn('[annotationDocSync] catch-up apply failed — will retry from seq', cursor, err?.message);
          if (compareSequence(cursor, state.lastSeq) > 0) state.lastSeq = cursor;
          state.coveredSeq = cursor;
          if (applied > 0) notifyChange(state);
          return false;
        }
        cursor = sequence(row.seq);
      }
      if (compareSequence(cursor, state.lastSeq) > 0) state.lastSeq = cursor;
      state.coveredSeq = cursor;
      if (batch.length < 1000) break;
    }
    if (applied > 0 && !state.destroyed) notifyChange(state);
    if (applied > 0 && !state.destroyed) void queueEraseOutboxDrain(state);
    return true;
  }).catch((err) => {
    console.warn('[annotationDocSync] catch-up failed', err?.message);
    return false;
  });
  return state.catchupChain;
}

function currentSyncStatus(state) {
  const queueSize = Math.max(
    0,
    Number(state.pendingAppends) || 0,
    state.appendRecords?.size || 0,
  );
  return {
    healthy: state.syncHealthy,
    error: state.syncHealthy ? null : state.lastSyncError,
    stage: state.syncHealthy
      ? (
        queueSize > 0
          ? 'pending'
          : (state.realtimePhase === 'ready' ? 'idle' : 'hydrating')
      )
      : 'error',
    queueSize,
  };
}

function captureNotReady(reason) {
  const error = new Error(`Accepted annotation capture is not ready: ${reason}`);
  error.code = 'ANNOTATION_CAPTURE_NOT_READY';
  return error;
}

function assertAcceptedCaptureReady(state) {
  assertHandleWritable(state);
  if (!state.supabase || !state.syncHealthy || state.realtimePhase !== 'ready'
    || state.durabilityGap || state.repairCheckpointUpdate
    || state.pendingAppends > 0 || state.appendRecords.size > 0
    || state.outboxReplayScheduled || state.localWriteTasks.size > 0
    || state.legacyRecoveryPending || state.legacyUnresolvedEntries > 0
    || state.quarantinedLocalHistory || state.openHistoryQuarantineEvidenceKeys.size > 0
    || state.editEpoch > state.acceptedEditEpoch) {
    throw captureNotReady('sync or recovery work remains');
  }
}

async function assertAcceptedCaptureActor(state) {
  if (typeof state.supabase?.auth?.getSession !== 'function') {
    throw captureNotReady('an authenticated cloud handle is required');
  }
  const { data, error } = await withCloudRequest(
    state, state.supabase.auth.getSession(), 'accepted capture session',
  );
  assertHandleWritable(state);
  if (error || data?.session?.user?.id !== state.actorUserId || !data?.session?.access_token) {
    const mismatch = new Error('Accepted annotation capture requires its original signed-in user');
    mismatch.code = 'ANNOTATION_ACTOR_MISMATCH';
    throw mismatch;
  }
}

// Input comes only from the strict, JSON-only materializer. Sorting keys lets
// two equivalent Yjs histories compare without relying on their insertion order.
function acceptedCaptureJson(value) {
  if (Array.isArray(value)) return `[${value.map(acceptedCaptureJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${acceptedCaptureJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Local preflight ONLY. This is neither a server CAS receipt nor a complete
 * document checkpoint: PDF bytes, legacy SQL, items and sidecars are excluded.
 * Future publication must atomically compare its server-owned generation/head
 * and all other source tokens; even a fresh tail sweep can miss a later commit.
 * No current save path uses this seam or activates PDF generations. */
async function captureAcceptedAnnotationState(state) {
  assertAcceptedCaptureReady(state);
  if (typeof state.supabase.auth?.onAuthStateChange !== 'function') {
    throw captureNotReady('account changes must be observable during capture');
  }
  let actorChanged = false;
  const { data } = state.supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user?.id !== state.actorUserId || !session?.access_token) actorChanged = true;
  });
  const subscription = data?.subscription;
  if (typeof subscription?.unsubscribe !== 'function') {
    throw captureNotReady('account change subscription is unavailable');
  }
  try {
    return await captureAcceptedAnnotationStateForActor(state, () => {
      if (actorChanged) {
        const error = new Error('The signed-in account changed during annotation capture');
        error.code = 'ANNOTATION_ACTOR_MISMATCH';
        throw error;
      }
    });
  } finally {
    subscription.unsubscribe();
  }
}

async function captureAcceptedAnnotationStateForActor(state, assertActorUnchanged) {
  await assertAcceptedCaptureActor(state);
  const snapshotChain = state.snapshotChain;
  await snapshotChain;
  assertAcceptedCaptureReady(state);
  const caughtUp = await catchUpTail(state);
  assertHandleWritable(state);
  // withActorRequest pins the read's JWT, not the user's later active session.
  // Recheck after every cloud phase before exposing a captured result.
  await assertAcceptedCaptureActor(state);
  if (!caughtUp) throw captureNotReady('ordered cloud catch-up failed');
  const authoritativeChain = state.authoritativeChain;
  await authoritativeChain;
  await assertAcceptedCaptureActor(state);
  // Last async read: deletion OR retirement during a prior session check must
  // invalidate this legacy-scope capture. The auth listener fences account
  // changes during the atomic local scope/incarnation check. Generated sync
  // handles are not enabled yet; never infer a PDF generation from a local one.
  if (typeof state.outbox?.assertScopeCurrent !== 'function') {
    throw captureNotReady('the current local scope cannot be checked');
  }
  await state.outbox.assertScopeCurrent(state.documentId, state.actorUserId, state.documentIncarnation);
  assertActorUnchanged();
  assertAcceptedCaptureReady(state);
  if (snapshotChain !== state.snapshotChain || authoritativeChain !== state.authoritativeChain
    || state.lastSeq !== state.coveredSeq) {
    throw captureNotReady('the accepted head changed during capture');
  }
  for (const value of [state.coveredSeq, state.snapshotBaseAtSeq ?? 0, state.snapshotBaseWriterEpoch]) sequence(value);
  const annotationState = materializeAnnotationGenerationState(state.acceptedDoc, state.contentModelVersion);
  const liveState = materializeAnnotationGenerationState(state.doc, state.contentModelVersion);
  if (acceptedCaptureJson(annotationState) !== acceptedCaptureJson(liveState)) {
    throw captureNotReady('visible state contains changes without accepted proof');
  }
  const capture = Object.freeze({
    version: 1,
    ...(state.pdfGenerationId == null ? {} : { pdfGenerationId: state.pdfGenerationId }),
    ...(state.contentModelVersion === 2 ? { contentModelVersion: 2 } : {}),
    documentId: state.documentId,
    actorUserId: state.actorUserId,
    writerId: state.writerId,
    documentIncarnation: state.documentIncarnation,
    coveredSeq: state.coveredSeq,
    snapshotBase: Object.freeze({ atSeq: state.snapshotBaseAtSeq,
      writerId: state.snapshotBaseWriterId, writerEpoch: state.snapshotBaseWriterEpoch }),
    annotationState,
  });
  ISSUED_ACCEPTED_CAPTURES.set(capture, {
    state,
    signature: acceptedCaptureJson(capture),
    localRevision: state.localReceiptRevision,
    snapshotGeneration: state.snapshotGeneration,
    // Plain objects inside Y.Map can be mutated without a Yjs event. Keep
    // private byte copies as well as semantic state; expose neither shadow doc.
    acceptedBytes: encodeSnapshot(state.acceptedDoc),
    liveBytes: encodeSnapshot(state.doc),
  });
  return capture;
}

async function revalidateAcceptedAnnotationCapture(state, capture) {
  const issued = capture && ISSUED_ACCEPTED_CAPTURES.get(capture);
  if (!issued || issued.state !== state) return false;
  try {
    const current = await captureAcceptedAnnotationState(state);
    const proof = ISSUED_ACCEPTED_CAPTURES.get(current);
    return issued.signature === proof.signature
      && issued.localRevision === proof.localRevision
      && issued.snapshotGeneration === proof.snapshotGeneration
      && bytesEqual(issued.acceptedBytes, proof.acceptedBytes)
      && bytesEqual(issued.liveBytes, proof.liveBytes);
  } catch {
    return false;
  }
}

function notifySyncStatus(state) {
  const status = currentSyncStatus(state);
  for (const cb of state.syncListeners) {
    try { cb(status); } catch (err) { console.warn('[annotationDocSync] sync listener threw', err?.message); }
  }
}

function emitHistoryQuarantine(state, details = {}) {
  state.historyQuarantineGeneration += 1;
  const dedupeKey = historyQuarantineDedupeKey(state, details.evidenceKeys)
    || [
      state.documentId,
      state.actorUserId,
      state.documentIncarnation,
      state.writerId,
      `generation:${state.historyQuarantineGeneration}`,
    ].join('\u0001');
  const event = Object.freeze({
    documentId: state.documentId,
    documentIncarnation: state.documentIncarnation,
    generation: state.historyQuarantineGeneration,
    reason: details.reason || 'authoritative-rollback',
    code: details.code == null ? null : String(details.code),
    mutationIds: Object.freeze(
      [...new Set((details.mutationIds || []).map(String).filter(Boolean))],
    ),
    requiresFullHistoryReset: details.requiresFullHistoryReset !== false,
    dedupeKey,
  });
  state.lastHistoryQuarantineEvent = event;
  for (const cb of state.historyQuarantineListeners) {
    try {
      cb(event);
    } catch (error) {
      console.warn('[annotationDocSync] history quarantine listener threw', error?.message);
    }
  }
  return event;
}

function subscribeHistoryQuarantine(state, cb) {
  state.historyQuarantineListeners.add(cb);
  const event = state.lastHistoryQuarantineEvent;
  if (event) {
    try {
      cb(event);
    } catch (error) {
      console.warn(
        '[annotationDocSync] history quarantine listener threw',
        error?.message,
      );
    }
  }
  return () => state.historyQuarantineListeners.delete(cb);
}

// Notify sync-health listeners when the durable-append path flips between
// healthy and failing, deduped so we only emit on an actual transition (BL-24).
function markSyncHealth(state, healthy, error) {
  if (state.generationBlocked) { healthy = false; error = state.generationError; }
  if (healthy && state.generationCatchupError) {
    healthy = false;
    error = state.generationCatchupError;
  }
  if (healthy && state.generationTransport && state.realtimePhase !== 'ready') {
    // A late own receipt proves persistence, not a live subscription. Only the
    // checked SUBSCRIBED catch-up may restore the realtime lifecycle to ready.
    healthy = false;
    error = state.lastSyncError || new Error('realtime connection is not ready');
  }
  if (healthy && state.appendRecords?.size > 0) healthy = false;
  if (healthy && state.unresolvedReceiptConflicts?.size > 0) {
    healthy = false;
    error = state.lastSyncError || new Error(
      'A saved annotation receipt has an unresolved server conflict.',
    );
  }
  const changed = state.syncHealthy !== healthy;
  state.syncHealthy = healthy;
  state.lastSyncError = healthy ? null : (error?.message || String(error || 'sync failed'));
  if (changed) notifySyncStatus(state);
}

function isPermissionDenied(error) {
  return String(error?.code || '') === '42501'
    || /row.level security|permission denied|permission revoked/i.test(error?.message || '');
}

function toSyncError(error, fallback = 'sync failed') {
  if (error instanceof Error) return error;
  const normalized = new Error(error?.message || String(error || fallback));
  if (error?.code != null) normalized.code = error.code;
  return normalized;
}

function mapValueEqual(left, right) {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function durableDocsEqual(leftDoc, rightDoc) {
  for (const mapName of DURABLE_MAP_NAMES) {
    const left = leftDoc.getMap(mapName);
    const right = rightDoc.getMap(mapName);
    if (left.size !== right.size) return false;
    for (const [key, value] of left.entries()) {
      if (!right.has(key) || !mapValueEqual(value, right.get(key))) return false;
    }
  }
  return true;
}

function resetStagedToAccepted(state) {
  try { state.stagedDoc.destroy(); } catch { /* */ }
  state.stagedDoc = createDetachedYDoc(
    `staged:${state.documentId}:${state.writerId}:${state.localMutationOrdinal}`,
  );
  Y.applyUpdate(state.stagedDoc, encodeSnapshot(state.acceptedDoc), HYDRATE_ORIGIN);
}

function setRepairCheckpoint(state, checkpointUpdate, editEpoch) {
  state.repairCheckpointUpdate = new Uint8Array(checkpointUpdate);
  state.repairCheckpointEpoch = editEpoch || 0;
  state.repairCheckpointGeneration = state.durabilityGapGeneration;
}

function clearRepairCheckpoint(state) {
  state.repairCheckpointUpdate = null;
  state.repairCheckpointEpoch = 0;
  state.repairCheckpointGeneration = 0;
}

function clearGapRepairTimer(state) {
  if (state.repairTimer) clearTimeout(state.repairTimer);
  state.repairTimer = null;
  state.repairRetryAttempt = 0;
}

function scheduleGapRepair(state) {
  if (
    state.destroyed
    || state.generationBlocked
    || !state.durabilityGap
    || !state.repairCheckpointUpdate
    || state.repairTimer
  ) return;
  const baseDelay = Math.max(1, Number(state.repairRetryDelayMs) || GAP_REPAIR_RETRY_MS);
  const delayMs = Math.min(
    GAP_REPAIR_RETRY_MAX_MS,
    baseDelay * (2 ** Math.min(state.repairRetryAttempt, 5)),
  );
  state.repairRetryAttempt += 1;
  state.repairTimer = setTimeout(async () => {
    state.repairTimer = null;
    if (state.destroyed || !state.durabilityGap) return;
    if (state.pendingAppends > 0) {
      scheduleGapRepair(state);
      return;
    }
    const result = await writeSnapshot(state, captureSnapshotOptions(state)).catch((error) => ({
      ok: false,
      permissionDenied: isPermissionDenied(error),
      containsUnacceptedPrefix: true,
      error: toSyncError(error),
    }));
    await finalizeSnapshotResult(state, result);
    if (state.durabilityGap && !result?.permissionDenied) scheduleGapRepair(state);
  }, delayMs);
}

function encodeRepairCheckpoint(state) {
  if (
    !state.repairCheckpointUpdate
    || state.repairCheckpointGeneration !== state.durabilityGapGeneration
  ) return null;
  // The saved local prefix is immutable, while acceptedDoc may have gained
  // cloud rows during a reconnect catch-up. Merge only those two acknowledged
  // sources; stagedDoc can already contain later appends whose authorization is
  // still pending.
  const repairDoc = createDetachedYDoc(
    `repair:${state.documentId}:${state.writerId}:${state.durabilityGapGeneration}`,
  );
  try {
    Y.applyUpdate(repairDoc, encodeSnapshot(state.acceptedDoc), HYDRATE_ORIGIN);
    Y.applyUpdate(repairDoc, state.repairCheckpointUpdate, HYDRATE_ORIGIN);
    return encodeSnapshot(repairDoc);
  } finally {
    try { repairDoc.destroy(); } catch { /* */ }
  }
}

function captureSnapshotOptions(state) {
  if (state.durabilityGap) {
    return {
      snapshotUpdate: encodeRepairCheckpoint(state),
      epoch: state.repairCheckpointEpoch,
      repairsGap: true,
      gapGeneration: state.repairCheckpointGeneration,
    };
  }
  return {
    snapshotUpdate: encodeSnapshot(state.acceptedDoc),
    epoch: state.acceptedEditEpoch,
    repairsGap: false,
  };
}

// IndexedDB replay completes before the live observer is attached. Reconcile
// that persisted local state explicitly through the same staged WAL path: an
// authorized backend accepts it; 42501 rolls it back to cloud truth.
function stagePersistedLocalDifferences(state) {
  if (!state.persistedDoc) return null;
  const localOnly = Y.encodeStateAsUpdate(
    state.persistedDoc,
    Y.encodeStateVector(state.stagedDoc),
  );
  const decodedLocalOnly = Y.decodeUpdate(localOnly);
  if (
    decodedLocalOnly.structs.length === 0
    && decodedLocalOnly.ds.clients.size === 0
  ) return null;
  const probe = createDetachedYDoc(
    `persisted-probe:${state.documentId}:${state.writerId}:${randomClientId()}`,
  );
  Y.applyUpdate(probe, encodeSnapshot(state.stagedDoc), HYDRATE_ORIGIN);
  Y.applyUpdate(probe, localOnly, HYDRATE_ORIGIN);
  let hasRecoverableChange = false;
  for (const mapName of DURABLE_MAP_NAMES) {
    const staged = state.stagedDoc.getMap(mapName);
    const projected = probe.getMap(mapName);
    const keys = new Set([...staged.keys(), ...projected.keys()]);
    for (const key of keys) {
      const stagedHas = staged.has(key);
      const projectedHas = projected.has(key);
      if (
        stagedHas === projectedHas
        && (!stagedHas || mapValueEqual(staged.get(key), projected.get(key)))
      ) continue;
      hasRecoverableChange = true;
    }
  }
  if (!hasRecoverableChange) {
    try { probe.destroy(); } catch { /* */ }
    return null;
  }
  // The database name is actor-scoped, so additions, updates, and DeleteSet-
  // only deletions are trusted local intent. Preserve their exact Yjs lineage
  // and let the backend authorize or reject the mutation.
  Y.applyUpdate(state.stagedDoc, localOnly, HYDRATE_ORIGIN);
  try { probe.destroy(); } catch { /* */ }
  return {
    update: new Uint8Array(localOnly),
    snapshot: encodeSnapshot(state.stagedDoc),
  };
}

function stageExactLocalUpdate(state, update) {
  Y.applyUpdate(state.stagedDoc, update, HYDRATE_ORIGIN);
  const stagedUpdate = new Uint8Array(update);
  const decoded = Y.decodeUpdate(stagedUpdate);
  if (decoded.structs.length === 0 && decoded.ds.clients.size === 0) return null;
  return {
    update: stagedUpdate,
    snapshot: encodeSnapshot(state.stagedDoc),
  };
}

// A 42501 leaves rejected structs in the live Y.Doc history even after their
// visible values are compensated. Later exact updates to the same Y.Map key can
// point at that quarantined item and be unusable without it. For the remainder
// of that handle, rebase only the transaction's changed durable keys onto the
// clean staged cloud prefix. The persisted semantic probe prevents the rejected
// live lineage from being reuploaded on reopen.
function stageRebasedLocalMutation(state, transaction) {
  if (!transaction?.changed) return null;
  const before = Y.encodeStateVector(state.stagedDoc);
  state.stagedDoc.transact(() => {
    for (const mapName of DURABLE_MAP_NAMES) {
      const live = state.doc.getMap(mapName);
      const staged = state.stagedDoc.getMap(mapName);
      const changedKeys = transaction.changed.get(live);
      if (!changedKeys) continue;
      const keys = changedKeys.has(null)
        ? new Set([...live.keys(), ...staged.keys()])
        : changedKeys;
      for (const key of keys) {
        if (!live.has(key)) {
          if (staged.has(key)) staged.delete(key);
        } else if (!mapValueEqual(staged.get(key), live.get(key))) {
          staged.set(key, live.get(key));
        }
      }
    }
  }, HYDRATE_ORIGIN);
  const update = Y.encodeStateAsUpdate(state.stagedDoc, before);
  const decoded = Y.decodeUpdate(update);
  if (decoded.structs.length === 0 && decoded.ds.clients.size === 0) return null;
  return { update, snapshot: encodeSnapshot(state.stagedDoc) };
}

function reconcilePersistedLocalState(state) {
  if (state.destroyed || state.persistedReconciliationDone) return Promise.resolve();
  state.persistedReconciliationDone = true;
  if (state.quarantinedLocalHistory) {
    try { state.persistedDoc?.destroy(); } catch { /* */ }
    state.persistedDoc = null;
    publishAcceptedState(state);
    return Promise.resolve();
  }
  const persisted = stagePersistedLocalDifferences(state);
  try { state.persistedDoc?.destroy(); } catch { /* */ }
  state.persistedDoc = null;
  if (!persisted) {
    publishAcceptedAndVisiblePendingState(state);
    return Promise.resolve();
  }
  state.editEpoch += 1;
  const queued = enqueueAppend(state, persisted.update, persisted.snapshot, state.editEpoch);
  scheduleSnapshot(state);
  return queued.then(() => {
    if (state.appendRecords.size === 0 && !state.durabilityGap) {
      publishAcceptedState(state);
    }
  });
}

async function replayOutbox(state) {
  if (state.generationBlocked) return;
  const records = await (
    state.outbox?.list(state.documentId, state.actorUserId) ?? []
  );
  if (!records.length) return;
  for (const rawRecord of records) {
    const existingRecord = state.appendRecords.get(rawRecord.key);
    const record = {
      ...existingRecord,
      ...rawRecord,
      update: new Uint8Array(rawRecord.update),
      checkpointUpdate: existingRecord?.checkpointUpdate
        ? new Uint8Array(existingRecord.checkpointUpdate)
        : (rawRecord.checkpointUpdate
          ? new Uint8Array(rawRecord.checkpointUpdate)
          : null),
    };
    state.localMutationOrdinal = Math.max(state.localMutationOrdinal, record.ordinal || 0);
    if (record.writerId === state.writerId) {
      state.clientSeq = Math.max(state.clientSeq, record.clientSeq || 0);
    }
    state.appendRecords.set(record.key, record);
    if (
      record.status === 'rejected'
      || record.status === 'integrity-error'
      || record.status === 'dependency-error'
    ) {
      markSyncHealth(
        state,
        false,
        new Error(record.status === 'rejected'
          ? 'a rejected local annotation update is quarantined'
          : 'an annotation idempotency collision requires repair'),
      );
      continue;
    }
    const dependency = unresolvedDependencyForRecord(state, record);
    if (dependency) {
      const terminal = (
        dependency.status === 'integrity-error'
        || dependency.status === 'dependency-error'
        || dependency.status === 'rejected'
        || dependency.status === 'missing'
      );
      record.status = terminal ? 'dependency-error' : 'pending';
      await persistOutboxRecord(state, record).catch(() => {});
      markSyncHealth(
        state,
        false,
        new Error(`annotation update waits for unresolved record ${dependency.key}`),
      );
      continue;
    }
    if (!record.publishAfterAcceptance) {
      Y.applyUpdate(state.doc, record.update, HYDRATE_ORIGIN);
    }
    Y.applyUpdate(state.stagedDoc, record.update, HYDRATE_ORIGIN);
    if (!record.checkpointUpdate) record.checkpointUpdate = encodeSnapshot(state.stagedDoc);
    try {
      await appendOp(state, record);
    } catch (error) {
      if (state.generationBlocked || isGenerationFailure(error)) {
        await retireGenerationState(state, error.currentGenerationId ?? error.replacementGenerationId, error).catch(() => {});
        return;
      }
      if (String(error?.code || '') === '23505') {
        if (await preserveSnapshotAcceptedCollision(state, record)) {
          return { status: 'accepted-integrity-warning' };
        }
        state.permissionRejectedCutoff = state.localMutationOrdinal;
        await quarantineRejectedRecords(
          state,
          [record.key],
          error,
          { terminalStatus: 'integrity-error' },
        );
        return;
      }
      if (isPermissionDenied(error)) {
        state.permissionRejectedCutoff = state.localMutationOrdinal;
        await quarantineRejectedRecords(state, [record.key], error);
        return;
      }
      record.status = String(error?.code || '') === 'ETIMEDOUT' ? 'ambiguous' : 'pending';
      state.durabilityGap = true;
      state.durabilityGapGeneration += 1;
      setRepairCheckpoint(state, record.checkpointUpdate, record.editEpoch);
      markSyncHealth(state, false, error);
      await persistOutboxRecord(state, record).catch((persistError) => {
        console.warn('[annotationDocSync] replay status persistence failed', persistError?.message);
      });
      // Later records are causal dependents. Keep and render them, but do not
      // overtake the unresolved exact idempotency key.
      for (const laterRaw of records) {
        if ((laterRaw.ordinal || 0) <= (record.ordinal || 0)) continue;
        if (!laterRaw.publishAfterAcceptance) {
          Y.applyUpdate(state.doc, new Uint8Array(laterRaw.update), HYDRATE_ORIGIN);
        }
        Y.applyUpdate(state.stagedDoc, new Uint8Array(laterRaw.update), HYDRATE_ORIGIN);
      }
      scheduleGapRepair(state);
      scheduleOutboxReplay(state, { delayed: true });
      return;
    }
  }
}

function scheduleOutboxReplay(state, { delayed = false } = {}) {
  if (state.destroyed || state.deleted || state.generationBlocked) return;
  if (delayed) {
    if (state.outboxReplayTimer) return;
    const baseDelay = Math.max(1, Number(state.repairRetryDelayMs) || GAP_REPAIR_RETRY_MS);
    const delayMs = Math.min(
      GAP_REPAIR_RETRY_MAX_MS,
      baseDelay * (2 ** Math.min(state.outboxReplayRetryAttempt, 5)),
    );
    state.outboxReplayRetryAttempt += 1;
    state.outboxReplayTimer = setTimeout(() => {
      state.outboxReplayTimer = null;
      scheduleOutboxReplay(state);
    }, delayMs);
    return;
  }
  if (state.outboxReplayScheduled) return;
  state.outboxReplayScheduled = true;
  queueMicrotask(() => {
    state.outboxReplayScheduled = false;
    state.outboxReplayChain = state.outboxReplayChain.then(async () => {
      await state.flushQueue.catch(() => {});
      if (state.destroyed || state.deleted) return;
      await replayOutbox(state);
    }).catch((error) => {
      markSyncHealth(state, false, error);
    });
  });
}

function publishProjectedState(state, projectedDoc) {
  state.doc.transact(() => {
    for (const mapName of DURABLE_MAP_NAMES) {
      const live = state.doc.getMap(mapName);
      const projected = projectedDoc.getMap(mapName);
      const projectedKeys = new Set();
      projected.forEach((_value, key) => projectedKeys.add(key));
      const toDelete = [];
      live.forEach((_value, key) => {
        if (!projectedKeys.has(key)) toDelete.push(key);
      });
      for (const key of toDelete) live.delete(key);
      projected.forEach((value, key) => {
        if (!mapValueEqual(live.get(key), value)) live.set(key, value);
      });
    }
  }, PERMISSION_ROLLBACK_ORIGIN);
  state.lastByPage = null;
  notifyChange(state);
}

// Restore only the durable root maps. The rollback itself remains in IndexedDB,
// but is never appended to the cloud WAL. This makes a rejected optimistic edit
// disappear immediately and prevents the registry-backed Y.Doc from reviving it
// on reopen.
function publishAcceptedState(state) {
  publishProjectedState(state, state.acceptedDoc);
}

function publishAcceptedAndVisiblePendingState(state) {
  const projection = createDetachedYDoc(
    `pending-projection:${state.documentId}:${state.writerId}:${randomClientId()}`,
  );
  try {
    Y.applyUpdate(projection, encodeSnapshot(state.acceptedDoc), HYDRATE_ORIGIN);
    const records = [...state.appendRecords.values()].sort((left, right) => (
      (left.ordinal || 0) - (right.ordinal || 0)
      || String(left.key).localeCompare(String(right.key))
    ));
    for (const record of records) {
      if (
        record.publishAfterAcceptance
        || record.status === 'rejected'
        || record.status === 'integrity-error'
        || record.status === 'dependency-error'
      ) continue;
      Y.applyUpdate(projection, record.update, HYDRATE_ORIGIN);
    }
    publishProjectedState(state, projection);
  } finally {
    try { projection.destroy(); } catch { /* */ }
  }
}

function restoreAcceptedState(state, quarantineDetails = {}) {
  publishAcceptedState(state);
  state.durabilityGap = false;
  clearGapRepairTimer(state);
  clearRepairCheckpoint(state);
  state.snapshottedEpoch = state.editEpoch;
  resetStagedToAccepted(state);
  // Rejected and compensating structs remain in this live Y.Doc's history.
  // Start later authorized edits on a fresh Yjs client clock so their exact
  // updates never depend on the quarantined clock range.
  const freshClock = createDetachedYDoc(
    `post-denial-clock:${state.documentId}:${state.writerId}:${randomClientId()}`,
  );
  state.doc.clientID = freshClock.clientID;
  try { freshClock.destroy(); } catch { /* */ }
  state.rebaseLocalMutations = true;
  emitHistoryQuarantine(state, quarantineDetails);
}

async function resolveAmbiguousAppends(state) {
  const ambiguous = [...state.appendRecords.values()]
    .filter((record) => record.status === 'ambiguous')
    .sort((left, right) => (
      (left.ordinal || 0) - (right.ordinal || 0)
      || String(left.key).localeCompare(String(right.key))
    ));
  for (const record of ambiguous) {
    try {
      // Only the actor-bound exact idempotency replay can disambiguate a
      // timed-out append. An empty tail read is not proof: the original request
      // may still commit after that read.
      await appendOp(state, record);
    } catch (error) {
      if (String(error?.code || '') === '23505') {
        if (await preserveSnapshotAcceptedCollision(state, record)) return;
        state.permissionRejectedCutoff = state.localMutationOrdinal;
        await quarantineRejectedRecords(
          state,
          [record.key],
          error,
          { terminalStatus: 'integrity-error' },
        );
        return { status: 'terminal' };
      }
      if (isPermissionDenied(error)) {
        record.status = 'rejected';
        continue;
      }
      return { status: 'unresolved' };
    }
  }
  return { status: 'resolved' };
}

async function quarantineDefinitivePermissionDenial(
  state,
  error,
  {
    additionalKeys = [],
    reason = 'permission-denied',
  } = {},
) {
  if (state.snapshotTimer) {
    clearTimeout(state.snapshotTimer);
    state.snapshotTimer = null;
  }
  const resolution = await resolveAmbiguousAppends(state);
  if (resolution.status !== 'resolved') {
    if (resolution.status === 'unresolved') {
      markSyncHealth(state, false, error);
      scheduleGapRepair(state);
      scheduleOutboxReplay(state, { delayed: true });
    }
    return resolution;
  }
  // Only a definitive resolution may close the optimistic prefix. A transient
  // exact-replay failure must retain every queued dependent in the durable
  // outbox; advancing the cutoff early made later records self-delete.
  state.permissionRejectedCutoff = state.localMutationOrdinal;
  const unresolvedPrefixKeys = [...state.appendRecords.values()]
    .filter((record) => (
      (Number(record.ordinal) || 0) <= state.permissionRejectedCutoff
      && record.status !== 'accepted'
      && record.status !== 'integrity-error'
      && record.status !== 'dependency-error'
    ))
    .map((record) => record.key);
  const rejectedKeys = [...new Set([
    ...additionalKeys.filter((key) => state.appendRecords.has(key)),
    ...unresolvedPrefixKeys,
    ...[...state.appendRecords.values()]
      .filter((record) => record.status === 'rejected')
      .map((record) => record.key),
  ])];
  if (
    rejectedKeys.length === 0
    && state.appendRecords.size === 0
    && !state.durabilityGap
  ) {
    // Exact WAL replay proved every formerly ambiguous byte was accepted.
    // The snapshot endpoint can still deny independently; keep sync red, but
    // do not invalidate history for mutations already present in acceptedDoc.
    markSyncHealth(state, false, error);
    return { status: 'accepted-before-snapshot-denial' };
  }
  if (rejectedKeys.length > 0) {
    await quarantineRejectedRecords(state, rejectedKeys, error);
  } else {
    restoreAcceptedState(state, {
      reason,
      code: error?.code || '42501',
      requiresFullHistoryReset: true,
    });
  }
  markSyncHealth(state, false, error);
  return { status: 'quarantined' };
}

function handleSnapshotResult(state, result) {
  if (result?.ok) {
    if (
      state.appendRecords.size === 0
      && (result.repairedGap || !state.durabilityGap)
    ) markSyncHealth(state, true);
    return result;
  }
  if (result?.permissionDenied) {
    if (result.containsUnacceptedPrefix) {
      state.permissionRejectedCutoff = state.localMutationOrdinal;
      if (state.snapshotTimer) { clearTimeout(state.snapshotTimer); state.snapshotTimer = null; }
      restoreAcceptedState(state, {
        reason: 'permission-denied-snapshot',
        code: result?.error?.code || '42501',
        requiresFullHistoryReset: true,
      });
    }
    markSyncHealth(state, false, result.error);
  }
  return result;
}

// Serialize appends so client_seq increments cleanly and ordering is stable.
async function preserveSnapshotAcceptedCollision(state, record) {
  if (!record || !state.acceptedReceiptKeys.has(record.key)
    || typeof state.outbox?.settleAccepted !== 'function') return false;
  try {
    // This call does not accept new bytes: it succeeds only when the durable
    // full row or v1 compact proof matches this exact snapshot-accepted
    // receipt. Historical key-only checkpoints keep their hard fence.
    const exact = { ...record, status: 'accepted' };
    delete exact.seq;
    const outcome = await state.outbox.settleAccepted(exact, { receiptConflict: true });
    if (outcome?.receiptVerified === true) {
      record.status = 'accepted';
      state.appendRecords.delete(record.key);
      state.persistedSequenceReceipts.set(record.key, sequence(outcome.seq));
      state.unresolvedReceiptConflicts.delete(record.key);
      markSyncHealth(state, true);
      notifySyncStatus(state);
      return true;
    }
  } catch { return false; }
  record.status = 'accepted';
  state.appendRecords.delete(record.key);
  state.unresolvedReceiptConflicts.add(record.key);
  const warning = Object.assign(new Error(
    'The saved snapshot is intact, but the server could not confirm this annotation receipt.',
  ), { code: 'ANNOTATION_WAL_RECEIPT_AMBIGUOUS' });
  markSyncHealth(state, false, warning);
  notifySyncStatus(state);
  return true;
}

function enqueueAppend(
  state,
  update,
  checkpointUpdate,
  editEpoch,
  { publishAfterAcceptance = false, historyTag = null } = {},
) {
  const ordinal = ++state.localMutationOrdinal;
  const clientSeq = ++state.clientSeq;
  const record = {
    key: annotationOutboxRecordKey({ documentId: state.documentId, actorUserId: state.actorUserId,
      writerId: state.writerId, clientSeq, pdfGenerationId: state.pdfGenerationId,
      ...(state.contentModelVersion === 2 ? { contentModelVersion: 2 } : {}) }),
    ...(state.pdfGenerationId == null ? {} : { pdfGenerationId: state.pdfGenerationId }),
    ...(state.pdfGenerationId != null && state.contentModelVersion === 2 ? { contentModelVersion: 2 } : {}),
    documentId: state.documentId,
    actorUserId: state.actorUserId,
    incarnation: state.documentIncarnation,
    ordinal,
    writerId: state.writerId,
    clientSeq,
    update: new Uint8Array(update),
    checkpointUpdate: new Uint8Array(checkpointUpdate),
    editEpoch,
    publishAfterAcceptance,
    historyTag: historyTag?.mutationId
      ? {
        historyKind: String(historyTag.historyKind || 'erase'),
        mutationId: String(historyTag.mutationId),
      }
      : null,
    status: 'pending',
  };
  record.dependsOn = causalDependenciesForUpdate(state, record.update, record.key);
  state.appendRecords.set(record.key, record);
  const persisted = persistOutboxRecord(state, record);
  state.pendingAppends += 1;
  notifySyncStatus(state);
  state.flushQueue = state.flushQueue.then(async () => {
    try {
      await persisted;
      if (state.generationBlocked) return;
      if (ordinal <= state.permissionRejectedCutoff) {
        if (
          record.status === 'integrity-error'
          || record.status === 'dependency-error'
        ) {
          return;
        }
        await state.outbox?.delete(record.key, state.documentIncarnation);
        state.appendRecords.delete(record.key);
        return;
      }
      const dependency = unresolvedDependencyForRecord(state, record);
      if (dependency) {
        const terminal = (
          dependency.status === 'integrity-error'
          || dependency.status === 'dependency-error'
          || dependency.status === 'rejected'
          || dependency.status === 'missing'
        );
        record.status = terminal ? 'dependency-error' : 'pending';
        await persistOutboxRecord(state, record).catch(() => {});
        markSyncHealth(
          state,
          false,
          new Error(`annotation update waits for unresolved record ${dependency.key}`),
        );
        return;
      }
      await appendOp(state, record);
    } catch (err) {
      if (state.generationBlocked || isGenerationFailure(err)) {
        await retireGenerationState(state, err.currentGenerationId ?? err.replacementGenerationId, err).catch(() => {});
        return;
      }
      if (state.deleted || String(err?.code || '') === 'ANNOTATION_DOCUMENT_DELETED') {
        invalidateDeletedState(state, err);
        state.appendRecords.delete(record.key);
        await state.outbox?.delete?.(
          record.key,
          state.documentIncarnation,
        ).catch(() => {});
        return;
      }
      if (String(err?.code || '') === '23505') {
        if (await preserveSnapshotAcceptedCollision(state, record)) return;
        state.permissionRejectedCutoff = state.localMutationOrdinal;
        await quarantineRejectedRecords(
          state,
          [record.key],
          err,
          { terminalStatus: 'integrity-error' },
        );
        return;
      }
      if (isPermissionDenied(err)) {
        // Everything already queued was authored before this definitive access
        // denial became visible. Quarantine those updates together, restore the
        // last cloud-accepted state, and never run the snapshot fallback with
        // forbidden bytes.
        await quarantineDefinitivePermissionDenial(state, err, {
          additionalKeys: [record.key],
        });
        return;
      }
      // The individual op insert failed (usually network). The mutation is already
      // applied to the in-memory doc, so an eager full-state checkpoint captures it
      // durably NOW instead of waiting up to SNAPSHOT_DEBOUNCE_MS and hoping the tab
      // survives — this is BL-24's fix: a dropped op no longer relies on the debounce
      // + a clean unmount. Also surface the failure so the UI can stop claiming
      // "saved" while writes are failing.
      console.warn('[annotationDocSync] append failed — forcing checkpoint', err?.message);
      if (String(err?.code || '') === 'ETIMEDOUT') {
        record.status = 'ambiguous';
      }
      state.durabilityGap = true;
      state.durabilityGapGeneration += 1;
      setRepairCheckpoint(state, checkpointUpdate, editEpoch);
      markSyncHealth(state, false, err);
      if (record.status === 'ambiguous') {
        await persistOutboxRecord(state, record).catch((persistError) => {
          console.warn('[annotationDocSync] ambiguous outbox status persistence failed', persistError?.message);
        });
      }
      if (state.snapshotTimer) { clearTimeout(state.snapshotTimer); state.snapshotTimer = null; }
      const snapshotResult = await writeSnapshot(
        state,
        captureSnapshotOptions(state),
      ).catch(() => false);
      if (snapshotResult?.permissionDenied && snapshotResult.containsUnacceptedPrefix) {
        await quarantineDefinitivePermissionDenial(state, snapshotResult.error, {
          additionalKeys: [record.key],
          reason: 'permission-denied-snapshot',
        });
        return;
      }
      await finalizeSnapshotResult(state, snapshotResult);
      if (state.durabilityGap && !snapshotResult?.permissionDenied) {
        scheduleGapRepair(state);
        scheduleOutboxReplay(state, { delayed: true });
      }
    } finally {
      state.pendingAppends = Math.max(0, state.pendingAppends - 1);
      notifySyncStatus(state);
    }
  });
  return state.flushQueue;
}

function persistOutboxRecord(state, record) {
  if (!state.outbox) return Promise.resolve();
  const {
    checkpointUpdate: _checkpointUpdate,
    historyTag: _historyTag,
    ...durableRecord
  } = record;
  const task = Promise.resolve().then(() => state.outbox.put(durableRecord));
  state.localWriteTasks.add(task);
  task.then(
    () => state.localWriteTasks.delete(task),
    () => state.localWriteTasks.delete(task),
  );
  return task;
}

function localDurabilityError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isLocalReceiptCurrent(state, receipt) {
  // This synchronous final check covers changes observed in this renderer.
  // Reusing an inactive receipt first requires revalidateLocalReceipt, which
  // also catches storage changes made by another browser context.
  const issued = receipt && ISSUED_LOCAL_RECEIPTS.get(receipt);
  if (!issued || issued.state !== state || state.deleted || state.generationBlocked || state.quarantinedLocalHistory
    || state.permissionRejectedCutoff > 0
    || state.localReceiptPurgeEpoch !== (LOCAL_RECEIPT_PURGE_EPOCHS.get(state.documentId) || 0)
    || receipt.revision !== state.localReceiptRevision
    || receipt.documentId !== state.documentId || receipt.actorUserId !== state.actorUserId
    || (receipt.pdfGenerationId ?? null) !== state.pdfGenerationId
    || (receipt.contentModelVersion ?? 1) !== state.contentModelVersion
    || receipt.incarnation !== state.documentIncarnation || receipt.writerId !== state.writerId) return false;
  // The live observer counts every Yjs update, including remote changes and
  // delete-only transactions. Avoid serializing the full doc on active checks.
  if (!state.destroyed && state.onDocUpdate) return true;
  // Destroy detaches the retired observer. Compare actual bytes as well, so a
  // later change to the shared registry document cannot reuse an old receipt.
  const current = encodeSnapshot(state.doc);
  return current.length === issued.update.length
    && current.every((byte, index) => byte === issued.update[index]);
}

function deleteSetCovers(expectedUpdate, recoveredUpdate) {
  const expected = Y.decodeUpdate(expectedUpdate).ds.clients;
  const recovered = Y.decodeUpdate(recoveredUpdate).ds.clients;
  for (const [client, ranges] of expected) {
    const saved = recovered.get(client) || [];
    for (const range of ranges) {
      let cursor = range.clock;
      const end = range.clock + range.len;
      for (const candidate of saved) {
        if (candidate.clock > cursor) break;
        cursor = Math.max(cursor, candidate.clock + candidate.len);
        if (cursor >= end) break;
      }
      if (cursor < end) return false;
    }
  }
  return true;
}

async function flushLocalDurability(state, {
  expectedDocumentId = state.documentId,
  expectedActorUserId = state.actorUserId,
  isCurrent = () => true,
} = {}, allowClosing = false) {
  if (!allowClosing) assertHandleWritable(state);
  const revision = state.localReceiptRevision;
  const assertCurrent = () => {
    assertStateWritable(state);
    if (state.localReceiptPurgeEpoch !== (LOCAL_RECEIPT_PURGE_EPOCHS.get(state.documentId) || 0)) {
      throw deletedDocumentError(state.documentId);
    }
    if (state.destroyed || (!allowClosing && state.closePromise)) {
      throw localDurabilityError('ANNOTATION_HANDLE_CLOSED', 'The annotation handle closed during the local save.');
    }
    if (expectedDocumentId !== state.documentId || expectedActorUserId !== state.actorUserId || !isCurrent()) {
      throw localDurabilityError('ANNOTATION_LOCAL_SCOPE_CHANGED', 'The document or account changed during the local save.');
    }
    if (revision !== state.localReceiptRevision) {
      throw localDurabilityError('ANNOTATION_LOCAL_REVISION_CHANGED', 'Annotations changed during the local save. Retry the current revision.');
    }
    // Conservative first receipt contract: historical quarantine also requires
    // review. Never turn a recovery record into an ordinary publishable edit.
    if (state.quarantinedLocalHistory) {
      throw localDurabilityError('ANNOTATION_LOCAL_QUARANTINED', 'Quarantined annotation history requires review before confirming a local save.');
    }
  };
  assertCurrent();
  if (state.outbox?.storageKind !== 'indexeddb' || typeof state.outbox.readLocalState !== 'function') {
    throw localDurabilityError('ANNOTATION_LOCAL_STORAGE_UNAVAILABLE', 'Persistent annotation storage is unavailable. Memory alone cannot confirm a local save.');
  }
  const capturedUpdate = encodeSnapshot(state.doc);
  // Only backend-accepted bytes belong in the clean checkpoint. Pending edits
  // remain exact actor-bound records, subject to server permission on replay.
  const acceptedUpdate = encodeSnapshot(state.acceptedDoc);
  await Promise.allSettled([...state.localWriteTasks]);
  assertCurrent();
  await state.outbox.compactAccepted(
    state.documentId, state.actorUserId, acceptedUpdate, true, state.documentIncarnation,
  );
  assertCurrent();
  const stored = await state.outbox.readLocalState(
    state.documentId, state.actorUserId, state.documentIncarnation,
  );
  assertCurrent();
  // Deletion may have committed while a caller was waiting for the scope read.
  // Do not return an old-incarnation receipt after that local purge.
  if (await state.outbox.getDocumentIncarnation(state.documentId) !== state.documentIncarnation) {
    throw deletedDocumentError(state.documentId);
  }
  assertCurrent();
  verifyLocalRecovery(state, stored, capturedUpdate);
  assertCurrent();
  const receipt = Object.freeze({
    locallyDurable: true, documentId: state.documentId, actorUserId: state.actorUserId,
    ...(state.pdfGenerationId == null ? {} : { pdfGenerationId: state.pdfGenerationId }),
    incarnation: state.documentIncarnation, writerId: state.writerId, revision,
    contentModelVersion: state.contentModelVersion,
  });
  ISSUED_LOCAL_RECEIPTS.set(receipt, { state, update: capturedUpdate });
  return receipt;
}

async function revalidateLocalReceipt(state, receipt) {
  const assertCurrent = () => {
    if (!isLocalReceiptCurrent(state, receipt)) {
      throw localDurabilityError('ANNOTATION_LOCAL_RECEIPT_STALE', 'The saved local annotation receipt is no longer current.');
    }
  };
  assertCurrent();
  if (typeof state.outbox?.readLocalStateFresh !== 'function') {
    throw localDurabilityError('ANNOTATION_LOCAL_STORAGE_UNAVAILABLE', 'Persistent annotation storage cannot be checked.');
  }
  const stored = await state.outbox.readLocalStateFresh(
    state.documentId, state.actorUserId, state.documentIncarnation,
  );
  assertCurrent();
  verifyLocalRecovery(state, stored, ISSUED_LOCAL_RECEIPTS.get(receipt).update);
  assertCurrent();
  return receipt;
}

function sameReceiptKeys(left = [], right = []) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function sameRecoveryRows(left, right) {
  return left.length === right.length && left.every((row, index) => {
    const other = right[index];
    return ['key', 'documentId', 'actorUserId', 'pdfGenerationId', 'incarnation', 'status', 'publishAfterAcceptance']
      .every((field) => row[field] === other[field])
      && sameReceiptKeys(row.dependsOn, other.dependsOn)
      && bytesEqual(row.update, other.update);
  });
}

function sameAcceptedReceiptProofs(left = [], right = []) {
  return left.length === right.length && left.every((proof, index) => {
    const other = right[index];
    if (!other || !['version', 'key', 'updateSha256', 'updateByteLength',
      'checkpointUpdateSha256', 'checkpointUpdateByteLength', 'seq']
      .every(field => proof[field] === other[field])) return false;
    const metadata = proof.metadata, otherMetadata = other.metadata;
    return metadata && otherMetadata
      && ['key', 'scopeKey', 'pdfGenerationId', 'contentModelVersion', 'documentId',
        'actorUserId', 'incarnation', 'ordinal', 'writerId', 'clientSeq', 'editEpoch',
        'publishAfterAcceptance', 'status']
        .every(field => metadata[field] === otherMetadata[field])
      && sameReceiptKeys(metadata.dependsOn, otherMetadata.dependsOn)
      && metadata.historyTag?.historyKind === otherMetadata.historyTag?.historyKind
      && metadata.historyTag?.mutationId === otherMetadata.historyTag?.mutationId;
  });
}

function sameRecoveryInputs(left, right) {
  return left.documentId === right.documentId && left.actorUserId === right.actorUserId
    && (left.pdfGenerationId ?? null) === (right.pdfGenerationId ?? null)
    && left.incarnation === right.incarnation
    && bytesEqual(left.checkpointUpdate, right.checkpointUpdate)
    && sameReceiptKeys(left.acceptedKeys, right.acceptedKeys)
    && sameAcceptedReceiptProofs(left.acceptedReceiptProofs, right.acceptedReceiptProofs)
    && sameReceiptKeys(
      (left.acceptedReceiptConflicts || []).map(item => `${item.version}:${item.kind}:${item.key}`),
      (right.acceptedReceiptConflicts || []).map(item => `${item.version}:${item.kind}:${item.key}`),
    )
    && sameRecoveryRows(left.accepted, right.accepted)
    && sameRecoveryRows(left.pending, right.pending);
}

function verifyLocalRecovery(state, stored, capturedUpdate) {
  if ((stored.pdfGenerationId ?? null) !== state.pdfGenerationId) {
    throw localDurabilityError('ANNOTATION_LOCAL_SCOPE_CHANGED', 'Stored annotations belong to another PDF generation.');
  }
  if (!stored.checkpointUpdate?.length) {
    throw localDurabilityError('ANNOTATION_LOCAL_INCOMPLETE', 'The saved annotation checkpoint is missing.');
  }
  if (stored.quarantined.length || stored.pending.some((row) => (
    !['pending', 'ambiguous'].includes(row.status)
  ))) {
    throw localDurabilityError('ANNOTATION_LOCAL_QUARANTINED', 'Stored annotation updates require review before confirming a local save.');
  }
  for (const row of [...stored.accepted, ...stored.pending]) {
    if (row.documentId !== state.documentId || row.actorUserId !== state.actorUserId
      || (row.pdfGenerationId ?? null) !== state.pdfGenerationId
      || (Number(row.incarnation) || 0) !== state.documentIncarnation) {
      throw localDurabilityError('ANNOTATION_LOCAL_SCOPE_CHANGED', 'Stored annotation updates do not match this document and account.');
    }
  }
  const availableKeys = new Set([
    ...stored.acceptedKeys, ...stored.accepted.map((row) => row.key), ...stored.pending.map((row) => row.key),
  ]);
  if (stored.pending.some((row) => (row.dependsOn || []).some((key) => !availableKeys.has(key)))) {
    throw localDurabilityError('ANNOTATION_LOCAL_INCOMPLETE', 'A pending annotation update is missing its predecessor.');
  }
  // A single last-proof entry saves only detached reconstruction. Every caller
  // still performs fresh transactions and all scope/quarantine/dependency
  // checks above. These are owned read clones, never optimistic live objects.
  const previous = state.localRecoveryProof;
  if (previous && bytesEqual(previous.capturedUpdate, capturedUpdate)
    && sameRecoveryInputs(previous.stored, stored)) return;
  const captured = createDetachedYDoc(`local-receipt-captured:${state.writerId}`);
  const recovered = createDetachedYDoc(`local-receipt-recovered:${state.writerId}`);
  try {
    Y.applyUpdate(captured, capturedUpdate, HYDRATE_ORIGIN);
    for (const update of [
      stored.checkpointUpdate,
      ...stored.accepted.map((row) => row.update),
      ...stored.pending.filter((row) => !row.publishAfterAcceptance).map((row) => row.update),
    ].filter(Boolean)) Y.applyUpdate(recovered, update, HYDRATE_ORIGIN);
    const missing = Y.decodeUpdate(Y.diffUpdate(capturedUpdate, Y.encodeStateVector(recovered)));
    if (missing.structs.length || !deleteSetCovers(capturedUpdate, encodeSnapshot(recovered))
      || !durableDocsEqual(captured, recovered)) {
      throw localDurabilityError('ANNOTATION_LOCAL_INCOMPLETE', 'The stored annotation state does not yet cover this revision.');
    }
    state.localRecoveryProof = { capturedUpdate, stored };
  } finally {
    captured.destroy();
    recovered.destroy();
  }
}

async function appendOp(state, record) {
  if (state.destroyed || state.deleted) throw deletedDocumentError(state.documentId);
  assertStateWritable(state);
  const {
    update,
    checkpointUpdate,
    editEpoch,
  } = record;
  const row = {
    document_id: state.documentId,
    client_id: record.writerId,
    client_seq: record.clientSeq,
    data: bytesToPgHex(update),
  };
  let data;
  let error;
  if (state.generationTransport) {
    const receipt = await generationCall(state, 'append', { writerId: record.writerId, clientSeq: record.clientSeq, data: row.data });
    record.seq = receipt.seq;
    if (!receipt.isCurrent || state.generationBlocked) {
      // The append may have committed immediately before publication. Preserve
      // that exact old-generation receipt, without exposing bytes or effects.
      try { await state.outbox.settleAccepted({ ...record, status: 'accepted' }); }
      catch (failure) { if (!failure.acceptedEvidenceSaved) throw failure; }
      record.status = 'accepted';
      await retireGenerationState(state, receipt.isCurrent ? null : receipt.currentGenerationId);
      throw state.generationError;
    }
    data = { seq: receipt.seq };
  } else if (typeof state.supabase.rpc === 'function') {
    ({ data, error } = await withActorRequest(
      state,
      () => state.supabase.rpc('append_annotation_update', {
        p_document_id: row.document_id,
        p_client_id: row.client_id,
        p_client_seq: row.client_seq,
        p_data: row.data,
      }),
      'annotation WAL append',
    ));
  } else {
    ({ data, error } = await withActorRequest(
      state,
      () => state.supabase
        .from('annotation_updates')
        .insert(row)
        .select('seq')
        .single(),
      'annotation WAL append',
    ));
  }
  if (error) {
    // The RPC returns the existing seq for an exact replay. A 23505 now means
    // the same idempotency key was reused for DIFFERENT bytes; treating that as
    // success would silently discard one tab's mutation.
    if (error.code === '23505') {
      const collision = new Error(`WAL writer sequence collision: ${error.message}`);
      collision.code = '23505';
      throw collision;
    }
    const writeError = new Error(error.message);
    writeError.code = error.code;
    throw writeError;
  }
  if (state.generationBlocked) {
    // First publication can retire the legacy/null scope while its original
    // append RPC is already in flight. Its exact successful receipt is still
    // recovery evidence, never permission to replay into the replacement.
    const receipt = Array.isArray(data) ? data[0] : data;
    record.seq = sequence(receipt?.seq ?? receipt);
    try { await state.outbox.settleAccepted({ ...record, status: 'accepted' }); }
    catch (failure) { if (!failure.acceptedEvidenceSaved) throw failure; }
    throw state.generationError;
  }
  assertStateWritable(state);
  await settleAcceptedRecord(state, record, update);
  // Irreversible History/trash/Excel effects may run only after this exact
  // core mutation has entered acceptedDoc.
  void queueEraseOutboxDrain(state);
  if (state.durabilityGap) {
    // This immutable transaction-time checkpoint ends at this exact successful
    // append. Later queued edits have already entered stagedDoc, so stagedDoc is
    // never a safe repair source here.
    setRepairCheckpoint(state, checkpointUpdate, editEpoch);
  }
  // A later append cannot repair an earlier missing Yjs predecessor. Health
  // stays red until a full accepted snapshot proves the complete in-memory
  // state is reconstructible by a fresh client.
  if (!state.durabilityGap) markSyncHealth(state, true);
  // Advance our log position so snapshots record the correct at_seq and a reopen
  // doesn't needlessly replay ops already folded into the snapshot.
  const rpcRow = Array.isArray(data) ? data[0] : data;
  const assignedValue = rpcRow?.seq ?? rpcRow;
  if (assignedValue != null && (state.generationTransport || Number.isFinite(Number(assignedValue)))) {
    const assignedSeq = sequence(assignedValue);
    if (compareSequence(assignedSeq, state.lastSeq) > 0) state.lastSeq = assignedSeq;
    // The server-assigned immediate successor proves there is no unseen row
    // between the last contiguous baseline and this already-applied local op.
    if (compareSequence(assignedSeq, nextAnnotationSequence(state.coveredSeq)) === 0) state.coveredSeq = assignedSeq;
  }
  state.opsSinceSnapshot += 1;
  if (state.opsSinceSnapshot >= SNAPSHOT_AFTER_OPS) {
    state.opsSinceSnapshot = 0;
    const repairsGap = state.durabilityGap;
    const result = await writeSnapshot(state, {
      snapshotUpdate: repairsGap ? encodeRepairCheckpoint(state) : encodeSnapshot(state.acceptedDoc),
      epoch: repairsGap ? state.repairCheckpointEpoch : state.acceptedEditEpoch,
      repairsGap,
      ...(repairsGap ? { gapGeneration: state.repairCheckpointGeneration } : {}),
    });
    await finalizeSnapshotResult(state, result);
  }
}

async function finalizeSnapshotResult(state, result) {
  if (result?.permissionDenied && result.containsUnacceptedPrefix) {
    await quarantineDefinitivePermissionDenial(
      state,
      result.error,
      { reason: 'permission-denied-snapshot' },
    );
    return result;
  }
  handleSnapshotResult(state, result);
  return result;
}

// Debounce a full-state checkpoint after edits settle. Cheap to call on every op.
function scheduleSnapshot(state) {
  if (state.destroyed || state.generationBlocked) return;
  if (state.snapshotTimer) clearTimeout(state.snapshotTimer);
  state.snapshotTimer = setTimeout(() => {
    state.snapshotTimer = null;
    // Never checkpoint optimistic bytes before their WAL authorization result.
    // A pending 42501 must roll them back instead of racing a snapshot upload.
    if (state.pendingAppends > 0) {
      scheduleSnapshot(state);
      return;
    }
    writeSnapshot(state, captureSnapshotOptions(state))
      .then((result) => finalizeSnapshotResult(state, result));
  }, SNAPSHOT_DEBOUNCE_MS);
}

// Serialize ALL snapshot writes through one chain so two can never run at once.
// Before BL-24 the only triggers were a self-cancelling debounce, the 40-op
// compaction, and destroy(); BL-24 adds an eager write on append failure, which
// clusters exactly with queued edits during flaky connections. Without this
// serialization a stale in-flight write could land AFTER a fresher one and
// overwrite it — rolling at_seq forward past ops the stale bytes don't contain,
// which drops those ops on the next reopen (they're skipped by the seq>at_seq
// tail read). The chain guarantees the last write to land is always the freshest.
function writeSnapshot(state, options = {}) {
  const sealed = {
    ...options,
    atSeq: state.coveredSeq,
    expectedAtSeq: state.snapshotBaseAtSeq,
    expectedWriterId: state.snapshotBaseWriterId,
    expectedWriterEpoch: state.snapshotBaseWriterEpoch,
  };
  state.snapshotChain = state.snapshotChain.then(() => writeSnapshotNow(state, sealed));
  return state.snapshotChain;
}

function isSnapshotConflict(error) {
  return String(error?.code || '') === '40001'
    || /stale annotation snapshot/i.test(error?.message || '');
}

async function loadLatestCloudCheckpoint(state) {
  if (state.generationTransport) return readGeneratedCheckpoint(state);
  const cloudDoc = createDetachedYDoc(
    `snapshot-refresh:${state.documentId}:${state.writerId}:${randomClientId()}`,
  );
  try {
    const { data: snapRow, error: snapshotError } = await withActorRequest(
      state,
      () => state.supabase
        .from('annotation_snapshots')
        .select('snapshot, at_seq, encoding_version, writer_id, writer_epoch')
        .eq('document_id', state.documentId)
        .maybeSingle(),
      'snapshot refresh read',
    );
    if (snapshotError) throw toSyncError(snapshotError, 'snapshot refresh read failed');

    let cursor = 0;
    let baseAtSeq = null;
    let baseWriterId = null;
    let baseWriterEpoch = 0;
    if (snapRow?.snapshot) {
      let bytes = pgHexToBytes(snapRow.snapshot);
      if (snapRow.encoding_version === SNAPSHOT_ENC_GZIP) bytes = await gunzip(bytes);
      Y.applyUpdate(cloudDoc, bytes, HYDRATE_ORIGIN);
      cursor = sequence(snapRow.at_seq ?? 0);
      baseAtSeq = cursor;
      baseWriterId = snapRow.writer_id ?? null;
      baseWriterEpoch = sequence(snapRow.writer_epoch ?? 0);
    }

    for (;;) {
      const { data: rows, error } = await withActorRequest(
        state,
        () => state.supabase
          .from('annotation_updates')
          .select('seq, data, client_id, client_seq, actor_user_id')
          .eq('document_id', state.documentId)
          .gt('seq', cursor)
          .order('seq', { ascending: true })
          .limit(1000),
        'snapshot refresh tail read',
      );
      if (error) throw toSyncError(error, 'snapshot refresh tail read failed');
      const batch = rows || [];
      for (const row of batch) {
        const update = pgHexToBytes(row.data);
        Y.applyUpdate(cloudDoc, update, HYDRATE_ORIGIN);
        await applyAuthoritativeCloudRow(state, row);
        cursor = sequence(row.seq);
      }
      if (batch.length < 1000) break;
    }

    return {
      update: encodeSnapshot(cloudDoc),
      coveredSeq: cursor,
      baseAtSeq,
      baseWriterId,
      baseWriterEpoch,
    };
  } finally {
    try { cloudDoc.destroy(); } catch { /* */ }
  }
}

async function refreshAfterSnapshotConflict(state, localSnapshotUpdate) {
  const latest = await loadLatestCloudCheckpoint(state);
  assertStateWritable(state);
  const candidate = createDetachedYDoc(
    `snapshot-candidate:${state.documentId}:${state.writerId}:${randomClientId()}`,
  );
  try {
    Y.applyUpdate(candidate, latest.update, HYDRATE_ORIGIN);
    Y.applyUpdate(candidate, localSnapshotUpdate, HYDRATE_ORIGIN);

    // Publish only cloud-acknowledged bytes before the retry. The local
    // candidate remains staged until the snapshot CAS accepts it.
    Y.applyUpdate(state.acceptedDoc, latest.update, HYDRATE_ORIGIN);
    Y.applyUpdate(state.stagedDoc, latest.update, HYDRATE_ORIGIN);
    Y.applyUpdate(state.doc, latest.update, REMOTE_ORIGIN);
    state.snapshotBaseAtSeq = latest.baseAtSeq;
    state.snapshotBaseWriterId = latest.baseWriterId;
    state.snapshotBaseWriterEpoch = latest.baseWriterEpoch;
    state.snapshotGeneration = maxAnnotationSequence(
      state.snapshotGeneration,
      latest.baseWriterEpoch,
    );
    state.lastSeq = latest.coveredSeq;
    state.coveredSeq = latest.coveredSeq;
    state.replayFromSeq = latest.baseAtSeq ?? 0;
    notifyChange(state);

    return encodeSnapshot(candidate);
  } finally {
    try { candidate.destroy(); } catch { /* */ }
  }
}

// Write the full Y.Doc as one idempotent checkpoint. Retries hard — this is the
// durability guarantee that makes dropped op inserts self-heal on next open.
async function writeSnapshotNow(state, {
  snapshotUpdate = null,
  epoch = null,
  conflictAttempt = 0,
  repairsGap = null,
  gapGeneration = null,
  atSeq,
  expectedAtSeq,
  expectedWriterId,
  expectedWriterEpoch,
} = {}) {
  const repairsGapAtStart = repairsGap ?? state.durabilityGap;
  const gapGenerationAtStart = gapGeneration ?? state.durabilityGapGeneration;
  if (!state.supabase || state.generationBlocked) {
    return {
      ok: false,
      permissionDenied: false,
      containsUnacceptedPrefix: repairsGapAtStart,
      error: state.generationError,
    };
  }
  // Capture at_seq AND the edit generation BEFORE encoding (same synchronous
  // tick as encodeSnapshot, no await between). at_seq can then never claim an op
  // not in these bytes; and epochAtStart records exactly which edits these bytes
  // cover, so a stale in-flight snapshot that finishes AFTER a newer edit only
  // advances snapshottedEpoch to what it actually captured — it can't mark the
  // newer edit as saved and suppress the tab-close flush for it.
  // A realtime row can arrive out of order. `lastSeq` is merely the highest
  // observed row, while `coveredSeq` is the highest ordered-read frontier
  // actually folded into this doc. Claiming lastSeq here could make a snapshot
  // skip an unseen delete forever on reopen.
  const epochAtStart = epoch ?? (
    repairsGapAtStart ? state.repairCheckpointEpoch : state.acceptedEditEpoch
  );
  // `epochAtStart` tracks which local edits the bytes cover. Snapshot CAS needs
  // a separate document-wide generation: local edit epochs can repeat across
  // writers (A1 → B1 → A1), which would make a stale base token valid again.
  // Every non-idempotent attempt therefore consumes a value above the latest
  // snapshot generation observed from the backend.
  const snapshotGenerationAtStart = nextAnnotationSequence(maxAnnotationSequence(
    state.snapshotGeneration,
    state.snapshotBaseWriterEpoch,
  ));
  const updateAtStart = snapshotUpdate || (
    repairsGapAtStart ? encodeRepairCheckpoint(state) : encodeSnapshot(state.acceptedDoc)
  );
  if (!updateAtStart) {
    return {
      ok: false,
      permissionDenied: false,
      containsUnacceptedPrefix: repairsGapAtStart,
      error: new Error('no immutable repair checkpoint is available'),
    };
  }
  let hex;
  try {
    hex = bytesToPgHex(await gzip(updateAtStart));
  } catch (err) {
    console.warn('[annotationDocSync] snapshot gzip failed, storing raw', err?.message);
    return {
      ok: false,
      permissionDenied: false,
      containsUnacceptedPrefix: repairsGapAtStart,
      error: toSyncError(err),
    };
  }
  for (let attempt = 1; attempt <= SNAPSHOT_RETRIES; attempt += 1) {
    try {
      let error;
      let accepted = true;
      if (state.generationTransport) {
        accepted = await generationCall(state, 'storeSnapshot', {
          atSeq, snapshot: hex, encodingVersion: SNAPSHOT_ENC_GZIP, writerId: state.writerId,
          writerEpoch: snapshotGenerationAtStart, expectedAtSeq,
          expectedWriterId, expectedWriterEpoch,
        });
        assertStateWritable(state);
      } else if (typeof state.supabase.rpc === 'function') {
        let data;
        ({ data, error } = await withActorRequest(
          state,
          () => state.supabase.rpc('store_annotation_snapshot', {
            p_document_id: state.documentId,
            p_at_seq: atSeq,
            p_snapshot: hex,
            p_encoding_version: SNAPSHOT_ENC_GZIP,
            p_writer_id: state.writerId,
            p_writer_epoch: snapshotGenerationAtStart,
            p_expected_at_seq: expectedAtSeq,
            p_expected_writer_id: expectedWriterId,
            p_expected_writer_epoch: expectedWriterEpoch,
          }),
          'annotation snapshot write',
        ));
        const rpcResult = Array.isArray(data) ? data[0] : data;
        accepted = rpcResult?.accepted ?? rpcResult ?? false;
      } else {
        // Compatibility path for older test doubles/dev backends. The
        // production RPC below performs this check atomically under a
        // per-document advisory lock.
        const { data: current } = await withActorRequest(
          state,
          () => state.supabase
            .from('annotation_snapshots')
            .select('at_seq, writer_id, writer_epoch')
            .eq('document_id', state.documentId)
            .maybeSingle(),
          'annotation snapshot CAS read',
        );
        const currentSeq = current?.at_seq == null ? null : sequence(current.at_seq);
        const currentEpoch = sequence(current?.writer_epoch ?? 0);
        const matchesLoadedBase = (
          currentSeq === expectedAtSeq
          &&
          (current?.writer_id ?? null) === expectedWriterId
          && currentEpoch === expectedWriterEpoch
        );
        if (
          currentSeq != null
          && (
            currentSeq !== atSeq
            || !matchesLoadedBase
          )
        ) {
          accepted = false;
        }
        if (accepted) {
          ({ error } = await withActorRequest(
            state,
            () => state.supabase
              .from('annotation_snapshots')
              .upsert({
                document_id: state.documentId,
                at_seq: atSeq,
                snapshot: hex,
                encoding_version: SNAPSHOT_ENC_GZIP,
                writer_id: state.writerId,
                writer_epoch: snapshotGenerationAtStart,
                base_at_seq: expectedAtSeq,
                base_writer_id: expectedWriterId,
                base_writer_epoch: expectedWriterEpoch,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'document_id' }),
            'annotation snapshot write',
          ));
        }
      }
      if (!error && accepted) {
        // Only advance the captured generation — never regress it — so a stale
        // snapshot completing late can't clear a newer edit's dirty state.
        if (epochAtStart > state.snapshottedEpoch) state.snapshottedEpoch = epochAtStart;
        if (compareSequence(atSeq, state.replayFromSeq) > 0) state.replayFromSeq = atSeq;
        state.snapshotBaseAtSeq = atSeq;
        state.snapshotBaseWriterId = state.writerId;
        state.snapshotBaseWriterEpoch = snapshotGenerationAtStart;
        state.snapshotGeneration = maxAnnotationSequence(
          state.snapshotGeneration,
          snapshotGenerationAtStart,
        );
        const repairedGap = (
          repairsGapAtStart
          && state.durabilityGap
          && state.durabilityGapGeneration === gapGenerationAtStart
        );
        if (repairedGap) {
          state.durabilityGap = false;
          clearGapRepairTimer(state);
          clearRepairCheckpoint(state);
        }
        Y.applyUpdate(state.acceptedDoc, updateAtStart, HYDRATE_ORIGIN);
        state.acceptedEditEpoch = Math.max(state.acceptedEditEpoch, epochAtStart || 0);
        await settleSnapshotCoveredRecords(state, updateAtStart, epochAtStart);
        void queueEraseOutboxDrain(state);
        if (repairedGap && state.pendingAppends === 0 && state.appendRecords.size > 0) {
          scheduleOutboxReplay(state);
        }
        return {
          ok: true,
          permissionDenied: false,
          repairedGap,
          containsUnacceptedPrefix: repairsGapAtStart,
          error: null,
        };
      }
      if (!error && !accepted) {
        if (conflictAttempt >= SNAPSHOT_RETRIES - 1) {
          return {
            ok: false,
            permissionDenied: false,
            stale: true,
            containsUnacceptedPrefix: repairsGapAtStart,
            error: null,
          };
        }
        try {
          const rebasedUpdate = await refreshAfterSnapshotConflict(state, updateAtStart);
          return writeSnapshotNow(state, {
            snapshotUpdate: rebasedUpdate,
            epoch: epochAtStart,
            conflictAttempt: conflictAttempt + 1,
            repairsGap: repairsGapAtStart,
            gapGeneration: gapGenerationAtStart,
            atSeq: state.coveredSeq,
            expectedAtSeq: state.snapshotBaseAtSeq,
            expectedWriterId: state.snapshotBaseWriterId,
            expectedWriterEpoch: state.snapshotBaseWriterEpoch,
          });
        } catch (refreshError) {
          return {
            ok: false,
            permissionDenied: false,
            stale: true,
            containsUnacceptedPrefix: repairsGapAtStart,
            error: toSyncError(refreshError, 'snapshot conflict refresh failed'),
          };
        }
      }
      if (isPermissionDenied(error)) {
        return {
          ok: false,
          permissionDenied: true,
          containsUnacceptedPrefix: repairsGapAtStart,
          error: toSyncError(error, 'snapshot permission denied'),
        };
      }
      if (isSnapshotConflict(error)) {
        if (conflictAttempt >= SNAPSHOT_RETRIES - 1) {
          return {
            ok: false,
            permissionDenied: false,
            stale: true,
            containsUnacceptedPrefix: repairsGapAtStart,
            error: toSyncError(error, 'snapshot conflict'),
          };
        }
        const rebasedUpdate = await refreshAfterSnapshotConflict(state, updateAtStart);
        return writeSnapshotNow(state, {
          snapshotUpdate: rebasedUpdate,
          epoch: epochAtStart,
          conflictAttempt: conflictAttempt + 1,
          repairsGap: repairsGapAtStart,
          gapGeneration: gapGenerationAtStart,
          atSeq: state.coveredSeq,
          expectedAtSeq: state.snapshotBaseAtSeq,
          expectedWriterId: state.snapshotBaseWriterId,
          expectedWriterEpoch: state.snapshotBaseWriterEpoch,
        });
      }
      console.warn(`[annotationDocSync] snapshot write failed (attempt ${attempt})`, error.message);
    } catch (err) {
      if (state.generationBlocked || isGenerationFailure(err)) {
        await retireGenerationState(state, err.currentGenerationId ?? err.replacementGenerationId, err).catch(() => {});
        return { ok: false, permissionDenied: false, containsUnacceptedPrefix: repairsGapAtStart, error: err };
      }
      if (err?.code === 'ANNOTATION_ACTOR_MISMATCH') {
        return {
          ok: false,
          permissionDenied: false,
          containsUnacceptedPrefix: repairsGapAtStart,
          error: err,
        };
      }
      if (isPermissionDenied(err)) {
        return {
          ok: false,
          permissionDenied: true,
          containsUnacceptedPrefix: repairsGapAtStart,
          error: toSyncError(err, 'snapshot permission denied'),
        };
      }
      if (isSnapshotConflict(err)) {
        if (conflictAttempt >= SNAPSHOT_RETRIES - 1) {
          return {
            ok: false,
            permissionDenied: false,
            stale: true,
            containsUnacceptedPrefix: repairsGapAtStart,
            error: toSyncError(err, 'snapshot conflict'),
          };
        }
        try {
          const rebasedUpdate = await refreshAfterSnapshotConflict(state, updateAtStart);
          return writeSnapshotNow(state, {
            snapshotUpdate: rebasedUpdate,
            epoch: epochAtStart,
            conflictAttempt: conflictAttempt + 1,
            repairsGap: repairsGapAtStart,
            gapGeneration: gapGenerationAtStart,
            atSeq: state.coveredSeq,
            expectedAtSeq: state.snapshotBaseAtSeq,
            expectedWriterId: state.snapshotBaseWriterId,
            expectedWriterEpoch: state.snapshotBaseWriterEpoch,
          });
        } catch (refreshError) {
          return {
            ok: false,
            permissionDenied: false,
            stale: true,
            containsUnacceptedPrefix: repairsGapAtStart,
            error: toSyncError(refreshError, 'snapshot conflict refresh failed'),
          };
        }
      }
      console.warn(`[annotationDocSync] snapshot threw (attempt ${attempt})`, err?.message);
    }
    if (attempt < SNAPSHOT_RETRIES) {
      const delayMs = Math.max(0, Number(state.snapshotRetryDelayMs) || 0) * attempt;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return {
    ok: false,
    permissionDenied: false,
    containsUnacceptedPrefix: repairsGapAtStart,
    error: null,
  };
}

function subscribeRealtime(state) {
  // Realtime channel topics must be unique per OPEN, not per document. supabase-js
  // caches channels by topic and `channel()` returns the cached instance, and
  // adding `postgres_changes` callbacks to an already-subscribed channel throws.
  // A bare `anno-<docId>` topic therefore raced the previous handle's destroy()
  // (channel removal is the LAST teardown step, after a slow snapshot write) — and
  // the whole open failed ("cannot add `postgres_changes` … after `subscribe()`").
  // A RANDOM suffix (not a shared counter) keeps every open's topic distinct even
  // across Vite HMR module reloads, multiple bundles, and reopens — none of which
  // reset it, whereas a module-level counter resets on HMR and can collide with a
  // channel the (non-replayed) supabase client still caches. postgres_changes
  // delivery is filter-driven, not topic-driven, so the suffix is transparent
  // server-side.
  const topic = state.generationTransport
    ? `anno-generation-${state.documentId}-${state.pdfGenerationId}-${randomClientId()}`
    : `anno-${state.documentId}-${randomClientId()}`;
  const ch = state.supabase.channel(topic);
  // Assign before wiring callbacks so a synchronous throw from .on()/.subscribe()
  // during a failed open is still cleanable by the teardown catch (removeChannel).
  state.realtimeChannel = ch;
  if (state.generationTransport) {
    ch.on('postgres_changes', {
      event: '*', schema: 'public', table: 'annotation_generation_signals',
      filter: `document_id=eq.${state.documentId}`,
    }, payload => handleGenerationSignal(state, payload));
  } else ch.on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'annotation_updates',
      filter: `document_id=eq.${state.documentId}`,
    }, (payload) => {
      const row = payload.new;
      if (!row) return;
      state.authoritativeChain = state.authoritativeChain.then(async () => {
        if (state.destroyed) return;
        // Same-install handles share clientId. Apply matching rows too so one
        // handle cannot miss another handle's delete and later checkpoint stale
        // geometry at that delete's seq. True self-echoes are Yjs no-ops.
        await applyAuthoritativeCloudRow(state, row);
        if (compareSequence(row.seq, state.lastSeq) > 0) state.lastSeq = sequence(row.seq);
        notifyChange(state);
        void queueEraseOutboxDrain(state);
      }).catch((err) => {
        console.warn('[annotationDocSync] remote apply failed', err?.message);
        markSyncHealth(state, false, err);
      });
    });
  ch.subscribe((status) => {
      // Fires on the initial join AND after every reconnect re-join. Each time,
      // sweep the log for ops that landed while we weren't listening.
      if (status === 'SUBSCRIBED') {
        const catchupGeneration = ++state.realtimeCatchupGeneration;
        state.realtimePhase = 'catching-up';
        notifySyncStatus(state);
        // A snapshot can change without advancing the WAL head. Refresh the
        // full checked generation on every join, including the first, instead
        // of treating annotation bytes issued before local storage opened as
        // permanently current.
        const refresh = Boolean(state.generationTransport);
        return catchUpTail(state, { refresh }).then(async (caughtUp) => {
          if (state.destroyed || state.generationBlocked || catchupGeneration !== state.realtimeCatchupGeneration) return;
          if (!caughtUp) {
            state.realtimePhase = 'connecting';
            markSyncHealth(state, false, new Error('realtime catch-up failed'));
            return;
          }
          // Keep the reconnect lifecycle open through repair. A catch-up that
          // found every remote row is not complete while a known local WAL gap
          // is still awaiting its authoritative checkpoint (or rollback).
          const hadDurabilityGap = state.durabilityGap;
          if (hadDurabilityGap) {
            const result = await writeSnapshot(state, captureSnapshotOptions(state));
            await finalizeSnapshotResult(state, result);
          }
          if (state.destroyed || state.generationBlocked || catchupGeneration !== state.realtimeCatchupGeneration) return;
          state.realtimePhase = 'ready';
          // Gap finalization owns health: success repairs it; denial/failure
          // must stay red. A plain catch-up can safely recover transport health.
          if (!hadDurabilityGap) markSyncHealth(state, true);
          notifySyncStatus(state);
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Invalidate any catch-up that started under the channel we just lost.
        // Otherwise its delayed success can race this callback and turn the
        // status green even though Realtime is still offline.
        state.realtimeCatchupGeneration += 1;
        state.realtimePhase = 'connecting';
        markSyncHealth(state, false, new Error(`realtime ${String(status).toLowerCase()}`));
      }
    });
}

function notifyChange(state) {
  const byPage = docToByPage(state.doc);
  state.lastByPage = byPage;
  for (const cb of state.changeListeners) {
    try { cb(byPage); } catch (err) { console.warn('[annotationDocSync] listener threw', err?.message); }
  }
}

function pendingEraseOutboxCount(doc, actorUserId) {
  let pending = 0;
  doc.getMap(ERASE_OUTBOX_MAP).forEach((entry) => {
    if (
      entry?.status !== 'acknowledged'
      && entry?.actorUserId === actorUserId
    ) pending += 1;
  });
  return pending;
}

function clearEraseOutboxRetry(state) {
  if (state.eraseOutboxRetryTimer) {
    clearTimeout(state.eraseOutboxRetryTimer);
    state.eraseOutboxRetryTimer = null;
  }
}

function scheduleEraseOutboxRetry(state) {
  if (
    state.destroyed
    || state.eraseOutboxClosing
    || !state.eraseEffectConsumer
    || state.eraseOutboxRetryTimer
    || pendingEraseOutboxCount(state.doc, state.actorUserId) === 0
  ) return;

  const attempt = Math.min(state.eraseOutboxRetryAttempt, 16);
  const delay = Math.min(
    state.eraseOutboxRetryMaxMs,
    state.eraseOutboxRetryBaseMs * (2 ** attempt),
  );
  state.eraseOutboxRetryAttempt += 1;
  state.eraseOutboxRetryTimer = setTimeout(() => {
    state.eraseOutboxRetryTimer = null;
    void queueEraseOutboxDrain(state);
  }, delay);
  state.eraseOutboxRetryTimer.unref?.();
}

function queueEraseOutboxDrain(state, options = {}) {
  if (!state.eraseEffectConsumer || state.destroyed || state.eraseOutboxClosing) {
    return Promise.resolve({
      status: 'unavailable',
      acknowledged: 0,
      pending: pendingEraseOutboxCount(state.doc, state.actorUserId),
    });
  }
  state.eraseOutboxDrain = state.eraseOutboxDrain
    .catch(() => ({ status: 'failed', acknowledged: 0, pending: 0 }))
    .then(() => drainEraseOutboxOnDoc({
      ...options,
      doc: state.doc,
      executeEffect: state.eraseEffectConsumer,
      validateEntry: ({ mutationId, entry }) => {
        if (state.generationBlocked) return false;
        // No cloud means this actor-scoped document is itself authoritative.
        if (!state.supabase) return true;
        const acceptedEntry = state.acceptedDoc
          .getMap(ERASE_OUTBOX_MAP)
          .get(mutationId);
        return acceptedEntry !== undefined && mapValueEqual(acceptedEntry, entry);
      },
      actorUserId: state.actorUserId,
      origin: state.eraseOutboxOrigin,
    }))
    .then((result) => {
      if (result.pending === 0) {
        state.eraseOutboxRetryAttempt = 0;
        clearEraseOutboxRetry(state);
      } else {
        scheduleEraseOutboxRetry(state);
      }
      return result;
    })
    .catch((error) => {
      console.warn('[annotationDocSync] erase outbox drain failed; pending effects will retry', error?.message);
      const failure = {
        status: 'failed',
        acknowledged: 0,
        pending: pendingEraseOutboxCount(state.doc, state.actorUserId),
        error,
      };
      scheduleEraseOutboxRetry(state);
      return failure;
    });
  return state.eraseOutboxDrain;
}

function annotationsByStorageKey(byPage) {
  const values = new Map();
  const resolveStorageKey = createAnnotationStorageKeyResolver();
  for (const [pageKey, page] of Object.entries(byPage || {})) {
    for (const object of page?.objects || []) {
        const embeddedId = extractAnnotationId(object);
        const storageKey = resolveStorageKey(object, Number(pageKey), embeddedId);
        values.set(String(storageKey), {
          pageNumber: Number(pageKey),
          object,
          serialized: JSON.stringify(object),
        });
    }
  }
  return values;
}

function changedAnnotationIds(previousByPage, nextByPage) {
  const previous = annotationsByStorageKey(previousByPage);
  const next = annotationsByStorageKey(nextByPage);
  const ids = new Set([...previous.keys(), ...next.keys()]);
  return [...ids].filter(
    (id) => previous.get(id)?.serialized !== next.get(id)?.serialized,
  );
}

const LANE_BASE_GEOMETRY_KEYS = new Set([
  'type',
  'path',
  'polygons',
  'cmds',
  'width',
  'height',
  'pathOffset',
  'inkGeometrySpace',
  'inkGeometryOrigin',
  'paperCenterline',
  'paperCenterlineRuns',
  'paperInkGeometry',
  'paperEraserGeometry',
  'paperSourceStroke',
  'paperEraserCuts',
  'sourceWidth',
  'strokeWidth',
]);
const LANE_BASE_IDENTITY_KEYS = new Set(['id', 'annotationId', 'pdfAnnotationId']);

function hasVisiblePaint(value) {
  const paint = String(value ?? '').trim().toLowerCase();
  return paint !== ''
    && paint !== 'none'
    && paint !== 'transparent'
    && paint !== 'rgba(0,0,0,0)'
    && paint !== 'rgba(0, 0, 0, 0)';
}

function laneVisibleGeometryMatches(previous, next, stableBase) {
  const geometry = (object) => Object.fromEntries(
    [...LANE_BASE_GEOMETRY_KEYS].map((key) => [key, object?.[key] ?? null]),
  );
  return mapValueEqual(geometry(previous), geometry(next))
    || (
      previous?.paperEraserGeometry === 'v1'
      && next?.paperEraserGeometry === 'v1'
    )
    || erasedPathSurvivorsShareGeometry(previous, next, stableBase);
}

/**
 * Apply an ordinary edit made against a materialized erased survivor to its
 * stable base. Unchanged baked erase geometry is never copied into the base;
 * lane survivors remain independently Undoable and affine-rebase on the new
 * base transform. A real geometry edit replaces the base and makes older
 * incompatible lanes dormant until that edit is undone.
 */
function mergeLaneOwnedNormalEdit(stableBase, previousVisible, desiredVisible) {
  if (!stableBase || !previousVisible || !desiredVisible) {
    return structuredClone(desiredVisible ?? stableBase);
  }
  if (!laneVisibleGeometryMatches(previousVisible, desiredVisible, stableBase)) {
    return structuredClone(desiredVisible);
  }

  const nextBase = structuredClone(stableBase);
  const keys = new Set([
    ...Object.keys(previousVisible),
    ...Object.keys(desiredVisible),
  ]);
  const previousBaseTransform = previousVisible.paperEraserBaseTransform;
  const desiredBaseTransform = desiredVisible.paperEraserBaseTransform;
  if (
    previousBaseTransform
    && desiredBaseTransform
    && !mapValueEqual(previousBaseTransform, desiredBaseTransform)
  ) {
    for (const key of [
      'left',
      'top',
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
    ]) {
      if (Object.prototype.hasOwnProperty.call(desiredBaseTransform, key)) {
        nextBase[key] = structuredClone(desiredBaseTransform[key]);
      } else {
        delete nextBase[key];
      }
    }
  }
  for (const key of keys) {
    if (key === 'paperEraserBaseTransform') continue;
    if (LANE_BASE_GEOMETRY_KEYS.has(key) || LANE_BASE_IDENTITY_KEYS.has(key)) continue;
    const previousHas = Object.prototype.hasOwnProperty.call(previousVisible, key);
    const desiredHas = Object.prototype.hasOwnProperty.call(desiredVisible, key);
    const previousValue = previousHas ? previousVisible[key] : undefined;
    const desiredValue = desiredHas ? desiredVisible[key] : undefined;
    if (mapValueEqual(previousValue, desiredValue)) continue;

    // Filled eraser survivors paint with `fill`, even when their stable
    // centerline base paints with `stroke`. Route a color edit back to the
    // base's active paint channel so Undoing the erase still renders correctly.
    if (key === 'fill' && previousVisible.paperEraserGeometry === 'v1') {
      const paintKey = hasVisiblePaint(stableBase.fill) ? 'fill' : 'stroke';
      if (desiredHas) nextBase[paintKey] = structuredClone(desiredValue);
      else delete nextBase[paintKey];
      continue;
    }
    if (desiredHas) nextBase[key] = structuredClone(desiredValue);
    else delete nextBase[key];
  }
  return nextBase;
}

async function drainStateQueues(state) {
  for (;;) {
    await Promise.resolve();
    const flushQueue = state.flushQueue;
    const replayQueue = state.outboxReplayChain;
    const authoritativeQueue = state.authoritativeChain;
    await Promise.all([
      flushQueue.catch(() => {}),
      replayQueue.catch(() => {}),
      authoritativeQueue.catch(() => {}),
    ]);
    await Promise.resolve();
    if (
      flushQueue === state.flushQueue
      && replayQueue === state.outboxReplayChain
      && authoritativeQueue === state.authoritativeChain
      && !state.outboxReplayScheduled
    ) return;
  }
}

async function closeRetiredGeneration(state) {
  unregisterActiveState(state);
  state.conditionalCheckpointPrefix = null;
  await Promise.allSettled([...state.localWriteTasks, state.flushQueue, state.outboxReplayChain,
    state.catchupChain, state.authoritativeChain, state.snapshotChain, state.eraseOutboxDrain,
    state.generationRetirement]);
  state.destroyed = true;
  if (state.onDocUpdate) state.doc.off('update', state.onDocUpdate);
  if (state.onPageHide && typeof window !== 'undefined') window.removeEventListener('pagehide', state.onPageHide);
  destroyLocalPersistence(state);
  await state.outbox?.close?.();
  for (const doc of [state.acceptedDoc, state.stagedDoc, state.persistedDoc, state.legacyPersistenceDoc]) doc?.destroy();
  if (state.ownsRegistryDoc) releaseYDoc(state.registryKey);
  else state.doc.destroy();
}

function makeHandle(state) {
  return {
    documentId: state.documentId,
    get actorUserId() { return state.actorUserId; },
    get pdfGenerationId() { return state.pdfGenerationId; },
    get contentModelVersion() { return state.contentModelVersion; },
    getGenerationStatus: () => ({ pdfGenerationId: state.pdfGenerationId, blocked: state.generationBlocked,
      error: state.generationError, retirement: state.generationRetirement }),
    retireGeneration: ({ replacementGenerationId } = {}) => {
      if (typeof replacementGenerationId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(replacementGenerationId)
        || replacementGenerationId === state.pdfGenerationId) throw new Error('An exact replacement PDF generation is required');
      return retireGenerationState(state, replacementGenerationId);
    },
    clientId: state.clientId,
    writerId: state.writerId,
    doc: state.doc,

    getLocalRevision: () => state.localReceiptRevision,
    isLocalReceiptCurrent: (receipt) => isLocalReceiptCurrent(state, receipt),
    revalidateLocalReceipt: (receipt) => revalidateLocalReceipt(state, receipt),
    flushLocalDurability: (options) => flushLocalDurability(state, options),
    getLocalCloseReceipt: () => state.localCloseReceipt,

    captureAcceptedAnnotationState: () => captureAcceptedAnnotationState(state),
    revalidateAcceptedAnnotationCapture: (capture) => revalidateAcceptedAnnotationCapture(state, capture),

    /** Current annotations in render shape. */
    getByPage() {
      const byPage = docToByPage(state.doc);
      state.lastByPage = byPage;
      return byPage;
    },

    /** Imported PDF-native annotations intentionally removed in app state. */
    getDeletedPdfAnnotations() {
      return docToDeletedPdfAnnotations(state.doc);
    },

    /** Push the viewer's render-shape state into the doc (minimal diff → ops). */
    applyByPage(byPage, opts = {}) {
      assertHandleWritable(state);
      const currentMaterialized = docToByPage(state.doc);
      const identityNormalization = normalizeByPageAnnotationIdentities(byPage);
      byPage = identityNormalization.byPage;
      const hasEraserMutation = Object.values(byPage || {}).some((page) => page?.eraserMutation?.id);
      const preparedByPage = byPage;
      let laneBaseChanges = { added: 0, updated: 0, removed: 0 };
      if (!hasEraserMutation && state.lastByPage) {
        const changedIds = changedAnnotationIds(currentMaterialized, byPage);
        const lanesByStorageKey = new Map();
        getEraserOpsMap(state.doc).forEach((lane) => {
          if (lane?.storageKey == null) return;
          const key = String(lane.storageKey);
          if (!lanesByStorageKey.has(key)) lanesByStorageKey.set(key, []);
          lanesByStorageKey.get(key).push(lane);
        });
        const laneOwnedIds = changedIds.filter((id) => lanesByStorageKey.has(String(id)));
        if (laneOwnedIds.length > 0) {
          const previous = annotationsByStorageKey(currentMaterialized);
          const desired = annotationsByStorageKey(byPage);
          const annotations = getAnnotationsMap(state.doc);
          const deletedPdfAnnotations = getDeletedPdfAnnotationsMap(state.doc);
          state.doc.transact(() => {
            for (const storageKey of laneOwnedIds) {
              const previousRecord = previous.get(storageKey);
              const desiredRecord = desired.get(storageKey);
              const stored = annotations.get(storageKey);
              const lanes = lanesByStorageKey.get(storageKey) || [];

              // Selection delete removes only the stable base. Lanes remain so
              // restoring that base naturally reveals the prior erased state.
              if (!desiredRecord) {
                if (!stored) continue;
                const nativeId = stored.o?.pdfAnnotationId;
                if (nativeId) {
                  const pdfNativeAnnotationIdentity = stored.o?.data?.pdfNativeAnnotationIdentity;
                  deletedPdfAnnotations.set(
                    deletedPdfAnnotationStorageKey(stored.p, nativeId),
                    {
                      pdfAnnotationId: String(nativeId),
                      pageNumber: Number(stored.p || 1),
                      pdfAnnotationType: stored.o?.pdfAnnotationType || null,
                      ...(pdfNativeAnnotationIdentity
                        ? {
                          pdfNativeAnnotationIdentity: structuredClone(
                            pdfNativeAnnotationIdentity,
                          ),
                        }
                        : {}),
                    },
                  );
                }
                annotations.delete(storageKey);
                laneBaseChanges.removed += 1;
                continue;
              }

              const fallbackBase = lanes.find((lane) => lane?.base)?.base || null;
              const stableBase = stored?.o || fallbackBase || desiredRecord.object;
              const nextBase = previousRecord
                ? mergeLaneOwnedNormalEdit(
                  stableBase,
                  previousRecord.object,
                  desiredRecord.object,
                )
                : structuredClone(stableBase);
              annotations.set(storageKey, {
                ...(stored && typeof stored === 'object' ? stored : {}),
                p: desiredRecord.pageNumber,
                o: nextBase,
              });
              const nativeId = nextBase?.pdfAnnotationId;
              if (nativeId) {
                deletedPdfAnnotations.delete(
                  deletedPdfAnnotationStorageKey(desiredRecord.pageNumber, nativeId),
                );
              }
              if (stored) laneBaseChanges.updated += 1;
              else laneBaseChanges.added += 1;
            }
          }, opts.origin || 'local');
        }
      }
      const res = syncByPageToDoc(state.doc, preparedByPage, {
        origin: 'local',
        prevByPage: state.lastByPage,
        eraserWriterId: state.writerId,
        ...opts,
      });
      state.lastByPage = byPage;
      return {
        ...res,
        added: (Number(res.added) || 0) + laneBaseChanges.added,
        updated: (Number(res.updated) || 0) + laneBaseChanges.updated,
        removed: (Number(res.removed) || 0) + laneBaseChanges.removed,
        normalizedByPage: byPage,
        identityChanged: identityNormalization.changed || res.identityChanged,
      };
    },

    /**
     * Capture an immutable eraser intent before returning control to React.
     * This closes the render/effect window where a remote notification could
     * replace the local page before its writer-scoped survivor lane existed.
     */
    applyEraserMutation(pageNumber, pageAnnotations, eraserMutation) {
      assertHandleWritable(state);
      if (!eraserMutation?.id) return null;
      const current = state.lastByPage || docToByPage(state.doc);
      const prepared = {
        ...current,
        [pageNumber]: {
          ...(pageAnnotations || { objects: [] }),
          eraserMutation,
        },
      };
      syncByPageToDoc(state.doc, prepared, {
        origin: 'local',
        prevByPage: current,
        eraserWriterId: state.writerId,
      });
      const materialized = docToByPage(state.doc);
      state.lastByPage = materialized;
      return materialized[pageNumber] || { objects: [] };
    },

    /** Read a document-level meta value (e.g. the callouts list). */
    getMeta(key) {
      if (state.contentModelVersion === 2 && key === 'spaces') {
        return materializeSurveyCrdtV2(state.doc).spaces;
      }
      return getMetaValue(state.doc, key);
    },

    /** Write a document-level meta value (idempotent; coarse whole-value). */
    setMeta(key, value) {
      assertHandleWritable(state);
      if (state.contentModelVersion === 2 && key === 'spaces') {
        throw Object.assign(new Error('Whole-space writes cannot update survey collaboration model 2.'),
          { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
      }
      return setMetaValue(state.doc, key, value, 'local');
    },

    /** Current survey markers as { [annotationId]: marker }. */
    getSurveyMarkers() {
      return state.contentModelVersion === 2
        ? materializeSurveyCrdtV2(state.doc).surveyMarkers : docToSurveyMarkers(state.doc);
    },

    getSurveyState() {
      if (state.contentModelVersion !== 2) {
        throw Object.assign(new Error('This document does not use survey collaboration model 2.'),
          { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
      }
      return materializeSurveyCrdtV2(state.doc);
    },

    updateSurveyMarkers(updater, opts = {}) {
      assertHandleWritable(state);
      if (state.contentModelVersion !== 2) {
        throw Object.assign(new Error('This document does not use survey collaboration model 2.'),
          { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
      }
      return updateSurveyMarkersV2(state.doc, updater, { ...opts, origin: 'local' });
    },

    updateSurveySpaces(updater, opts = {}) {
      assertHandleWritable(state);
      if (state.contentModelVersion !== 2) {
        throw Object.assign(new Error('This document does not use survey collaboration model 2.'),
          { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
      }
      return updateSurveySpacesV2(state.doc, updater, { ...opts, origin: 'local' });
    },

    /** Push the survey-marker dict into the doc (minimal per-marker diff → ops). */
    applySurveyMarkers(markers, opts = {}) {
      assertHandleWritable(state);
      if (state.contentModelVersion !== 1) {
        throw Object.assign(new Error('Whole-marker writes cannot update survey collaboration model 2.'),
          { code: 'ANNOTATION_CONTENT_MODEL_MISMATCH' });
      }
      return syncSurveyMarkersToDoc(state.doc, markers, { origin: 'local', ...opts });
    },

    /**
     * Commit every domain touched by one eraser gesture in one Y.Doc
     * transaction, then recover non-core effects from the durable outbox.
     */
    async commitEraseIntent(intent, opts = {}) {
      assertHandleWritable(state);
      const quarantineGeneration = state.historyQuarantineGeneration;
      const materializedByStorageKey = annotationsByStorageKey(docToByPage(state.doc));
      const result = await commitEraseIntentOnDoc({
        doc: state.doc,
        intent,
        ...opts,
        origin: {
          source: 'erase-local',
          historyTag: {
            historyKind: 'erase-commit',
            mutationId: String(intent.mutationId),
          },
        },
        actorUserId: state.actorUserId,
        eraserWriterId: state.writerId,
        materializePageTarget: (target) => (
          materializedByStorageKey.get(String(target.storageKey))?.object
        ),
      });
      if (state.historyQuarantineGeneration !== quarantineGeneration) {
        return {
          status: 'cancelled',
          reason: 'authoritative-rollback',
          mutationId: intent.mutationId,
          historyQuarantineGeneration: state.historyQuarantineGeneration,
          byPage: docToByPage(state.doc),
          surveyMarkers: state.contentModelVersion === 2
            ? materializeSurveyCrdtV2(state.doc).surveyMarkers : docToSurveyMarkers(state.doc),
        };
      }
      if (result.status !== 'committed' && result.status !== 'noop') return result;
      void queueEraseOutboxDrain(state);
      const byPage = docToByPage(state.doc);
      state.lastByPage = byPage;
      return {
        ...result,
        outbox: {
          status: state.eraseEffectConsumer ? 'scheduled' : 'unavailable',
          acknowledged: 0,
          pending: pendingEraseOutboxCount(state.doc, state.actorUserId),
        },
        historyQuarantineGeneration: quarantineGeneration,
        byPage,
        surveyMarkers: state.contentModelVersion === 2
          ? materializeSurveyCrdtV2(state.doc).surveyMarkers : docToSurveyMarkers(state.doc),
      };
    },

    /** Undo/Redo only one eraser gesture's writer lanes/counter fields. */
    applyEraseHistoryTransition(transition, direction) {
      assertHandleWritable(state);
      const quarantineGeneration = state.historyQuarantineGeneration;
      const result = applyEraseHistoryTransitionOnDoc({
        doc: state.doc,
        transition,
        direction,
        origin: {
          source: 'erase-history-local',
          historyTag: {
            historyKind: direction === 'undo'
              ? 'erase-history-undo'
              : 'erase-history-redo',
            mutationId: String(transition?.mutationId || ''),
          },
        },
      });
      if (state.historyQuarantineGeneration !== quarantineGeneration) {
        return { status: 'conflict', reason: 'authoritative-rollback' };
      }
      if (result.status !== 'applied' && result.status !== 'noop') return result;
      const byPage = docToByPage(state.doc);
      state.lastByPage = byPage;
      return {
        ...result,
        historyQuarantineGeneration: quarantineGeneration,
        byPage,
        surveyMarkers: state.contentModelVersion === 2
          ? materializeSurveyCrdtV2(state.doc).surveyMarkers : docToSurveyMarkers(state.doc),
        deletedPdfAnnotations: docToDeletedPdfAnnotations(state.doc),
      };
    },

    /** Restore only the exact full-delete eraser lanes captured by Revisions. */
    restoreEraseDeletion(restoreActions, options = {}) {
      assertHandleWritable(state);
      const result = restoreEraseDeletionOnDoc({
        doc: state.doc,
        restoreActions,
        origin: 'erase-history-restore',
        ...options,
      });
      if (result.status !== 'applied' && result.status !== 'noop') return result;
      const byPage = docToByPage(state.doc);
      state.lastByPage = byPage;
      return {
        ...result,
        byPage,
        surveyMarkers: state.contentModelVersion === 2
          ? materializeSurveyCrdtV2(state.doc).surveyMarkers : docToSurveyMarkers(state.doc),
        deletedPdfAnnotations: docToDeletedPdfAnnotations(state.doc),
      };
    },

    /** Replace the app-owned effect executor and recover pending work now. */
    setEraseEffectConsumer(consumer) {
      assertHandleWritable(state);
      state.eraseEffectConsumer = typeof consumer === 'function' ? consumer : null;
      if (!state.eraseEffectConsumer) {
        state.eraseOutboxRetryAttempt = 0;
        clearEraseOutboxRetry(state);
      }
      return queueEraseOutboxDrain(state);
    },

    /** Explicit diagnostic/manual retry seam. Normal failures retry themselves. */
    drainEraseOutbox(options = {}) {
      return queueEraseOutboxDrain(state, options);
    },

    /**
     * Remove exact stacked ink copies left by old import/sync races. The
     * transaction is observed by the WAL listener above, but local mutations
     * intentionally do not echo to React, so explicitly publish the clean
     * materialization when anything was removed.
     */
    repairStackedInkDuplicates({ notify = true, ...opts } = {}) {
      assertHandleWritable(state);
      const result = repairStackedInkDuplicates(state.doc, opts);
      if (result.removed > 0) {
        state.lastByPage = null;
        if (notify) notifyChange(state);
      }
      return result;
    },

    /** Subscribe to changes (local or remote). Returns an unsubscribe fn. */
    onChange(cb) { state.changeListeners.add(cb); return () => state.changeListeners.delete(cb); },

    /** True while durable op appends are succeeding; false after one fails until
     *  it recovers. Lets the viewer stop showing "saved" when writes are failing. */
    isSyncHealthy() { return state.syncHealthy; },

    /** Current durable-write state for user-facing status. */
    getSyncStatus() { return currentSyncStatus(state); },

    /** Actor-safe status for the shipped actorless IndexedDB recovery store. */
    getLegacyRecoveryStatus() {
      return {
        pending: state.legacyRecoveryPending,
        unresolvedEntries: state.legacyUnresolvedEntries,
      };
    },

    /** Subscribe to sync-health transitions ({ healthy, error }). Returns an
     *  unsubscribe fn. Fires only on an actual healthy⇄failing transition. */
    onSyncStatus(cb) { state.syncListeners.add(cb); return () => state.syncListeners.delete(cb); },

    /** Definitive accepted-state rollback events. Unlike sync health, this
     *  fires for every rollback even when the handle was already unhealthy. */
    onHistoryQuarantine(cb) {
      return subscribeHistoryQuarantine(state, cb);
    },

    getHistoryQuarantineGeneration() {
      return state.historyQuarantineGeneration;
    },

    /** Force a compacted snapshot now (e.g. on explicit save). */
    async flushSnapshot() {
      assertHandleWritable(state);
      await catchUpTail(state);
      await drainStateQueues(state);
      const result = await writeSnapshot(state, captureSnapshotOptions(state));
      await finalizeSnapshotResult(state, result);
      await drainStateQueues(state);
      return result?.ok === true;
    },

    /** Wait until all queued appends have hit the backend. */
    async drain() {
      assertStateWritable(state);
      await drainStateQueues(state);
      assertStateWritable(state);
    },

    destroy() {
      if (state.closePromise) return state.closePromise;
      state.closePromise = (async () => {
      state.conditionalCheckpointPrefix = null;
      if (state.generationBlocked) return closeRetiredGeneration(state);
      // closePromise gates the observer before any awaited work completes.
      // Already-queued edits and this writer's pending effect receipts drain;
      // new edits belong only to the next viewer of the shared registry doc.
      unregisterActiveState(state);
      state.eraseOutboxClosing = true;
      clearEraseOutboxRetry(state);
      // Expose local durability independently of the cloud teardown below.
      // The close promise still seals this observer before control returns.
      state.localCloseReceipt = flushLocalDurability(state, {}, true);
      state.localCloseReceipt.catch(() => {}); // caller may inspect it later
      if (state.deleted) {
        state.destroyed = true;
      }
      if (state.snapshotTimer) { clearTimeout(state.snapshotTimer); state.snapshotTimer = null; }
      if (state.outboxReplayTimer) {
        clearTimeout(state.outboxReplayTimer);
        state.outboxReplayTimer = null;
      }
      clearGapRepairTimer(state);
      if (state.onPageHide && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pagehide', state.onPageHide);
        state.onPageHide = null;
      }
      // Final checkpoint before teardown so the latest state is durable even if a
      // debounce was still pending. (Mark destroyed AFTER, so the write proceeds.)
      await drainStateQueues(state);
      await state.catchupChain.catch(() => {}); // let an in-flight catch-up page finish cleanly
      await state.authoritativeChain.catch(() => {});
      await state.eraseOutboxDrain.catch(() => {});
      // An effect that was already running can acknowledge after the first
      // drain. Include that exact receipt before taking the final checkpoint.
      await drainStateQueues(state);
      // A save already in flight may cover every accepted local edit. Wait for
      // its result before deciding: read-only visits and already-saved edits
      // must not upload another full snapshot just because the viewer closed.
      await state.snapshotChain.catch(() => {});
      if (state.generationBlocked) return closeRetiredGeneration(state);
      if (state.supabase && (
        state.durabilityGap || state.acceptedEditEpoch > state.snapshottedEpoch
      )) {
        try {
          const result = await writeSnapshot(state, captureSnapshotOptions(state));
          await finalizeSnapshotResult(state, result);
        } catch { /* */ }
      }
      await state.localCloseReceipt.catch(() => {});
      state.destroyed = true;
      // Detach the local-mutation observer: registry docs survive destroy by
      // design (undo/state across reopen), so leaving the listener attached
      // would accumulate one dead observer per open/close cycle.
      if (state.onDocUpdate) { try { state.doc.off('update', state.onDocUpdate); } catch { /* */ } }
      if (state.realtimeChannel) {
        try {
          await withCloudRequest(
            state,
            state.supabase.removeChannel(state.realtimeChannel),
            'realtime channel removal',
          );
        } catch { /* */ }
      }
      destroyLocalPersistence(state);
      try { await state.outbox?.close?.(); } catch { /* */ }
      try { state.acceptedDoc.destroy(); } catch { /* */ }
      try { state.stagedDoc.destroy(); } catch { /* */ }
      try { state.persistedDoc?.destroy(); } catch { /* */ }
      try { state.legacyPersistenceDoc?.destroy(); } catch { /* */ }
      // Release the registry doc (the registry never destroys — keeps undo/state
      // across reopen). Only destroy a doc we were explicitly handed (tests).
      if (state.ownsRegistryDoc) releaseYDoc(state.registryKey);
      else { try { state.doc.destroy(); } catch { /* */ } }
      })();
      return state.closePromise;
    },
  };
}

/**
 * Purge the LOCAL durable copy of a document's annotations (IndexedDB + the
 * in-memory registry doc). Call this when a document is hard-deleted so a
 * same-content re-upload (which dedups to the same id) cannot resurrect the old
 * marks from local storage. The cloud rows are removed by the documents-row
 * delete cascade.
 */
export async function purgeAnnotationDoc(documentId) {
  if (!documentId) return;
  const legacyScopePrefix = getLegacyYDocDocumentPrefix(documentId);
  LOCAL_RECEIPT_PURGE_EPOCHS.set(documentId, (LOCAL_RECEIPT_PURGE_EPOCHS.get(documentId) || 0) + 1);
  const purgeError = deletedDocumentError(documentId);
  const activeStates = [...(ACTIVE_STATES.get(documentId) || [])];
  for (const state of activeStates) {
    state.deleted = true;
    state.destroyed = true;
    state.conditionalCheckpointPrefix = null;
    unregisterActiveState(state);
    if (state.snapshotTimer) {
      clearTimeout(state.snapshotTimer);
      state.snapshotTimer = null;
    }
    if (state.outboxReplayTimer) {
      clearTimeout(state.outboxReplayTimer);
      state.outboxReplayTimer = null;
    }
    clearGapRepairTimer(state);
    if (state.onDocUpdate) {
      try { state.doc.off('update', state.onDocUpdate); } catch { /* already detached */ }
      state.onDocUpdate = null;
    }
    if (
      state.onPageHide
      && typeof window !== 'undefined'
      && typeof window.removeEventListener === 'function'
    ) {
      window.removeEventListener('pagehide', state.onPageHide);
      state.onPageHide = null;
    }
    state.doc.transact(() => {
      for (const mapName of DURABLE_MAP_NAMES) {
        const map = state.doc.getMap(mapName);
        for (const key of [...map.keys()]) map.delete(key);
      }
    }, PERMISSION_ROLLBACK_ORIGIN);
    state.lastByPage = null;
    markSyncHealth(state, false, purgeError);
    notifyChange(state);
    destroyLocalPersistence(state);
    if (state.realtimeChannel) {
      try { state.supabase?.removeChannel?.(state.realtimeChannel); } catch { /* best effort */ }
      state.realtimeChannel = null;
    }
  }

  // Exact legacy keys plus a delimiter-scoped actor prefix. `doc1` must never
  // purge `doc10`, and the old Phase-27 raw registry key must not survive.
  purgeYDoc(documentId);
  purgeYDoc(`${REGISTRY_PREFIX}${documentId}`);
  purgeYDocsByPrefix(`${REGISTRY_PREFIX}${documentId}:`);
  purgeYDocsByPrefix(legacyScopePrefix);

  const generationPrefix = `annotationPersistenceGeneration:${documentId}:`;
  const actorsKey = persistenceActorsKey(documentId);
  const databaseNames = new Set([
    `anno-${documentId}`,
    documentId,
  ]);
  const generationKeys = [];
  const purgeErrors = [];
  try {
    if (typeof localStorage !== 'undefined') {
      const knownActors = JSON.parse(localStorage.getItem(actorsKey) || '[]');
      for (const actorScope of knownActors) {
        databaseNames.add(`anno-${documentId}-actor-${actorScope}-g0`);
      }
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(generationPrefix)) continue;
        generationKeys.push(key);
        const actorScope = key.slice(generationPrefix.length);
        const generation = Math.max(0, Number(localStorage.getItem(key)) || 0);
        for (let value = 0; value <= generation; value += 1) {
          databaseNames.add(`anno-${documentId}-actor-${actorScope}-g${value}`);
        }
      }
    }
  } catch (error) {
    purgeErrors.push(error);
  }

  try {
    if (typeof indexedDB !== 'undefined') {
      if (typeof indexedDB.databases === 'function') {
        const databases = await indexedDB.databases();
        for (const entry of databases || []) {
          if (
            entry?.name === documentId
            || entry?.name === `anno-${documentId}`
            || entry?.name?.startsWith(`anno-${documentId}-actor-`)
            || entry?.name?.startsWith(legacyScopePrefix)
          ) databaseNames.add(entry.name);
        }
      } else {
        // Scoped legacy stores have no all-actor inventory. Delete the known
        // old stores, but never claim that unlisted actor stores were purged.
        const error = new Error('Cannot enumerate actor-scoped legacy document storage');
        error.code = 'LEGACY_YDOC_PURGE_DISCOVERY_UNAVAILABLE';
        purgeErrors.push(error);
      }
      const { clearDocument } = await import('y-indexeddb');
      const results = await Promise.allSettled(
        [...databaseNames].map((name) => clearDocument(name)),
      );
      for (const result of results) {
        if (result.status === 'rejected') purgeErrors.push(result.reason);
      }
    }
  } catch (error) {
    purgeErrors.push(error);
  }

  let outbox = null;
  try {
    outbox = await createAnnotationOutbox();
    await outbox.deleteDocument(documentId);
  } catch (error) {
    purgeErrors.push(error);
  } finally {
    try { await outbox?.close?.(); } catch (error) { purgeErrors.push(error); }
  }

  if (purgeErrors.length === 0) {
    try {
      if (typeof localStorage !== 'undefined') {
        for (const key of generationKeys) localStorage.removeItem(key);
        localStorage.removeItem(actorsKey);
        localStorage.removeItem(`cloudSyncQueue_${documentId}`);
      }
    } catch (error) {
      purgeErrors.push(error);
    }
  }

  if (purgeErrors.length > 0) {
    throw new AggregateError(
      purgeErrors,
      `annotation document ${documentId} local purge incomplete`,
    );
  }
}

export const __test = {
  bytesToPgHex,
  pgHexToBytes,
  emitHistoryQuarantine,
  subscribeHistoryQuarantine,
};
