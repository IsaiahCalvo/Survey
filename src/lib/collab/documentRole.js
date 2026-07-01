// src/lib/collab/documentRole.js
// 2026-07-01 — Viewer-role read-only gate. Pure-JS helpers resolving the
// caller's effective role on a document via the get_my_document_role RPC
// (supabase/migrations/20260701130000_get_my_document_role.sql — resolution
// order: creator > direct document_collaborators > project_collaborators >
// project creator; NULL when the caller has no access).
//
// Fail-open contract: any failure (missing client, network error, RPC error,
// unexpected payload) resolves to null — the UI keeps its current read-write
// presentation and the SERVER keeps enforcing writes (RLS + validator). A
// transient RPC hiccup must never lock the owner out of their own document;
// the worst case of failing open is the pre-existing behavior (viewer edits
// rejected server-side).
//
// Pure-JS module — zero React, zero DOM, zero browser globals. Node --test
// friendly, matching the permissionScope.js precedent in this folder.

// @ts-check

// Role strings the RPC is known to return. Anything else (malformed payload,
// a future role this build doesn't know) resolves to null = fail open.
export const KNOWN_DOCUMENT_ROLES = Object.freeze(['owner', 'editor', 'viewer']);

/**
 * Resolve the current user's effective role on a document.
 *
 * @param {{ rpc?: Function }|null|undefined} supabaseClient
 * @param {string|null|undefined} docId
 * @returns {Promise<'owner'|'editor'|'viewer'|null>} null on no access OR any error (fail open)
 */
export async function fetchMyDocumentRole(supabaseClient, docId) {
  if (!docId || typeof supabaseClient?.rpc !== 'function') return null;
  try {
    const { data, error } = await supabaseClient.rpc('get_my_document_role', {
      doc_id: docId,
    });
    if (error) return null;
    return KNOWN_DOCUMENT_ROLES.includes(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether (and why) the read-only presentation should be active.
 * Precedence: the Phase 28 revoked-access path wins over the viewer-role path —
 * an editor kicked out mid-session sees the revoked copy even if a later role
 * refetch would also report 'viewer'.
 *
 * @param {{ accessRevoked?: boolean, docRole?: string|null }} args
 * @returns {'revoked'|'viewer'|null} null = read-write (fail open)
 */
export function resolveReadOnlyReason({ accessRevoked, docRole } = {}) {
  if (accessRevoked) return 'revoked';
  if (docRole === 'viewer') return 'viewer';
  return null;
}
