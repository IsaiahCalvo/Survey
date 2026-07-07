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
import { getOrCreateYDoc, releaseYDoc } from '../lib/collab/ydocRegistry.js';
import {
  getAnnotationsMap,
  docToByPage,
  syncByPageToDoc,
  encodeSnapshot,
  getMetaValue,
  setMetaValue,
  docToSurveyMarkers,
  syncSurveyMarkersToDoc,
} from './annotationDocStore.js';

// The flat annotation store gets its OWN registry-managed Y.Doc, keyed apart
// from the legacy CRDT doc so the two never share a map. (The applyUpdate-only
// invariant requires all Y.Doc construction to live in the registry module.)
const REGISTRY_PREFIX = 'annoflat:';

const SNAPSHOT_AFTER_OPS = 40;      // compact to a fresh snapshot every N ops
const SNAPSHOT_DEBOUNCE_MS = 1200;  // after edits settle, write a full-state checkpoint
const SNAPSHOT_RETRIES = 4;         // the checkpoint is the durability guarantee — retry hard
const SNAPSHOT_ENC_GZIP = 2;        // encoding_version 2 = gzipped Y.encodeStateAsUpdate
const REMOTE_ORIGIN = 'remote';
const HYDRATE_ORIGIN = 'hydrate';

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
  enableLocal = true,
  enableRealtime = true,
  doc = null,
}) {
  if (!documentId) throw new Error('openAnnotationDoc: documentId required');

  // Default: a dedicated registry-managed Y.Doc for this document's flat store.
  const registryKey = `${REGISTRY_PREFIX}${documentId}`;
  const ownsRegistryDoc = !doc;
  const activeDoc = doc || getOrCreateYDoc(registryKey);

  const state = {
    documentId,
    registryKey,
    ownsRegistryDoc,
    supabase,
    clientId,
    doc: activeDoc,
    map: getAnnotationsMap(activeDoc),
    lastSeq: 0,            // highest annotation_updates.seq we've applied
    coveredSeq: 0,         // highest seq covered by a CONTIGUOUS read (hydrate or
                           // catch-up). Realtime events never advance this: a
                           // delivered seq N doesn't prove N-1 arrived, so the
                           // post-subscribe catch-up always re-reads from here.
    catchupChain: Promise.resolve(), // serializes catch-up reads across reconnects
    clientSeq: 0,          // our monotonic per-(doc,client) op counter
    opsSinceSnapshot: 0,
    lastByPage: null,      // last byPage applied — enables the per-page-ref fast diff
    snapshotTimer: null,   // debounced full-state checkpoint
    snapshotChain: Promise.resolve(false), // serializes ALL snapshot writes so two
                           // never overlap and clobber each other (debounce vs eager vs destroy)
    editEpoch: 0,          // bumped on every local edit
    snapshottedEpoch: 0,   // highest editEpoch a successful snapshot has captured;
                           // editEpoch > snapshottedEpoch ⇒ uncaptured work remains.
                           // A generation counter, NOT a boolean, so a stale in-flight
                           // snapshot that completes after a newer edit can't wrongly
                           // mark that newer edit as saved.
    destroyed: false,
    idbProvider: null,
    realtimeChannel: null,
    changeListeners: new Set(),
    syncListeners: new Set(),
    syncHealthy: true,     // false once an op append fails until it recovers (BL-24)
    onPageHide: null,      // window listener that force-checkpoints on real tab close
    flushQueue: Promise.resolve(),
  };

  // --- local instant durability (browser only) ---
  if (enableLocal && typeof indexedDB !== 'undefined') {
    try {
      const { IndexeddbPersistence } = await import('y-indexeddb');
      state.idbProvider = new IndexeddbPersistence(`anno-${documentId}`, activeDoc);
      await whenSynced(state.idbProvider);
    } catch (err) {
      console.warn('[annotationDocSync] indexeddb unavailable', err?.message);
    }
  }

  // --- seed the per-(doc,client) op counter so client_seq stays unique ---
  if (supabase) {
    const { data } = await supabase
      .from('annotation_updates')
      .select('client_seq')
      .eq('document_id', documentId)
      .eq('client_id', clientId)
      .order('client_seq', { ascending: false })
      .limit(1);
    if (data && data[0]) state.clientSeq = Number(data[0].client_seq) || 0;
  }

  // --- load snapshot + tail from the cloud ---
  if (supabase) await loadFromBackend(state);

  // --- observe local mutations → append to the durable log ---
  activeDoc.on('update', (update, origin) => {
    if (state.destroyed) return;
    // Ignore writes we didn't originate as user edits: remote ops, the initial
    // hydrate, and the local IndexedDB replay (re-appending those would loop).
    if (origin === REMOTE_ORIGIN || origin === HYDRATE_ORIGIN || origin === state.idbProvider) return;
    if (supabase) {
      state.editEpoch += 1;
      enqueueAppend(state, update);
      // The full-state checkpoint is the durability GUARANTEE: even if an
      // individual op insert fails (network), the next checkpoint re-captures
      // the whole doc from memory. Schedule it on every local edit.
      scheduleSnapshot(state);
    }
    // No notifyChange here: the viewer already holds the state it just produced.
    // Pushing it back would clobber per-page render metadata. Remote ops DO
    // notify (see subscribeRealtime).
  });

  // --- live multi-device: apply remote ops as they land ---
  if (enableRealtime && supabase && typeof supabase.channel === 'function') {
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
      if (state.destroyed || state.editEpoch === state.snapshottedEpoch) return;
      try { writeSnapshot(state); } catch { /* best-effort */ }
    };
    window.addEventListener('pagehide', state.onPageHide);
  }

  return makeHandle(state);
}

function whenSynced(provider) {
  return new Promise((resolve) => {
    if (provider.synced) return resolve();
    provider.once('synced', () => resolve());
    // safety: don't hang forever if the event is missed
    setTimeout(resolve, 3000);
  });
}

async function loadFromBackend(state) {
  const { supabase, documentId, doc } = state;
  // 1. snapshot baseline
  const { data: snapRow } = await supabase
    .from('annotation_snapshots')
    .select('snapshot, at_seq, encoding_version')
    .eq('document_id', documentId)
    .maybeSingle();
  if (snapRow && snapRow.snapshot) {
    let bytes = pgHexToBytes(snapRow.snapshot);
    if (snapRow.encoding_version === SNAPSHOT_ENC_GZIP) {
      try { bytes = await gunzip(bytes); } catch (err) { console.warn('[annotationDocSync] snapshot gunzip failed', err?.message); bytes = null; }
    }
    if (bytes) {
      Y.applyUpdate(doc, bytes, HYDRATE_ORIGIN);
      state.lastSeq = Number(snapRow.at_seq) || 0;
    }
  }
  // 2. tail ops after the snapshot, in order
  let cursor = state.lastSeq;
  for (;;) {
    const { data: rows, error } = await supabase
      .from('annotation_updates')
      .select('seq, data')
      .eq('document_id', documentId)
      .gt('seq', cursor)
      .order('seq', { ascending: true })
      .limit(1000);
    if (error) throw new Error(`tail read: ${error.message}`);
    const batch = rows || [];
    for (const row of batch) {
      Y.applyUpdate(doc, pgHexToBytes(row.data), HYDRATE_ORIGIN);
      cursor = Number(row.seq);
    }
    state.lastSeq = cursor;
    if (batch.length < 1000) break;
  }
  state.coveredSeq = cursor;
}

// Close the hydrate-vs-subscribe gap: Postgres realtime only forwards rows
// inserted AFTER the channel is live, so an op another device commits between
// our tail read and the SUBSCRIBED confirmation would otherwise stay invisible
// until the next full reopen. Whenever the channel (re)confirms SUBSCRIBED we
// re-read the log from coveredSeq. Y.applyUpdate is idempotent, so overlap with
// concurrently-delivered realtime events is harmless; reading from coveredSeq
// (never advanced by realtime) means an out-of-order realtime delivery can't
// make us skip an earlier missed op.
function catchUpTail(state) {
  state.catchupChain = state.catchupChain.then(async () => {
    if (state.destroyed || !state.supabase) return;
    let cursor = state.coveredSeq;
    let applied = 0;
    for (;;) {
      const { data: rows, error } = await state.supabase
        .from('annotation_updates')
        .select('seq, data, client_id')
        .eq('document_id', state.documentId)
        .gt('seq', cursor)
        .order('seq', { ascending: true })
        .limit(1000);
      if (error) {
        console.warn('[annotationDocSync] post-subscribe catch-up read failed', error.message);
        return; // coveredSeq untouched — the next SUBSCRIBED retries from here
      }
      const batch = rows || [];
      for (const row of batch) {
        cursor = Number(row.seq);
        if (row.client_id === state.clientId) continue; // our own op — already in the doc
        try {
          Y.applyUpdate(state.doc, pgHexToBytes(row.data), REMOTE_ORIGIN);
          applied += 1;
        } catch (err) {
          console.warn('[annotationDocSync] catch-up apply failed', err?.message);
        }
      }
      if (cursor > state.lastSeq) state.lastSeq = cursor;
      state.coveredSeq = cursor;
      if (batch.length < 1000) break;
    }
    if (applied > 0) notifyChange(state);
  }).catch((err) => {
    console.warn('[annotationDocSync] catch-up failed', err?.message);
  });
  return state.catchupChain;
}

// Notify sync-health listeners when the durable-append path flips between
// healthy and failing, deduped so we only emit on an actual transition (BL-24).
function markSyncHealth(state, healthy, error) {
  if (state.syncHealthy === healthy) return;
  state.syncHealthy = healthy;
  const status = { healthy, error: healthy ? null : (error?.message || String(error || 'sync failed')) };
  for (const cb of state.syncListeners) {
    try { cb(status); } catch (err) { console.warn('[annotationDocSync] sync listener threw', err?.message); }
  }
}

// Serialize appends so client_seq increments cleanly and ordering is stable.
function enqueueAppend(state, update) {
  state.flushQueue = state.flushQueue.then(() => appendOp(state, update)).catch(async (err) => {
    // The individual op insert failed (usually network). The mutation is already
    // applied to the in-memory doc, so an eager full-state checkpoint captures it
    // durably NOW instead of waiting up to SNAPSHOT_DEBOUNCE_MS and hoping the tab
    // survives — this is BL-24's fix: a dropped op no longer relies on the debounce
    // + a clean unmount. Also surface the failure so the UI can stop claiming
    // "saved" while writes are failing.
    console.warn('[annotationDocSync] append failed — forcing checkpoint', err?.message);
    markSyncHealth(state, false, err);
    if (state.snapshotTimer) { clearTimeout(state.snapshotTimer); state.snapshotTimer = null; }
    const ok = await writeSnapshot(state).catch(() => false);
    if (ok) markSyncHealth(state, true);
  });
  return state.flushQueue;
}

async function appendOp(state, update) {
  if (state.destroyed) return;
  state.clientSeq += 1;
  const row = {
    document_id: state.documentId,
    client_id: state.clientId,
    client_seq: state.clientSeq,
    data: bytesToPgHex(update),
  };
  const { data, error } = await state.supabase
    .from('annotation_updates')
    .insert(row)
    .select('seq')
    .single();
  if (error) {
    // 23505 = unique violation: this op already committed (reconnect re-send) → no-op.
    if (error.code === '23505') { markSyncHealth(state, true); return; }
    throw new Error(error.message);
  }
  // A successful append means the durable path is healthy again after any prior
  // failure (BL-24 recovery signal).
  markSyncHealth(state, true);
  // Advance our log position so snapshots record the correct at_seq and a reopen
  // doesn't needlessly replay ops already folded into the snapshot.
  const assignedSeq = Number(data?.seq);
  if (Number.isFinite(assignedSeq) && assignedSeq > state.lastSeq) state.lastSeq = assignedSeq;
  state.opsSinceSnapshot += 1;
  if (state.opsSinceSnapshot >= SNAPSHOT_AFTER_OPS) {
    state.opsSinceSnapshot = 0;
    await writeSnapshot(state);
  }
}

// Debounce a full-state checkpoint after edits settle. Cheap to call on every op.
function scheduleSnapshot(state) {
  if (state.destroyed) return;
  if (state.snapshotTimer) clearTimeout(state.snapshotTimer);
  state.snapshotTimer = setTimeout(() => {
    state.snapshotTimer = null;
    writeSnapshot(state);
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
function writeSnapshot(state) {
  state.snapshotChain = state.snapshotChain.then(() => writeSnapshotNow(state));
  return state.snapshotChain;
}

// Write the full Y.Doc as one idempotent checkpoint. Retries hard — this is the
// durability guarantee that makes dropped op inserts self-heal on next open.
async function writeSnapshotNow(state) {
  if (!state.supabase) return false;
  // Capture at_seq AND the edit generation BEFORE encoding (same synchronous
  // tick as encodeSnapshot, no await between). at_seq can then never claim an op
  // not in these bytes; and epochAtStart records exactly which edits these bytes
  // cover, so a stale in-flight snapshot that finishes AFTER a newer edit only
  // advances snapshottedEpoch to what it actually captured — it can't mark the
  // newer edit as saved and suppress the tab-close flush for it.
  const atSeq = state.lastSeq;
  const epochAtStart = state.editEpoch;
  let hex;
  try {
    hex = bytesToPgHex(await gzip(encodeSnapshot(state.doc)));
  } catch (err) {
    console.warn('[annotationDocSync] snapshot gzip failed, storing raw', err?.message);
    return false;
  }
  for (let attempt = 1; attempt <= SNAPSHOT_RETRIES; attempt += 1) {
    try {
      const { error } = await state.supabase
        .from('annotation_snapshots')
        .upsert({
          document_id: state.documentId,
          at_seq: atSeq,
          snapshot: hex,
          encoding_version: SNAPSHOT_ENC_GZIP,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'document_id' });
      if (!error) {
        // Only advance the captured generation — never regress it — so a stale
        // snapshot completing late can't clear a newer edit's dirty state.
        if (epochAtStart > state.snapshottedEpoch) state.snapshottedEpoch = epochAtStart;
        return true;
      }
      console.warn(`[annotationDocSync] snapshot write failed (attempt ${attempt})`, error.message);
    } catch (err) {
      console.warn(`[annotationDocSync] snapshot threw (attempt ${attempt})`, err?.message);
    }
    if (attempt < SNAPSHOT_RETRIES) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  return false;
}

function subscribeRealtime(state) {
  const ch = state.supabase
    .channel(`anno-${state.documentId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'annotation_updates',
      filter: `document_id=eq.${state.documentId}`,
    }, (payload) => {
      const row = payload.new;
      if (!row || row.client_id === state.clientId) return; // skip our own echoes
      try {
        Y.applyUpdate(state.doc, pgHexToBytes(row.data), REMOTE_ORIGIN);
        if (Number(row.seq) > state.lastSeq) state.lastSeq = Number(row.seq);
        notifyChange(state);
      } catch (err) {
        console.warn('[annotationDocSync] remote apply failed', err?.message);
      }
    })
    .subscribe((status) => {
      // Fires on the initial join AND after every reconnect re-join. Each time,
      // sweep the log for ops that landed while we weren't listening.
      if (status === 'SUBSCRIBED') catchUpTail(state);
    });
  state.realtimeChannel = ch;
}

function notifyChange(state) {
  const byPage = docToByPage(state.doc);
  for (const cb of state.changeListeners) {
    try { cb(byPage); } catch (err) { console.warn('[annotationDocSync] listener threw', err?.message); }
  }
}

function makeHandle(state) {
  return {
    documentId: state.documentId,
    clientId: state.clientId,
    doc: state.doc,

    /** Current annotations in render shape. */
    getByPage() { return docToByPage(state.doc); },

    /** Push the viewer's render-shape state into the doc (minimal diff → ops). */
    applyByPage(byPage, opts = {}) {
      const res = syncByPageToDoc(state.doc, byPage, { origin: 'local', prevByPage: state.lastByPage, ...opts });
      state.lastByPage = byPage;
      return res;
    },

    /** Read a document-level meta value (e.g. the callouts list). */
    getMeta(key) { return getMetaValue(state.doc, key); },

    /** Write a document-level meta value (idempotent; coarse whole-value). */
    setMeta(key, value) { return setMetaValue(state.doc, key, value, 'local'); },

    /** Current survey markers as { [annotationId]: marker }. */
    getSurveyMarkers() { return docToSurveyMarkers(state.doc); },

    /** Push the survey-marker dict into the doc (minimal per-marker diff → ops). */
    applySurveyMarkers(markers, opts = {}) { return syncSurveyMarkersToDoc(state.doc, markers, { origin: 'local', ...opts }); },

    /** Subscribe to changes (local or remote). Returns an unsubscribe fn. */
    onChange(cb) { state.changeListeners.add(cb); return () => state.changeListeners.delete(cb); },

    /** True while durable op appends are succeeding; false after one fails until
     *  it recovers. Lets the viewer stop showing "saved" when writes are failing. */
    isSyncHealthy() { return state.syncHealthy; },

    /** Subscribe to sync-health transitions ({ healthy, error }). Returns an
     *  unsubscribe fn. Fires only on an actual healthy⇄failing transition. */
    onSyncStatus(cb) { state.syncListeners.add(cb); return () => state.syncListeners.delete(cb); },

    /** Force a compacted snapshot now (e.g. on explicit save). */
    flushSnapshot() { return writeSnapshot(state); },

    /** Wait until all queued appends have hit the backend. */
    async drain() { await state.flushQueue; },

    async destroy() {
      if (state.snapshotTimer) { clearTimeout(state.snapshotTimer); state.snapshotTimer = null; }
      if (state.onPageHide && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pagehide', state.onPageHide);
        state.onPageHide = null;
      }
      // Final checkpoint before teardown so the latest state is durable even if a
      // debounce was still pending. (Mark destroyed AFTER, so the write proceeds.)
      await state.flushQueue.catch(() => {});
      if (state.supabase) { try { await writeSnapshot(state); } catch { /* */ } }
      state.destroyed = true;
      if (state.realtimeChannel) { try { await state.supabase.removeChannel(state.realtimeChannel); } catch { /* */ } }
      if (state.idbProvider) { try { state.idbProvider.destroy(); } catch { /* */ } }
      // Release the registry doc (the registry never destroys — keeps undo/state
      // across reopen). Only destroy a doc we were explicitly handed (tests).
      if (state.ownsRegistryDoc) releaseYDoc(state.registryKey);
      else { try { state.doc.destroy(); } catch { /* */ } }
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
  const registryKey = `${REGISTRY_PREFIX}${documentId}`;
  try {
    const doc = getOrCreateYDoc(registryKey);
    doc.transact(() => {
      getAnnotationsMap(doc).clear();
      doc.getMap('annoMeta').clear();
    }, HYDRATE_ORIGIN);
    releaseYDoc(registryKey);
  } catch { /* */ }
  try {
    if (typeof indexedDB !== 'undefined') {
      // The flat-annotation y-indexeddb store...
      indexedDB.deleteDatabase(`anno-${documentId}`);
      // ...and the legacy Phase-27 CRDT collab store (ydocLifecycle keys its
      // IndexedDB by the raw document UUID). Both must go or a same-content
      // re-upload (which dedups to the same id) could resurrect old marks.
      indexedDB.deleteDatabase(documentId);
    }
  } catch { /* */ }
  try {
    // Drop any pending offline sync ops for this doc so a deleted document's
    // retries can never re-fire (the row is gone; they'd 404 forever otherwise).
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`cloudSyncQueue_${documentId}`);
    }
  } catch { /* */ }
}

export const __test = { bytesToPgHex, pgHexToBytes };
