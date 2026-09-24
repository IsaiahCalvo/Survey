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
import {
  createDetachedYDoc,
  getOrCreateYDoc,
  purgeYDoc,
  purgeYDocsByPrefix,
  releaseYDoc,
} from '../lib/collab/ydocRegistry.js';
import {
  createAnnotationOutbox,
} from './annotationDocOutbox.js';
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
  createViewerCaptureState,
  recordViewerDelivery,
  recordViewerObject,
  getViewerEchoVersions,
  readAnnotationEntry,
  writeAnnotationMark,
} from './annotationDocStore.js';
import {
  copyDurableMapValue,
  decodeAnnotationEntry,
  rootKeysChangedByTransaction,
} from './annotationMarkStore.js';

// The flat annotation store gets its OWN registry-managed Y.Doc, keyed apart
// from the legacy CRDT doc so the two never share a map. (The applyUpdate-only
// invariant requires all Y.Doc construction to live in the registry module.)
const REGISTRY_PREFIX = 'annoflat:';

const SNAPSHOT_AFTER_OPS = 40;      // compact to a fresh snapshot every N ops
const SNAPSHOT_DEBOUNCE_MS = 1200;  // after edits settle, write a full-state checkpoint
const SNAPSHOT_RETRIES = 4;         // the checkpoint is the durability guarantee — retry hard
const SNAPSHOT_ENC_GZIP = 2;        // encoding_version 2 = gzipped Y.encodeStateAsUpdate
const CLOUD_REQUEST_TIMEOUT_MS = 15_000;
const GAP_REPAIR_RETRY_MS = 1_000;
const GAP_REPAIR_RETRY_MAX_MS = 30_000;
const REMOTE_ORIGIN = 'remote';
const HYDRATE_ORIGIN = 'hydrate';
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

function persistenceGenerationKey(documentId, actorUserId) {
  return `annotationPersistenceGeneration:${documentId}:${persistenceActorScope(actorUserId)}`;
}

function persistenceActorsKey(documentId) {
  return `annotationPersistenceActors:${documentId}`;
}

function registerPersistenceActor(documentId, actorUserId) {
  try {
    const key = persistenceActorsKey(documentId);
    const actors = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
    actors.add(persistenceActorScope(actorUserId));
    localStorage.setItem(key, JSON.stringify([...actors]));
  } catch { /* local persistence unavailable */ }
}

function persistenceDatabaseName(documentId, actorUserId, generation) {
  return `anno-${documentId}-actor-${persistenceActorScope(actorUserId)}-g${generation}`;
}

function readPersistenceGeneration(documentId, actorUserId) {
  try {
    return Math.max(
      0,
      Number(localStorage.getItem(persistenceGenerationKey(documentId, actorUserId))) || 0,
    );
  } catch {
    return 0;
  }
}

function writePersistenceGeneration(documentId, actorUserId, generation) {
  try {
    localStorage.setItem(
      persistenceGenerationKey(documentId, actorUserId),
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

  // Default: a dedicated registry-managed Y.Doc for this document's flat store.
  const registryKey = `${REGISTRY_PREFIX}${documentId}:${actorUserId}`;
  const ownsRegistryDoc = !doc;
  const activeDoc = doc || getOrCreateYDoc(registryKey);
  const activeWriterId = writerId || `${clientId}:${randomClientId()}`;
  const useRealtime = Boolean(
    enableRealtime && supabase && typeof supabase.channel === 'function',
  );

  const state = {
    documentId,
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
    lastByPage: null,      // last byPage applied or materialized (eraser page commits)
    // What the viewer holds, so a capture writes only the viewer's own edits
    // (per-field sync, 2026-09-24 — see createViewerCaptureState).
    viewer: createViewerCaptureState(),
    // Local updates made durable only by a snapshot (their WAL append failed,
    // then a gap-repair checkpoint covered them). Open peers only read the
    // WAL, so these are re-sent through it (exact bytes, same writer/seq).
    liveResendQueue: [],
    liveResendTimer: null,
    liveResendAttempt: 0,
    liveResendChain: Promise.resolve(),
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
    syncHealthy: true,     // false once an op append fails until it recovers (BL-24)
    durabilityGap: false,  // a locally-applied update is absent from both WAL and snapshot
    durabilityGapGeneration: 0,
    repairCheckpointUpdate: null, // immutable staged prefix through the last append result
    repairCheckpointEpoch: 0,
    repairCheckpointGeneration: 0,
    pendingAppends: 0,
    localMutationOrdinal: 0,
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
    persistenceGeneration: readPersistenceGeneration(documentId, actorUserId),
    legacyPersistenceDoc: null,
    legacyClearDocument: null,
    legacyRecoveryPending: false,
    legacyUnresolvedEntries: 0,
  };

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
        registerPersistenceActor(documentId, actorUserId);
        const persistenceDoc = createDetachedYDoc(
          `persistence:${documentId}:${activeWriterId}`,
        );
        state.localPersistenceDoc = persistenceDoc;
        if (localPersistenceFactory) {
          state.idbProvider = await localPersistenceFactory(
            persistenceDatabaseName(documentId, actorUserId, state.persistenceGeneration),
            persistenceDoc,
          );
        } else {
          const { IndexeddbPersistence } = await import('y-indexeddb');
          state.idbProvider = new IndexeddbPersistence(
            persistenceDatabaseName(documentId, actorUserId, state.persistenceGeneration),
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
    if (supabase) {
      const { data, error } = await withCloudRequest(
        state,
        supabase
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
      await loadLegacyPersistenceCandidate(state);
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
      await reconcileLegacyLocalState(state);
    }
    // The provider is attached to a detached Y.Doc so pre-open bytes can be
    // authorized safely. Once reconciliation is complete, mirror subsequent
    // live updates into that detached actor-scoped persistence document.
    attachLocalPersistenceMirror(state);

    // --- observe local mutations → append to the durable log ---
    state.onDocUpdate = (update, origin, _doc, transaction) => {
      if (state.destroyed || state.deleted) return;
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
  if (mapName === ANNOTATIONS_MAP) return getAnnotationAuthorId(decodeAnnotationEntry(value)?.o);
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
          else copyDurableMapValue(map, entry.key, entry.value);
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
  const clientSeq = Number(row?.client_seq);
  if (
    actorUserId !== String(state.actorUserId)
    || !writerId
    || !Number.isFinite(clientSeq)
  ) return { record: null, collision: null };
  const record = [...state.appendRecords.values()].find((candidate) => (
    candidate.documentId === state.documentId
    && String(candidate.actorUserId) === actorUserId
    && candidate.writerId === writerId
    && Number(candidate.clientSeq) === clientSeq
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
  if (!record || record.status === 'accepted') return;
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
    // Durable now, but only in the snapshot: peers that already have the
    // document open read the WAL, never the snapshot. Re-send the exact bytes
    // under the same writer/seq (an exact replay is idempotent server-side)
    // so an offline edit reaches them once this screen is back online.
    queueLiveResend(state, record);
    await settleAcceptedRecord(state, record, record.update, { alreadyApplied: true });
  }
}

// The live re-send is best effort and bounded: the snapshot already makes the
// update durable for every later open. An update bigger than Realtime can
// carry (Postgres Changes ~1 MB) is never re-sent, and one that keeps failing
// is given up after LIVE_RESEND_MAX_ATTEMPTS tries or on a payload-too-large
// answer — never re-uploaded forever.
const LIVE_RESEND_MAX_BYTES = 900 * 1024;
const LIVE_RESEND_MAX_ATTEMPTS = 6;

function isPayloadTooLarge(error) {
  const code = String(error?.code || error?.status || '');
  return code === '413' || code === '54000'
    || /payload too large|request entity too large|too large|exceeds.*(size|limit)/i.test(String(error?.message || ''));
}

function queueLiveResend(state, record) {
  if (!state.supabase || !record?.update || record.writerId == null) return;
  if (record.update.length > LIVE_RESEND_MAX_BYTES) {
    console.warn('[annotationDocSync] snapshot-only update too large to re-send live', record.update.length);
    return;
  }
  state.liveResendQueue.push({
    writerId: String(record.writerId),
    clientSeq: Number(record.clientSeq),
    update: new Uint8Array(record.update),
    attempts: 0,
  });
  scheduleLiveResend(state);
}

function scheduleLiveResend(state, { delayed = false } = {}) {
  if (state.destroyed || state.deleted || state.liveResendQueue.length === 0) return;
  if (delayed) {
    if (state.liveResendTimer) return;
    const baseDelay = Math.max(1, Number(state.repairRetryDelayMs) || GAP_REPAIR_RETRY_MS);
    const delayMs = Math.min(
      GAP_REPAIR_RETRY_MAX_MS,
      baseDelay * (2 ** Math.min(state.liveResendAttempt, 5)),
    );
    state.liveResendTimer = setTimeout(() => {
      state.liveResendTimer = null;
      scheduleLiveResend(state);
    }, delayMs);
    state.liveResendTimer.unref?.();
    return;
  }
  state.liveResendChain = state.liveResendChain
    .then(() => flushLiveResend(state))
    .catch((error) => {
      console.warn('[annotationDocSync] live re-send failed', error?.message);
    });
}

async function flushLiveResend(state) {
  while (state.liveResendQueue.length > 0 && !state.destroyed && !state.deleted) {
    const item = state.liveResendQueue[0];
    item.attempts = (item.attempts || 0) + 1;
    try {
      await requestWalAppend(state, item);
      state.liveResendQueue.shift();
      state.liveResendAttempt = 0;
    } catch (error) {
      if (
        String(error?.code || '') === '23505'
        || isPermissionDenied(error)
        || isPayloadTooLarge(error)
        || item.attempts >= LIVE_RESEND_MAX_ATTEMPTS
      ) {
        // Already there under different bytes (never expected: one writer
        // never reuses a seq), or no longer permitted: the snapshot still
        // carries the edit for every later open. Nothing more to do live.
        console.warn('[annotationDocSync] live re-send dropped', error?.message);
        state.liveResendQueue.shift();
        continue;
      }
      state.liveResendAttempt += 1;
      scheduleLiveResend(state, { delayed: true });
      return;
    }
  }
}

async function applyAuthoritativeCloudRow(state, row) {
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
  }
  for (const update of updates) {
    Y.applyUpdate(state.doc, update, HYDRATE_ORIGIN);
    Y.applyUpdate(state.acceptedDoc, update, HYDRATE_ORIGIN);
    Y.applyUpdate(state.stagedDoc, update, HYDRATE_ORIGIN);
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
  // 1. snapshot baseline
  const { data: snapRow, error: snapshotError } = await withCloudRequest(
    state,
    supabase
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
      state.lastSeq = Number(snapRow.at_seq) || 0;
      state.replayFromSeq = state.lastSeq;
      state.snapshotBaseAtSeq = state.lastSeq;
      state.snapshotBaseWriterId = snapRow.writer_id ?? null;
      state.snapshotBaseWriterEpoch = Number(snapRow.writer_epoch) || 0;
      state.snapshotGeneration = Math.max(
        state.snapshotGeneration,
        state.snapshotBaseWriterEpoch,
      );
    }
  }
  // 2. tail ops after the snapshot, in order
  let cursor = state.lastSeq;
  for (;;) {
    const { data: rows, error } = await withCloudRequest(
      state,
      supabase
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
      cursor = Number(row.seq);
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
function catchUpTail(state) {
  state.catchupChain = state.catchupChain.then(async () => {
    if (state.destroyed || !state.supabase) return false;
    // PostgreSQL identity values are allocated before commit. A transaction
    // with seq=N can legally become visible after seq=N+1. Replaying from the
    // last accepted snapshot (rather than the last observed row) makes the
    // lower late commit visible on the next sweep; Yjs makes overlap free.
    let cursor = state.replayFromSeq;
    let applied = 0;
    for (;;) {
      let response;
      try {
        response = await withCloudRequest(
          state,
          state.supabase
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
          if (cursor > state.lastSeq) state.lastSeq = cursor;
          state.coveredSeq = cursor;
          if (applied > 0) notifyChange(state);
          return false;
        }
        cursor = Number(row.seq);
      }
      if (cursor > state.lastSeq) state.lastSeq = cursor;
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
  if (healthy && state.appendRecords?.size > 0) healthy = false;
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
  // Marks are nested maps: a field edit changes annotations[key].o, not the
  // root map, so collect the ROOT keys each changed type lives under.
  const liveRoots = DURABLE_MAP_NAMES.map((mapName) => state.doc.getMap(mapName));
  const changedByRoot = rootKeysChangedByTransaction(transaction, liveRoots);
  state.stagedDoc.transact(() => {
    for (const mapName of DURABLE_MAP_NAMES) {
      const live = state.doc.getMap(mapName);
      const staged = state.stagedDoc.getMap(mapName);
      const changedKeys = changedByRoot.get(live);
      if (!changedKeys) continue;
      const keys = changedKeys.has(null)
        ? new Set([...live.keys(), ...staged.keys()])
        : changedKeys;
      for (const key of keys) {
        if (!live.has(key)) {
          if (staged.has(key)) staged.delete(key);
        } else if (!mapValueEqual(staged.get(key), live.get(key))) {
          copyDurableMapValue(staged, key, live.get(key));
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
      if (String(error?.code || '') === '23505') {
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
  if (state.destroyed || state.deleted) return;
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
        if (!mapValueEqual(live.get(key), value)) copyDurableMapValue(live, key, value);
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
    key: [
      state.documentId,
      state.actorUserId,
      state.writerId,
      clientSeq,
    ].join('\u0000'),
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
      const snapshotResult = await writeSnapshot(state, {
        snapshotUpdate: checkpointUpdate,
        epoch: editEpoch,
        repairsGap: true,
        gapGeneration: state.repairCheckpointGeneration,
      }).catch(() => false);
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
  return state.outbox.put(durableRecord);
}

// One WAL row (exact bytes, writer/seq idempotency key). Throws on error.
async function requestWalAppend(state, { writerId, clientSeq, update }) {
  const row = {
    document_id: state.documentId,
    client_id: writerId,
    client_seq: clientSeq,
    data: bytesToPgHex(update),
  };
  let data;
  let error;
  if (typeof state.supabase.rpc === 'function') {
    ({ data, error } = await withCloudRequest(
      state,
      state.supabase.rpc('append_annotation_update', {
        p_document_id: row.document_id,
        p_client_id: row.client_id,
        p_client_seq: row.client_seq,
        p_data: row.data,
      }),
      'annotation WAL append',
    ));
  } else {
    ({ data, error } = await withCloudRequest(
      state,
      state.supabase
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
  return data;
}

async function appendOp(state, record) {
  if (state.destroyed || state.deleted) throw deletedDocumentError(state.documentId);
  const {
    update,
    checkpointUpdate,
    editEpoch,
  } = record;
  const data = await requestWalAppend(state, record);
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
  const assignedSeq = Number(rpcRow?.seq ?? rpcRow);
  if (Number.isFinite(assignedSeq)) {
    if (assignedSeq > state.lastSeq) state.lastSeq = assignedSeq;
    // The server-assigned immediate successor proves there is no unseen row
    // between the last contiguous baseline and this already-applied local op.
    if (assignedSeq === state.coveredSeq + 1) state.coveredSeq = assignedSeq;
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
  if (state.destroyed) return;
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
  state.snapshotChain = state.snapshotChain.then(() => writeSnapshotNow(state, options));
  return state.snapshotChain;
}

function isSnapshotConflict(error) {
  return String(error?.code || '') === '40001'
    || /stale annotation snapshot/i.test(error?.message || '');
}

async function loadLatestCloudCheckpoint(state) {
  const cloudDoc = createDetachedYDoc(
    `snapshot-refresh:${state.documentId}:${state.writerId}:${randomClientId()}`,
  );
  try {
    const { data: snapRow, error: snapshotError } = await withCloudRequest(
      state,
      state.supabase
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
      cursor = Number(snapRow.at_seq) || 0;
      baseAtSeq = cursor;
      baseWriterId = snapRow.writer_id ?? null;
      baseWriterEpoch = Number(snapRow.writer_epoch) || 0;
    }

    for (;;) {
      const { data: rows, error } = await withCloudRequest(
        state,
        state.supabase
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
        cursor = Number(row.seq);
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
    state.snapshotGeneration = Math.max(
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
} = {}) {
  const repairsGapAtStart = repairsGap ?? state.durabilityGap;
  const gapGenerationAtStart = gapGeneration ?? state.durabilityGapGeneration;
  if (!state.supabase) {
    return {
      ok: false,
      permissionDenied: false,
      containsUnacceptedPrefix: repairsGapAtStart,
      error: null,
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
  const atSeq = state.coveredSeq;
  const epochAtStart = epoch ?? (
    repairsGapAtStart ? state.repairCheckpointEpoch : state.acceptedEditEpoch
  );
  // `epochAtStart` tracks which local edits the bytes cover. Snapshot CAS needs
  // a separate document-wide generation: local edit epochs can repeat across
  // writers (A1 → B1 → A1), which would make a stale base token valid again.
  // Every non-idempotent attempt therefore consumes a value above the latest
  // snapshot generation observed from the backend.
  const snapshotGenerationAtStart = Math.max(
    state.snapshotGeneration,
    state.snapshotBaseWriterEpoch,
  ) + 1;
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
      if (typeof state.supabase.rpc === 'function') {
        let data;
        ({ data, error } = await withCloudRequest(
          state,
          state.supabase.rpc('store_annotation_snapshot', {
            p_document_id: state.documentId,
            p_at_seq: atSeq,
            p_snapshot: hex,
            p_encoding_version: SNAPSHOT_ENC_GZIP,
            p_writer_id: state.writerId,
            p_writer_epoch: snapshotGenerationAtStart,
            p_expected_at_seq: state.snapshotBaseAtSeq,
            p_expected_writer_id: state.snapshotBaseWriterId,
            p_expected_writer_epoch: state.snapshotBaseWriterEpoch,
          }),
          'annotation snapshot write',
        ));
        const rpcResult = Array.isArray(data) ? data[0] : data;
        accepted = rpcResult?.accepted ?? rpcResult ?? false;
      } else {
        // Compatibility path for older test doubles/dev backends. The
        // production RPC below performs this check atomically under a
        // per-document advisory lock.
        const { data: current } = await withCloudRequest(
          state,
          state.supabase
            .from('annotation_snapshots')
            .select('at_seq, writer_id, writer_epoch')
            .eq('document_id', state.documentId)
            .maybeSingle(),
          'annotation snapshot CAS read',
        );
        const currentSeq = Number(current?.at_seq);
        const currentEpoch = Number(current?.writer_epoch) || 0;
        const matchesLoadedBase = (
          (Number.isFinite(currentSeq) ? currentSeq : null) === state.snapshotBaseAtSeq
          &&
          (current?.writer_id ?? null) === state.snapshotBaseWriterId
          && currentEpoch === state.snapshotBaseWriterEpoch
        );
        if (
          Number.isFinite(currentSeq)
          && (
            currentSeq !== atSeq
            || !matchesLoadedBase
          )
        ) {
          accepted = false;
        }
        if (accepted) {
          ({ error } = await withCloudRequest(
            state,
            state.supabase
              .from('annotation_snapshots')
              .upsert({
                document_id: state.documentId,
                at_seq: atSeq,
                snapshot: hex,
                encoding_version: SNAPSHOT_ENC_GZIP,
                writer_id: state.writerId,
                writer_epoch: snapshotGenerationAtStart,
                base_at_seq: state.snapshotBaseAtSeq,
                base_writer_id: state.snapshotBaseWriterId,
                base_writer_epoch: state.snapshotBaseWriterEpoch,
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
        if (atSeq > state.replayFromSeq) state.replayFromSeq = atSeq;
        state.snapshotBaseAtSeq = atSeq;
        state.snapshotBaseWriterId = state.writerId;
        state.snapshotBaseWriterEpoch = snapshotGenerationAtStart;
        state.snapshotGeneration = Math.max(
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
        });
      }
      console.warn(`[annotationDocSync] snapshot write failed (attempt ${attempt})`, error.message);
    } catch (err) {
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
  const ch = state.supabase.channel(`anno-${state.documentId}-${randomClientId()}`);
  // Assign before wiring callbacks so a synchronous throw from .on()/.subscribe()
  // during a failed open is still cleanable by the teardown catch (removeChannel).
  state.realtimeChannel = ch;
  ch
    .on('postgres_changes', {
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
        if (Number(row.seq) > state.lastSeq) state.lastSeq = Number(row.seq);
        notifyChange(state);
        void queueEraseOutboxDrain(state);
      }).catch((err) => {
        console.warn('[annotationDocSync] remote apply failed', err?.message);
        markSyncHealth(state, false, err);
      });
    })
    .subscribe((status) => {
      // Fires on the initial join AND after every reconnect re-join. Each time,
      // sweep the log for ops that landed while we weren't listening.
      if (status === 'SUBSCRIBED') {
        const catchupGeneration = ++state.realtimeCatchupGeneration;
        state.realtimePhase = 'catching-up';
        notifySyncStatus(state);
        return catchUpTail(state).then(async (caughtUp) => {
          if (state.destroyed || catchupGeneration !== state.realtimeCatchupGeneration) return;
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
          if (state.destroyed || catchupGeneration !== state.realtimeCatchupGeneration) return;
          state.realtimePhase = 'ready';
          // Gap finalization owns health: success repairs it; denial/failure
          // must stay red. A plain catch-up can safely recover transport health.
          if (!hadDurabilityGap) markSyncHealth(state, true);
          notifySyncStatus(state);
          // Back online: anything only a snapshot carried goes out live now.
          scheduleLiveResend(state);
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
  recordViewerDelivery(state.viewer, byPage);
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
        });
    }
  }
  return values;
}

// The viewer's object for each eraser-lane-owned mark (one pass, no
// serialization — this runs on every capture of a document with lanes).
function laneOwnedViewerObjects(byPage, lanesByStorageKey) {
  const out = new Map();
  const resolveStorageKey = createAnnotationStorageKeyResolver();
  for (const [pageKey, page] of Object.entries(byPage || {})) {
    for (const object of page?.objects || []) {
      if (!object || typeof object !== 'object') continue;
      const storageKey = String(resolveStorageKey(object, Number(pageKey), extractAnnotationId(object)));
      if (!lanesByStorageKey.has(storageKey)) continue;
      out.set(storageKey, { pageNumber: Number(pageKey), object });
    }
  }
  return out;
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
    const resendQueue = state.liveResendChain;
    await Promise.all([
      flushQueue.catch(() => {}),
      replayQueue.catch(() => {}),
      authoritativeQueue.catch(() => {}),
      resendQueue.catch(() => {}),
    ]);
    await Promise.resolve();
    if (
      flushQueue === state.flushQueue
      && replayQueue === state.outboxReplayChain
      && authoritativeQueue === state.authoritativeChain
      && resendQueue === state.liveResendChain
      && !state.outboxReplayScheduled
    ) return;
  }
}

function makeHandle(state) {
  return {
    documentId: state.documentId,
    clientId: state.clientId,
    writerId: state.writerId,
    doc: state.doc,

    /** Current annotations in render shape (handed to the viewer). */
    getByPage() {
      const byPage = docToByPage(state.doc);
      state.lastByPage = byPage;
      recordViewerDelivery(state.viewer, byPage);
      return byPage;
    },

    /** Imported PDF-native annotations intentionally removed in app state. */
    getDeletedPdfAnnotations() {
      return docToDeletedPdfAnnotations(state.doc);
    },

    /**
     * Push the viewer's render-shape state into the doc. Only the viewer's
     * own edits are written, field by field (state.viewer tracks what the
     * viewer held; see createViewerCaptureState). Returns `reconcile` swaps
     * when the viewer's copy of a mark is behind the document.
     */
    applyByPage(byPage, opts = {}) {
      assertHandleWritable(state);
      const viewer = state.viewer;
      const identityNormalization = normalizeByPageAnnotationIdentities(byPage);
      byPage = identityNormalization.byPage;
      const hasEraserMutation = Object.values(byPage || {}).some((page) => page?.eraserMutation?.id);
      const laneBaseChanges = { added: 0, updated: 0, removed: 0 };
      if (!hasEraserMutation) {
        const lanesByStorageKey = new Map();
        getEraserOpsMap(state.doc).forEach((lane) => {
          if (lane?.storageKey == null) return;
          const key = String(lane.storageKey);
          if (!lanesByStorageKey.has(key)) lanesByStorageKey.set(key, []);
          lanesByStorageKey.get(key).push(lane);
        });
        if (lanesByStorageKey.size > 0) {
          const desired = laneOwnedViewerObjects(byPage, lanesByStorageKey);
          const annotations = getAnnotationsMap(state.doc);
          const deletedPdfAnnotations = getDeletedPdfAnnotationsMap(state.doc);
          state.doc.transact(() => {
            for (const [storageKey, lanes] of lanesByStorageKey) {
              const desiredRecord = desired.get(storageKey);
              const previousVisible = viewer.base.get(storageKey)?.object || null;
              // Selection delete removes only the stable base. Lanes remain so
              // restoring that base naturally reveals the prior erased state.
              if (!desiredRecord) {
                if (!viewer.had.has(storageKey) || !annotations.has(storageKey)) continue;
                const stored = readAnnotationEntry(state.doc, storageKey);
                const nativeId = stored?.o?.pdfAnnotationId;
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
              // The viewer's own previous copy, or the materialized survivor
              // it was just handed, is not an edit.
              if (
                previousVisible === desiredRecord.object
                || viewer.lastDelivered.get(storageKey) === desiredRecord.object
              ) continue;
              const stored = readAnnotationEntry(state.doc, storageKey);
              if (!stored && previousVisible) continue; // deleted by someone else
              const fallbackBase = lanes.find((lane) => lane?.base)?.base || null;
              const stableBase = stored?.o || fallbackBase || desiredRecord.object;
              // The copy this edit was made from: the viewer's previous copy,
              // or a survivor it was handed since, whichever has the same
              // visible geometry (a restyle must never bake erase geometry
              // into the stable base).
              const echoVersions = getViewerEchoVersions(viewer, storageKey);
              const candidates = [
                previousVisible,
                ...[...(echoVersions || [])].reverse(),
              ].filter(Boolean);
              const madeFrom = candidates.find((candidate) => (
                laneVisibleGeometryMatches(candidate, desiredRecord.object, stableBase)
              )) || previousVisible;
              const nextBase = madeFrom
                ? mergeLaneOwnedNormalEdit(
                  stableBase,
                  madeFrom,
                  desiredRecord.object,
                )
                : structuredClone(stableBase);
              writeAnnotationMark(state.doc, storageKey, desiredRecord.pageNumber, nextBase, {
                base: stored ? stored.o : undefined,
                basePage: stored?.p,
                echoVersions,
              });
              const nativeId = nextBase?.pdfAnnotationId;
              if (nativeId) {
                const tombstoneKey = deletedPdfAnnotationStorageKey(desiredRecord.pageNumber, nativeId);
                if (deletedPdfAnnotations.has(tombstoneKey)) deletedPdfAnnotations.delete(tombstoneKey);
              }
              if (stored) laneBaseChanges.updated += 1;
              else laneBaseChanges.added += 1;
            }
          }, opts.origin || 'local');
        }
      }
      const res = syncByPageToDoc(state.doc, byPage, {
        origin: 'local',
        eraserWriterId: state.writerId,
        viewer,
        ...opts,
      });
      state.lastByPage = byPage;
      for (const swap of res.reconcile || []) {
        if (swap.to) recordViewerObject(viewer, swap.key, swap.toPage ?? swap.pageKey, swap.to);
      }
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
        eraserWriterId: state.writerId,
        viewer: state.viewer,
        onlyPages: [String(pageNumber)],
      });
      const materialized = docToByPage(state.doc);
      state.lastByPage = materialized;
      recordViewerDelivery(state.viewer, materialized);
      return materialized[pageNumber] || { objects: [] };
    },

    /** Read a document-level meta value (e.g. the callouts list). */
    getMeta(key) { return getMetaValue(state.doc, key); },

    /** Write a document-level meta value (idempotent; coarse whole-value). */
    setMeta(key, value) {
      assertHandleWritable(state);
      return setMetaValue(state.doc, key, value, 'local');
    },

    /** Current survey markers as { [annotationId]: marker }. */
    getSurveyMarkers() { return docToSurveyMarkers(state.doc); },

    /** Push the survey-marker dict into the doc (minimal per-marker diff → ops). */
    applySurveyMarkers(markers, opts = {}) {
      assertHandleWritable(state);
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
          surveyMarkers: docToSurveyMarkers(state.doc),
        };
      }
      if (result.status !== 'committed' && result.status !== 'noop') return result;
      void queueEraseOutboxDrain(state);
      const byPage = docToByPage(state.doc);
      state.lastByPage = byPage;
      recordViewerDelivery(state.viewer, byPage);
      return {
        ...result,
        outbox: {
          status: state.eraseEffectConsumer ? 'scheduled' : 'unavailable',
          acknowledged: 0,
          pending: pendingEraseOutboxCount(state.doc, state.actorUserId),
        },
        historyQuarantineGeneration: quarantineGeneration,
        byPage,
        surveyMarkers: docToSurveyMarkers(state.doc),
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
      recordViewerDelivery(state.viewer, byPage);
      return {
        ...result,
        historyQuarantineGeneration: quarantineGeneration,
        byPage,
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
      recordViewerDelivery(state.viewer, byPage);
      return {
        ...result,
        byPage,
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
      // closePromise gates the observer before any awaited work completes.
      // Already-queued edits and this writer's pending effect receipts drain;
      // new edits belong only to the next viewer of the shared registry doc.
      unregisterActiveState(state);
      state.eraseOutboxClosing = true;
      clearEraseOutboxRetry(state);
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
      if (state.supabase) {
        try {
          const result = await writeSnapshot(state, captureSnapshotOptions(state));
          await finalizeSnapshotResult(state, result);
        } catch { /* */ }
      }
      // A final checkpoint can settle snapshot-only edits; give their live
      // re-send one attempt before the handle goes away.
      if (state.liveResendTimer) { clearTimeout(state.liveResendTimer); state.liveResendTimer = null; }
      scheduleLiveResend(state);
      await state.liveResendChain.catch(() => {});
      if (state.liveResendTimer) { clearTimeout(state.liveResendTimer); state.liveResendTimer = null; }
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
  const purgeError = deletedDocumentError(documentId);
  const activeStates = [...(ACTIVE_STATES.get(documentId) || [])];
  for (const state of activeStates) {
    state.deleted = true;
    state.destroyed = true;
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
          ) databaseNames.add(entry.name);
        }
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
