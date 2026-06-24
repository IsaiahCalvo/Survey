// rowIdServerSecretClient.js — KAL-308a: resolve the per-document Row-ID signing
// secret from the SERVER (Supabase) instead of localStorage.
//
// Governing spec: PLAN-KAL308a.md (Codex-APPROVED). Model B: the secret lives
// server-side (rowid_signing_secrets, keyed by documents.id UUID); authorized
// editor/owner clients resolve it via the kal308a_* RPCs so the existing pure-JS
// rowIdToken.js keeps doing the HMAC unchanged. The token is identity-binding,
// not authorization — viewers/anon can never resolve the secret (RPC role-gated),
// so they can never forge a token.
//
//   • fetchOrCreateSigningSecret  — EXPORT path; mints if absent. Throws on
//                                   failure so the caller writes BLANK Row IDs
//                                   (never falls back to localStorage signing on a
//                                   registered doc — that would be Edge-unverifiable).
//   • fetchSigningSecret          — IMPORT/VERIFY path; read-only, never mints.
//                                   Returns null on no-key OR error → the matcher
//                                   reports key-unavailable → review (non-destructive).
//   • hasServerSigningKey         — PREFLIGHT; bool.
//
// All three return/sign over the FROZEN signing_doc_id stored at first mint, so
// the signing id is stable across PDF renames and matches what KAL-308's Edge
// checks the token's embedded documentId against.

import { supabase } from '../supabaseClient.js';

// Per-document memo: dedupes the parallel import resolution storm (the matcher
// classifies every row in Promise.all, each calling resolveSecret) down to ONE
// RPC. Only successful (non-null) resolutions are cached; nulls/errors are not,
// so a later mint or a retry can still succeed.
const secretCache = new Map();   // documentId -> { keyId, secret, signingDocId }
const inflightReads = new Map();  // documentId -> Promise<result|null>

function shapeRow(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.secret_b64 !== 'string' || row.secret_b64 === '') return null;
  return {
    keyId: row.key_id,
    secret: row.secret_b64,
    signingDocId: row.signing_doc_id,
  };
}

/**
 * EXPORT path. Get-or-create the server signing secret for a Supabase-backed doc.
 * Signs over the returned (frozen) signingDocId.
 * @param {string} documentId    Supabase documents.id UUID
 * @param {string} signingIdSeed canonical composite signing id, used ONLY on first mint
 * @param {{supabaseClient?:object}} [opts]
 * @returns {Promise<{keyId:string, secret:string, signingDocId:string}>}
 * @throws on missing args or RPC failure (caller must degrade to blank Row IDs)
 */
export async function fetchOrCreateSigningSecret(documentId, signingIdSeed, { supabaseClient } = {}) {
  if (!documentId) throw new Error('rowIdServerSecretClient: documentId required');
  if (!signingIdSeed) throw new Error('rowIdServerSecretClient: signingIdSeed required');
  const client = supabaseClient ?? supabase;
  if (!client) throw new Error('rowIdServerSecretClient: Supabase client not available');

  const { data, error } = await client.rpc('kal308a_get_or_create_signing_secret', {
    p_document_id: documentId,
    p_signing_id_seed: signingIdSeed,
  });
  if (error) {
    const err = new Error(`rowIdServerSecretClient.fetchOrCreate: ${error.message}`);
    err.code = error.code;
    throw err;
  }
  const result = shapeRow(data);
  if (!result) throw new Error('rowIdServerSecretClient: get_or_create returned unexpected shape');
  secretCache.set(documentId, result);
  return result;
}

/**
 * IMPORT/VERIFY path. Read-only resolve of the server signing secret. Memoized
 * per document so parallel matcher resolution fires one RPC. Returns null when no
 * server key exists OR on error (→ key-unavailable → review; never mints).
 * @param {string} documentId
 * @param {{supabaseClient?:object}} [opts]
 * @returns {Promise<{keyId:string, secret:string, signingDocId:string}|null>}
 */
export async function fetchSigningSecret(documentId, { supabaseClient } = {}) {
  if (!documentId) return null;
  if (secretCache.has(documentId)) return secretCache.get(documentId);
  if (inflightReads.has(documentId)) return inflightReads.get(documentId);

  const client = supabaseClient ?? supabase;
  const promise = (async () => {
    if (!client) return null;
    const { data, error } = await client.rpc('kal308a_get_signing_secret', {
      p_document_id: documentId,
    });
    if (error) return null; // offline / RPC failure → key-unavailable → review
    const result = shapeRow(data);
    if (result) secretCache.set(documentId, result); // cache only real hits
    return result;
  })();

  inflightReads.set(documentId, promise);
  try {
    return await promise;
  } finally {
    inflightReads.delete(documentId);
  }
}

/**
 * PREFLIGHT. Does the document have a server signing key?
 * @param {string} documentId
 * @param {{supabaseClient?:object}} [opts]
 * @returns {Promise<boolean>}
 * @throws on RPC failure (caller decides; a thrown error means "couldn't check")
 */
export async function hasServerSigningKey(documentId, { supabaseClient } = {}) {
  if (!documentId) return false;
  const client = supabaseClient ?? supabase;
  if (!client) throw new Error('rowIdServerSecretClient: Supabase client not available');
  const { data, error } = await client.rpc('kal308a_has_server_key', {
    p_document_id: documentId,
  });
  if (error) {
    const err = new Error(`rowIdServerSecretClient.hasServerKey: ${error.message}`);
    err.code = error.code;
    throw err;
  }
  return data === true;
}

/** Clear the per-document memo (tests; and after a deliberate re-export/rotation). */
export function clearSigningSecretCache(documentId) {
  if (documentId == null) {
    secretCache.clear();
    inflightReads.clear();
  } else {
    secretCache.delete(documentId);
    inflightReads.delete(documentId);
  }
}
