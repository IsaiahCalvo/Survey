// src/services/rowIdSecretStore.js
//
// Durable per-document signing secret for the visible Excel "Row ID" token
// (rowIdToken.js / STAGE1-IDENTITY-PLAN.md). The token's HMAC is keyed by a
// per-document secret so a typo'd token fails verification (malformed) and a
// token pasted from another document never validates here. The secret lives in
// the app's durable store — NEVER in the workbook — so a recipient of the file
// alone cannot forge tokens.
//
// Mirrors excelSyncBaselineStore.js: localStorage-backed, fail-safe, keyed per
// document. Stored shape supports key rotation:
//   { current: "k1", keys: { "k1": "<base64 secret>", ... } }
// resolveDocumentSecret(documentId, keyId) returns the secret for a specific
// keyId (import path), or null → the matcher reports `rowid-key-unavailable`
// (a recoverable key problem, NOT a malformed token).

const KEY_PREFIX = 'rowIdSecret:';
const SECRET_BYTES = 32;

function getStorage(injected) {
  if (injected) return injected;
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage || null : null;
  } catch {
    // Accessing localStorage can throw (privacy mode, sandboxed iframe).
    return null;
  }
}

/** Stable storage key for a document. Null when the id is missing. */
export function secretKey(documentId) {
  if (!documentId) return null;
  return `${KEY_PREFIX}${documentId}`;
}

function randomSecretBase64() {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('rowIdSecretStore: secure RNG unavailable');
  }
  const bytes = new Uint8Array(SECRET_BYTES);
  cryptoObj.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  // btoa exists in browser + Node 20+. base64 is fine as an HMAC key string.
  return btoa(binary);
}

function readRecord(documentId, storage) {
  const key = secretKey(documentId);
  const store = getStorage(storage);
  if (!key || !store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.current || !parsed.keys) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRecord(documentId, record, storage) {
  const key = secretKey(documentId);
  const store = getStorage(storage);
  if (!key || !store) return false;
  try {
    store.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false; // quota / unavailable — non-fatal
  }
}

/**
 * Get the active signing secret for a document, minting + persisting one on first
 * use. Used by the EXPORT path to sign each Row ID token.
 * @returns {{keyId:string, secret:string}}
 * @throws if the document id is missing (callers must guard) or no storage exists
 *         AND no secret could be held — see note below.
 */
export function getOrCreateDocumentSecret(documentId, storage) {
  if (!documentId) throw new Error('rowIdSecretStore: documentId is required');

  const existing = readRecord(documentId, storage);
  if (existing) {
    const keyId = existing.current;
    const secret = existing.keys[keyId];
    if (secret) return { keyId, secret };
  }

  const keyId = 'k1';
  const secret = randomSecretBase64();
  const record = { current: keyId, keys: { [keyId]: secret } };
  // Best-effort persistence. If storage is unavailable the caller still gets a
  // usable secret for THIS export, but import on another load won't verify — that
  // surfaces as rowid-key-unavailable (review-only), never a silent wrong bind.
  writeRecord(documentId, record, storage);
  return { keyId, secret };
}

/**
 * Resolve the secret for a specific keyId (IMPORT path: classifyRowIdToken's
 * resolveSecret). Returns null when the key is unknown/unavailable.
 * @returns {string|null}
 */
export function resolveDocumentSecret(documentId, keyId, storage) {
  if (!documentId || !keyId) return null;
  const record = readRecord(documentId, storage);
  if (!record) return null;
  return record.keys[keyId] || null;
}

// Exposed for tests; not part of the public API.
export const __testing = { randomSecretBase64, KEY_PREFIX };
