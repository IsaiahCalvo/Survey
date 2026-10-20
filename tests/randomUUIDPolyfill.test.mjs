import test from 'node:test';
import assert from 'node:assert/strict';

import {
  randomUUID,
  installRandomUUIDPolyfill,
} from '../src/utils/randomUUIDPolyfill.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('randomUUID returns an RFC4122 version-4 UUID', () => {
  assert.match(randomUUID(), UUID_RE);
});

test('installRandomUUIDPolyfill is a no-op when crypto.randomUUID already exists', () => {
  assert.equal(installRandomUUIDPolyfill(globalThis), true);
});

test('installRandomUUIDPolyfill creates crypto + randomUUID on a bare target', () => {
  const target = {};
  assert.equal(installRandomUUIDPolyfill(target), true);
  assert.match(target.crypto.randomUUID(), UUID_RE);
});

test('installRandomUUIDPolyfill fallback uses getRandomValues when present', () => {
  const target = {
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
        return bytes;
      },
    },
  };
  assert.equal(installRandomUUIDPolyfill(target), true);
  assert.match(target.crypto.randomUUID(), UUID_RE);
});

test('installRandomUUIDPolyfill fallback uses Math.random when getRandomValues is missing', () => {
  const target = { crypto: {} };
  assert.equal(installRandomUUIDPolyfill(target), true);
  assert.match(target.crypto.randomUUID(), UUID_RE);
});

test('randomUUID uses fallback when crypto.randomUUID is missing', () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        bytes.fill(7);
        return bytes;
      },
    },
  });
  try {
    assert.match(randomUUID(), UUID_RE);
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: original,
    });
  }
});

test('installRandomUUIDPolyfill returns false when crypto cannot be created', () => {
  const target = {};
  Object.defineProperty(target, 'crypto', {
    configurable: false,
    value: undefined,
    writable: false,
  });
  assert.equal(installRandomUUIDPolyfill(target), false);
});

test('installRandomUUIDPolyfill returns false when randomUUID cannot be defined', () => {
  const cryptoObject = {};
  Object.defineProperty(cryptoObject, 'randomUUID', {
    configurable: false,
    value: undefined,
    writable: false,
  });
  assert.equal(installRandomUUIDPolyfill({ crypto: cryptoObject }), false);
});
