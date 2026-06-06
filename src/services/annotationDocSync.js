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
} from './annotationDocStore.js';

// The flat annotation store gets its OWN registry-managed Y.Doc, keyed apart
// from the legacy CRDT doc so the two never share a map. (The applyUpdate-only
// invariant requires all Y.Doc construction to live in the registry module.)
const REGISTRY_PREFIX = 'annoflat:';

const SNAPSHOT_AFTER_OPS = 40;      // compact to a fresh snapshot every N ops
const REMOTE_ORIGIN = 'remote';
const HYDRATE_ORIGIN = 'hydrate';

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
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `c-${Math.floor(Math.random() * 1e9).toString(36)}-${Date.now().toString(36)}`;
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
    clientSeq: 0,          // our monotonic per-(doc,client) op counter
    opsSinceSnapshot: 0,
    destroyed: false,
    idbProvider: null,
    realtimeChannel: null,
    changeListeners: new Set(),
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
    if (origin === REMOTE_ORIGIN || origin === HYDRATE_ORIGIN) return; // not our write
    if (supabase) enqueueAppend(state, update);
    notifyChange(state);
  });

  // --- live multi-device: apply remote ops as they land ---
  if (enableRealtime && supabase && typeof supabase.channel === 'function') {
    subscribeRealtime(state);
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
    .select('snapshot, at_seq')
    .eq('document_id', documentId)
    .maybeSingle();
  if (snapRow && snapRow.snapshot) {
    Y.applyUpdate(doc, pgHexToBytes(snapRow.snapshot), HYDRATE_ORIGIN);
    state.lastSeq = Number(snapRow.at_seq) || 0;
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
}

// Serialize appends so client_seq increments cleanly and ordering is stable.
function enqueueAppend(state, update) {
  state.flushQueue = state.flushQueue.then(() => appendOp(state, update)).catch((err) => {
    console.warn('[annotationDocSync] append failed (will retry on next op)', err?.message);
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
    if (error.code === '23505') return;
    throw new Error(error.message);
  }
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

async function writeSnapshot(state) {
  try {
    const snapshot = encodeSnapshot(state.doc);
    const { error } = await state.supabase
      .from('annotation_snapshots')
      .upsert({
        document_id: state.documentId,
        at_seq: state.lastSeq,
        snapshot: bytesToPgHex(snapshot),
        encoding_version: 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'document_id' });
    if (error) console.warn('[annotationDocSync] snapshot write failed', error.message);
  } catch (err) {
    console.warn('[annotationDocSync] snapshot threw', err?.message);
  }
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
    .subscribe();
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
      return syncByPageToDoc(state.doc, byPage, { origin: 'local', ...opts });
    },

    /** Subscribe to changes (local or remote). Returns an unsubscribe fn. */
    onChange(cb) { state.changeListeners.add(cb); return () => state.changeListeners.delete(cb); },

    /** Force a compacted snapshot now (e.g. on explicit save). */
    flushSnapshot() { return writeSnapshot(state); },

    /** Wait until all queued appends have hit the backend. */
    async drain() { await state.flushQueue; },

    async destroy() {
      state.destroyed = true;
      await state.flushQueue.catch(() => {});
      if (state.realtimeChannel) { try { await state.supabase.removeChannel(state.realtimeChannel); } catch { /* */ } }
      if (state.idbProvider) { try { state.idbProvider.destroy(); } catch { /* */ } }
      // Release the registry doc (the registry never destroys — keeps undo/state
      // across reopen). Only destroy a doc we were explicitly handed (tests).
      if (state.ownsRegistryDoc) releaseYDoc(state.registryKey);
      else { try { state.doc.destroy(); } catch { /* */ } }
    },
  };
}

export const __test = { bytesToPgHex, pgHexToBytes };
