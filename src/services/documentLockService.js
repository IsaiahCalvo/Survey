// src/services/documentLockService.js
// KAL-49 — v1 minimum-viable document lock state.
//
// Three responsibilities:
//   1. fetchDocumentLockState(documentId)  -> { lockedAt, lockedBy, lockedLabel }
//   2. lockDocument(documentId, label?)    -> updated documents row
//   3. unlockDocument(documentId)          -> updated documents row
//
// Owner-only enforcement lives in the RPCs themselves (SECURITY DEFINER with a
// hand-rolled ownership check). The UI shows or hides the Lock / Unlock action
// based on the viewer's role; even if a non-owner reached the RPC it would
// return a 42501 error and the annotation RLS would still keep the document
// frozen. Never trust the client.

import { supabase } from '../supabaseClient.js';

export function createDocumentLockStateSequence(onChange) {
  let realtimeGeneration = 0;
  return {
    snapshot() {
      return realtimeGeneration;
    },
    applyInitial(generation, state) {
      if (generation !== realtimeGeneration) return false;
      onChange(state);
      return true;
    },
    applyRealtime(state) {
      realtimeGeneration += 1;
      onChange(state);
    },
  };
}

/**
 * Read the lock columns off a document by id. Returns nulls when the document
 * is missing or RLS denies the read — caller treats `lockedAt == null` as
 * "not locked" either way.
 *
 * @param {string|null|undefined} documentId
 * @returns {Promise<{ lockedAt: string|null, lockedBy: string|null, lockedLabel: string|null }>}
 */
export async function fetchDocumentLockState(documentId, client = supabase) {
  if (!documentId || !client) {
    return { lockedAt: null, lockedBy: null, lockedLabel: null };
  }
  // Deliberately bypass documentMetadataResolver's 5s open-time cache. A
  // remote lock may have landed before this banner subscribed; an explicitly
  // fresh row read closes that missed-event window.
  const { data, error } = await client
    .from('documents')
    .select('locked_at, locked_by, locked_label')
    .eq('id', documentId)
    .maybeSingle();
  if (error || !data) {
    return { lockedAt: null, lockedBy: null, lockedLabel: null };
  }
  return {
    lockedAt: data.locked_at ?? null,
    lockedBy: data.locked_by ?? null,
    lockedLabel: data.locked_label ?? null,
  };
}

/**
 * Subscribe to lock-column updates for one open document. The database/RLS
 * remains authoritative; this only closes the local UI window between a
 * remote owner locking the document and the next reload.
 *
 * @param {string|null|undefined} documentId
 * @param {(state: { lockedAt: string|null, lockedBy: string|null, lockedLabel: string|null }) => void} onChange
 * @param {object} [client]
 * @returns {() => void}
 */
export function subscribeDocumentLockState(documentId, onChange, client = supabase) {
  if (!documentId || typeof onChange !== 'function' || typeof client?.channel !== 'function') {
    return () => {};
  }
  const channel = client
    .channel(`document-lock:${documentId}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'documents',
      filter: `id=eq.${documentId}`,
    }, (payload) => {
      const row = payload?.new;
      if (!row || row.id !== documentId) return;
      onChange({
        lockedAt: row.locked_at ?? null,
        lockedBy: row.locked_by ?? null,
        lockedLabel: row.locked_label ?? null,
      });
    })
    .subscribe();

  return () => {
    try { client.removeChannel?.(channel); } catch { /* best-effort teardown */ }
  };
}

/**
 * Lock a document via the owner-only RPC.
 *
 * @param {string} documentId
 * @param {string|null} [label]
 * @returns {Promise<{ data: any|null, error: any|null }>}
 */
export async function lockDocument(documentId, label = null) {
  if (!documentId) {
    return { data: null, error: new Error('lockDocument: documentId required') };
  }
  const { data, error } = await supabase.rpc('kal49_lock_document', {
    doc_id: documentId,
    label,
  });
  return { data: data ?? null, error: error ?? null };
}

/**
 * Unlock a document via the owner-only RPC.
 *
 * @param {string} documentId
 * @returns {Promise<{ data: any|null, error: any|null }>}
 */
export async function unlockDocument(documentId) {
  if (!documentId) {
    return { data: null, error: new Error('unlockDocument: documentId required') };
  }
  const { data, error } = await supabase.rpc('kal49_unlock_document', {
    doc_id: documentId,
  });
  return { data: data ?? null, error: error ?? null };
}
