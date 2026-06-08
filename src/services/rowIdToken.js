/**
 * rowIdToken.js — the visible Excel "Row ID" identity token (PLAN.md Amendment #10).
 *
 * A Row ID is a signed, scoped, tamper-evident token that ties one visible Excel
 * row to exactly one Survey Marker. It is the PRIMARY identity layer for Excel
 * import matching; the full-row fingerprint and the very-hidden _SurveyMetadata /
 * app sync record are the safety/backup layers (STAGE1-IDENTITY-PLAN.md).
 *
 * Grammar (v1):
 *   v1.<keyId>.<b32(documentId)>.<b32(scopeId)>.<b32(markerId)>.<b32(hmac)>
 * - Dot-separated. Every variable id part is base32url (RFC 4648, no padding) so a
 *   part can never contain the '.' delimiter and Excel never coerces it to a
 *   number/date. keyId is a constrained charset (no dots), left readable.
 * - <hmac> is HMAC-SHA-256 over the exact ASCII of the preceding parts ("the head",
 *   everything up to and including <b32(markerId)>), keyed by a per-document secret
 *   selected by <keyId> so keys can rotate.
 *
 * Crypto uses Web Crypto SubtleCrypto via globalThis.crypto.subtle — the same
 * cross-environment convention as contentHash.js (Electron renderer, browser,
 * Node 20+). Signing/verification are therefore async.
 *
 * This module is PURE: generation + structural parse + crypto verification +
 * classification only. It does NOT know about live markers, exported-token sets,
 * duplicates, or blank-row recovery — that is the import matcher's job (later slice).
 */

export const ROWID_TOKEN_VERSION = 'v1';

// RFC 4648 base32 alphabet (no padding). Uppercase + digits 2-7 only — transcription
// safe and free of the '.' delimiter.
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const B32_PATTERN = /^[A-Z2-7]+$/;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base32urlEncode = (bytes) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32_ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1; // keep only the residual low bits so `value` never overflows
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
};

const base32urlDecode = (str) => {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
};

const encodeId = (value) => base32urlEncode(textEncoder.encode(String(value)));
const decodeId = (encoded) => textDecoder.decode(base32urlDecode(encoded));

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`rowIdToken: ${label} must be a non-empty string`);
  }
};

const getSubtle = () => {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('SubtleCrypto unavailable for Row ID token signing');
  return subtle;
};

const importHmacKey = (secret, usages) =>
  getSubtle().importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);

const signHead = async (head, secret) => {
  const key = await importHmacKey(secret, ['sign']);
  const sig = await getSubtle().sign('HMAC', key, textEncoder.encode(head));
  return base32urlEncode(new Uint8Array(sig));
};

const verifyHead = async (head, hmacB32, secret) => {
  let sigBytes;
  try {
    sigBytes = base32urlDecode(hmacB32);
  } catch {
    return false;
  }
  const key = await importHmacKey(secret, ['verify']);
  // subtle.verify is constant-time and handles length mismatch internally.
  return getSubtle().verify('HMAC', key, sigBytes, textEncoder.encode(head));
};

/**
 * Build a signed Row ID token for one marker.
 * @returns {Promise<string>} the v1 token
 */
export const generateRowIdToken = async ({ keyId, secret, documentId, scopeId, markerId }) => {
  requireNonEmptyString(keyId, 'keyId');
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error('rowIdToken: keyId must match [A-Za-z0-9_-]+ (no dots)');
  }
  requireNonEmptyString(secret, 'secret');
  requireNonEmptyString(documentId, 'documentId');
  requireNonEmptyString(scopeId, 'scopeId');
  requireNonEmptyString(markerId, 'markerId');

  const head = `${ROWID_TOKEN_VERSION}.${keyId}.${encodeId(documentId)}.${encodeId(scopeId)}.${encodeId(markerId)}`;
  return `${head}.${await signHead(head, secret)}`;
};

/**
 * Structurally parse a token WITHOUT verifying its signature. Decodes the id parts.
 * Pure + synchronous. An empty/missing cell is `blank`, not malformed.
 * @returns {{ok:true, version, keyId, documentId, scopeId, markerId, hmac, head}}
 *        | {ok:false, reason:'blank'|'malformed'|'unsupported-version', version?}
 */
export const parseRowIdToken = (token) => {
  if (token == null) return { ok: false, reason: 'blank' }; // empty Excel cell reads as null/undefined
  if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const trimmed = token.trim();
  if (trimmed === '') return { ok: false, reason: 'blank' };

  const parts = trimmed.split('.');
  if (parts.length !== 6) return { ok: false, reason: 'malformed' };
  const [version, keyId, dDoc, dScope, dMarker, hmac] = parts;

  if (version !== ROWID_TOKEN_VERSION) return { ok: false, reason: 'unsupported-version', version };
  if (!KEY_ID_PATTERN.test(keyId)) return { ok: false, reason: 'malformed' };
  if (!B32_PATTERN.test(dDoc) || !B32_PATTERN.test(dScope) || !B32_PATTERN.test(dMarker) || !B32_PATTERN.test(hmac)) {
    return { ok: false, reason: 'malformed' };
  }

  try {
    return {
      ok: true,
      version,
      keyId,
      documentId: decodeId(dDoc),
      scopeId: decodeId(dScope),
      markerId: decodeId(dMarker),
      hmac,
      head: `${version}.${keyId}.${dDoc}.${dScope}.${dMarker}`
    };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
};

/**
 * Verify a parsed token's HMAC against a candidate secret (constant-time).
 * @returns {Promise<boolean>}
 */
export const verifyRowIdSignature = async (parsed, secret) => {
  if (!parsed || parsed.ok !== true || typeof secret !== 'string' || secret === '') return false;
  return verifyHead(parsed.head, parsed.hmac, secret);
};

/**
 * Classify a Row ID cell against the importing document/scope.
 *
 * Order matters and is fixed (STAGE1-IDENTITY-PLAN.md): parse → version → documentId
 * (read BEFORE the HMAC, so it is unauthenticated and used ONLY for the terminal
 * 'foreign' no-bind class) → resolve the signing secret by keyId → verify HMAC →
 * scopeId (now authenticated, so 'wrong-scope' is trustworthy).
 *
 * @param {string} token
 * @param {{documentId:string, scopeId:string,
 *          resolveSecret:(keyId:string)=>string|null|Promise<string|null>}} ctx
 * @returns {Promise<{status:'valid'|'blank'|'malformed'|'foreign'|'key-unavailable'|'wrong-scope',
 *           markerId?:string, keyId?:string, documentId?:string, scopeId?:string}>}
 */
export const classifyRowIdToken = async (token, { documentId, scopeId, resolveSecret } = {}) => {
  const parsed = parseRowIdToken(token);
  if (!parsed.ok) {
    if (parsed.reason === 'blank') return { status: 'blank' };
    return { status: 'malformed' }; // includes unsupported-version + structural failures
  }

  // documentId is read before HMAC verification — unauthenticated, terminal no-bind only.
  if (parsed.documentId !== documentId) {
    return { status: 'foreign', documentId: parsed.documentId, keyId: parsed.keyId };
  }

  const secret = typeof resolveSecret === 'function' ? await resolveSecret(parsed.keyId) : null;
  if (secret == null || secret === '') {
    return { status: 'key-unavailable', keyId: parsed.keyId };
  }

  if (!(await verifyRowIdSignature(parsed, secret))) {
    return { status: 'malformed', keyId: parsed.keyId };
  }

  // Signature valid → every part is now authenticated, so scopeId can be trusted.
  if (parsed.scopeId !== scopeId) {
    return { status: 'wrong-scope', scopeId: parsed.scopeId, keyId: parsed.keyId };
  }

  return { status: 'valid', markerId: parsed.markerId, keyId: parsed.keyId };
};

// Exposed for the round-trip / encoding tests; not part of the public token API.
export const __testing = { base32urlEncode, base32urlDecode, encodeId, decodeId };
