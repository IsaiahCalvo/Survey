import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  secretKey,
  getOrCreateDocumentSecret,
  resolveDocumentSecret
} from '../rowIdSecretStore.js';
import { generateRowIdToken, classifyRowIdToken } from '../rowIdToken.js';

// Minimal in-memory localStorage-shaped mock.
const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
};

test('secretKey is null without a document id', () => {
  assert.equal(secretKey(''), null);
  assert.equal(secretKey(null), null);
  assert.equal(secretKey('doc-1'), 'rowIdSecret:doc-1');
});

test('getOrCreateDocumentSecret mints once and is stable thereafter', () => {
  const storage = makeStorage();
  const a = getOrCreateDocumentSecret('doc-1', storage);
  const b = getOrCreateDocumentSecret('doc-1', storage);
  assert.equal(a.keyId, 'k1');
  assert.ok(a.secret.length > 0);
  assert.equal(a.secret, b.secret, 'secret is persisted, not re-minted');
});

test('different documents get different secrets', () => {
  const storage = makeStorage();
  const a = getOrCreateDocumentSecret('doc-1', storage);
  const b = getOrCreateDocumentSecret('doc-2', storage);
  assert.notEqual(a.secret, b.secret);
});

test('resolveDocumentSecret returns the secret for the active keyId, null otherwise', () => {
  const storage = makeStorage();
  const { keyId, secret } = getOrCreateDocumentSecret('doc-1', storage);
  assert.equal(resolveDocumentSecret('doc-1', keyId, storage), secret);
  assert.equal(resolveDocumentSecret('doc-1', 'k2', storage), null); // unknown key
  assert.equal(resolveDocumentSecret('doc-unknown', keyId, storage), null); // unknown doc
});

test('end-to-end: a token signed with the document secret classifies as valid', async () => {
  const storage = makeStorage();
  const documentId = 'doc-1';
  const scopeId = 'mod-1:cat-1';
  const markerId = 'marker-7';
  const { keyId, secret } = getOrCreateDocumentSecret(documentId, storage);

  const token = await generateRowIdToken({ keyId, secret, documentId, scopeId, markerId });
  const result = await classifyRowIdToken(token, {
    documentId,
    scopeId,
    resolveSecret: (kid) => resolveDocumentSecret(documentId, kid, storage)
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.markerId, markerId);
});

test('a token from another document reads as key-unavailable when its secret is absent here', async () => {
  const storageA = makeStorage();
  const storageB = makeStorage();
  // doc-1 secret lives in storage A; importer (doc-1) uses storage B, which lacks it.
  const { keyId, secret } = getOrCreateDocumentSecret('doc-1', storageA);
  const token = await generateRowIdToken({ keyId, secret, documentId: 'doc-1', scopeId: 's', markerId: 'm' });
  const result = await classifyRowIdToken(token, {
    documentId: 'doc-1',
    scopeId: 's',
    resolveSecret: (kid) => resolveDocumentSecret('doc-1', kid, storageB)
  });
  assert.equal(result.status, 'key-unavailable');
});

test('minted secret is valid base64 of 32 bytes', () => {
  const storage = makeStorage();
  const { secret } = getOrCreateDocumentSecret('doc-1', storage);
  const decoded = Buffer.from(secret, 'base64');
  assert.equal(decoded.length, 32);
});
