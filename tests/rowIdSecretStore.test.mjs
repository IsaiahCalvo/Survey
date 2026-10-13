import test from 'node:test';
import assert from 'node:assert/strict';

import {
  secretKey,
  getOrCreateDocumentSecret,
  resolveDocumentSecret,
  __testing,
} from '../src/services/rowIdSecretStore.js';

function makeStore(map = new Map()) {
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('secretKey and resolve/create round-trip', () => {
  assert.equal(secretKey(null), null);
  const s = makeStore();
  const first = getOrCreateDocumentSecret('doc-1', s);
  assert.equal(typeof first.keyId, 'string');
  assert.equal(typeof first.secret, 'string');
  assert.equal(resolveDocumentSecret('doc-1', first.keyId, s), first.secret);
  assert.equal(resolveDocumentSecret('doc-1', 'missing', s), null);
  assert.equal(resolveDocumentSecret(null, 'k1', s), null);
  const again = getOrCreateDocumentSecret('doc-1', s);
  assert.equal(again.secret, first.secret);
});

test('rowIdSecretStore tolerates corrupt/throwing storage', () => {
  assert.equal(resolveDocumentSecret('doc', 'k1', {
    getItem: () => '{bad',
    setItem() {},
  }), null);

  assert.equal(resolveDocumentSecret('doc', 'k1', {
    getItem: () => JSON.stringify({ current: 'k1' }),
    setItem() {},
  }), null);

  const boom = {
    getItem() { throw new Error('x'); },
    setItem() { throw new Error('x'); },
  };
  const minted = getOrCreateDocumentSecret('doc-boom', boom);
  assert.ok(minted.secret);

  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('blocked'); },
  });
  try {
    assert.throws(() => getOrCreateDocumentSecret(null), /documentId is required/);
    const ephemeral = getOrCreateDocumentSecret('doc-no-ls');
    assert.ok(ephemeral.secret);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
  }
});

test('randomSecretBase64 requires crypto.getRandomValues', () => {
  const saved = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    assert.throws(() => __testing.randomSecretBase64(), /secure RNG unavailable/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: saved });
  }
});
