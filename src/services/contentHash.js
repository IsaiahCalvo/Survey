// src/services/contentHash.js
//
// Content fingerprint for a PDF's bytes. Two uploads of the same file produce
// the same hash, which is how the app dedups documents (one document per unique
// content per project) and content-addresses storage — killing the
// duplicate/blank-document class of bugs at its root.
//
// Uses Web Crypto SubtleCrypto, available in the Electron renderer, the browser,
// and Node 20+ (globalThis.crypto.subtle), so the same code runs everywhere.

export async function computeContentSha256(bytes) {
  const view = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : (bytes?.buffer || bytes));
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('SubtleCrypto unavailable for content hashing');
  const digest = await subtle.digest('SHA-256', view);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i += 1) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
}
