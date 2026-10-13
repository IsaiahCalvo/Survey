import test from 'node:test';
import assert from 'node:assert/strict';

import { computeContentSha256 } from '../src/services/contentHash.js';

test('computeContentSha256 hashes Uint8Array bytes stably', async () => {
  const bytes = new TextEncoder().encode('survey-content-hash');
  const hex = await computeContentSha256(bytes);
  assert.match(hex, /^[0-9a-f]{64}$/);
  assert.equal(await computeContentSha256(bytes), hex);
});

test('computeContentSha256 accepts ArrayBuffer', async () => {
  const bytes = new TextEncoder().encode('array-buffer');
  const fromView = await computeContentSha256(bytes);
  const fromBuffer = await computeContentSha256(bytes.buffer);
  assert.equal(fromBuffer, fromView);
});

test('computeContentSha256 throws when SubtleCrypto is unavailable', async () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {},
  });
  try {
    await assert.rejects(
      () => computeContentSha256(new Uint8Array([1])),
      /SubtleCrypto unavailable/,
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: original,
    });
  }
});
