import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROWID_TOKEN_VERSION,
  generateRowIdToken,
  parseRowIdToken,
  verifyRowIdSignature,
  classifyRowIdToken,
  __testing
} from '../rowIdToken.js';

const SECRET = 'per-document-secret-AAA';
const OTHER_SECRET = 'per-document-secret-BBB';
const DOC = 'doc-123';
const SCOPE = 'module-7:category-3';
const MARKER = 'marker-abc-001';

const base = { keyId: 'k1', secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: MARKER };
const resolveSecret = (keyId) => (keyId === 'k1' ? SECRET : null);

test('base32url round-trips arbitrary unicode ids', () => {
  for (const id of ['marker-abc-001', 'módulo-π-✓', '550e8400-e29b-41d4-a716-446655440000', 'a', '日本語']) {
    assert.equal(__testing.decodeId(__testing.encodeId(id)), id);
  }
});

test('generated token has the v1 grammar shape (6 dot-separated parts)', async () => {
  const token = await generateRowIdToken(base);
  const parts = token.split('.');
  assert.equal(parts.length, 6);
  assert.equal(parts[0], ROWID_TOKEN_VERSION);
  assert.equal(parts[1], 'k1');
});

test('generation is deterministic for identical inputs, distinct per marker', async () => {
  assert.equal(await generateRowIdToken(base), await generateRowIdToken(base));
  assert.notEqual(await generateRowIdToken(base), await generateRowIdToken({ ...base, markerId: 'marker-abc-002' }));
  assert.notEqual(await generateRowIdToken(base), await generateRowIdToken({ ...base, scopeId: 'other:scope' }));
  assert.notEqual(await generateRowIdToken(base), await generateRowIdToken({ ...base, documentId: 'doc-999' }));
});

test('parse decodes the id parts without verifying the signature', async () => {
  const parsed = parseRowIdToken(await generateRowIdToken(base));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.documentId, DOC);
  assert.equal(parsed.scopeId, SCOPE);
  assert.equal(parsed.markerId, MARKER);
  assert.equal(parsed.keyId, 'k1');
});

test('round-trip: generate then classify yields a valid match with the marker id', async () => {
  const token = await generateRowIdToken(base);
  const result = await classifyRowIdToken(token, { documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.deepEqual(result, { status: 'valid', markerId: MARKER, keyId: 'k1' });
});

test('verifyRowIdSignature is true for the right secret, false for the wrong one', async () => {
  const parsed = parseRowIdToken(await generateRowIdToken(base));
  assert.equal(await verifyRowIdSignature(parsed, SECRET), true);
  assert.equal(await verifyRowIdSignature(parsed, OTHER_SECRET), false);
});

test('tampering any character breaks the signature → malformed', async () => {
  const token = await generateRowIdToken(base);
  // flip the last hmac character to a different base32 symbol
  const last = token.slice(-1);
  const swapped = last === 'A' ? 'B' : 'A';
  const tampered = token.slice(0, -1) + swapped;
  const result = await classifyRowIdToken(tampered, { documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(result.status, 'malformed');
});

test('a token forged with a different secret is malformed (bad signature)', async () => {
  const forged = await generateRowIdToken({ ...base, secret: OTHER_SECRET });
  const result = await classifyRowIdToken(forged, { documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(result.status, 'malformed');
});

test('document mismatch is classified foreign BEFORE the secret is ever resolved', async () => {
  const token = await generateRowIdToken(base); // signed for DOC
  let resolverCalled = false;
  const spyResolve = (keyId) => { resolverCalled = true; return resolveSecret(keyId); };
  const result = await classifyRowIdToken(token, { documentId: 'a-different-doc', scopeId: SCOPE, resolveSecret: spyResolve });
  assert.equal(result.status, 'foreign');
  assert.equal(result.documentId, DOC);
  assert.equal(resolverCalled, false, 'foreign tokens must not require the foreign document secret');
});

test('valid signature but wrong scope → wrong-scope (authenticated, trustworthy)', async () => {
  const token = await generateRowIdToken(base); // scope = SCOPE
  const result = await classifyRowIdToken(token, { documentId: DOC, scopeId: 'module-9:category-1', resolveSecret });
  assert.equal(result.status, 'wrong-scope');
  assert.equal(result.scopeId, SCOPE);
});

test('unknown keyId (no secret available) → key-unavailable, not malformed', async () => {
  const token = await generateRowIdToken({ ...base, keyId: 'k2' });
  // resolver only knows k1, so k2 has no secret
  const result = await classifyRowIdToken(token, { documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.equal(result.status, 'key-unavailable');
  assert.equal(result.keyId, 'k2');
});

test('an async resolveSecret is awaited', async () => {
  const token = await generateRowIdToken(base);
  const asyncResolve = async (keyId) => (keyId === 'k1' ? SECRET : null);
  const result = await classifyRowIdToken(token, { documentId: DOC, scopeId: SCOPE, resolveSecret: asyncResolve });
  assert.equal(result.status, 'valid');
  assert.equal(result.markerId, MARKER);
});

test('blank / whitespace-only / missing cell → blank', async () => {
  for (const blank of ['', '   ', '\t', null, undefined]) {
    const result = await classifyRowIdToken(blank, { documentId: DOC, scopeId: SCOPE, resolveSecret });
    assert.equal(result.status, 'blank');
  }
});

test('structurally broken tokens → malformed', async () => {
  const broken = [
    'not-a-token',
    'v1.k1.only.three.parts',
    'v1.k1.AAA.BBB.CCC.DDD.EEE', // 7 parts
    'v2.k1.AAA.BBB.CCC.DDD', // unsupported version
    'v1.has.dot.AAA.BBB.CCC.DDD', // keyId-region produces wrong part count
    'v1.k1.aaa.BBB.CCC.DDD' // lowercase id part is not valid base32
  ];
  for (const token of broken) {
    const result = await classifyRowIdToken(token, { documentId: DOC, scopeId: SCOPE, resolveSecret });
    assert.equal(result.status, 'malformed', `expected malformed for: ${token}`);
  }
});

test('generation rejects bad inputs', async () => {
  await assert.rejects(() => generateRowIdToken({ ...base, keyId: 'has.dot' }), /keyId/);
  await assert.rejects(() => generateRowIdToken({ ...base, keyId: '' }), /keyId/);
  await assert.rejects(() => generateRowIdToken({ ...base, secret: '' }), /secret/);
  await assert.rejects(() => generateRowIdToken({ ...base, markerId: '' }), /markerId/);
  await assert.rejects(() => generateRowIdToken({ ...base, documentId: undefined }), /documentId/);
});
