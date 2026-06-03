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

import { supabase } from '../supabaseClient';
import { resolveDocumentMetadata } from './documentMetadataResolver.js';

/**
 * Read the lock columns off a document by id. Returns nulls when the document
 * is missing or RLS denies the read — caller treats `lockedAt == null` as
 * "not locked" either way.
 *
 * @param {string|null|undefined} documentId
 * @returns {Promise<{ lockedAt: string|null, lockedBy: string|null, lockedLabel: string|null }>}
 */
export async function fetchDocumentLockState(documentId) {
  if (!documentId) {
    return { lockedAt: null, lockedBy: null, lockedLabel: null };
  }
  const meta = await resolveDocumentMetadata(documentId);
  return {
    lockedAt: meta.lockedAt,
    lockedBy: meta.lockedBy,
    lockedLabel: meta.lockedLabel,
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
