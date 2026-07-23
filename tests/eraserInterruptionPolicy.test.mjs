import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEraserInterruptionPolicy } from '../src/utils/eraserInterruptionPolicy.js';

test('locked plus viewer remains cancelled until both reasons clear', () => {
  assert.equal(resolveEraserInterruptionPolicy({
    documentLocked: true,
    docRole: 'viewer',
  }), 'cancel');
  assert.equal(resolveEraserInterruptionPolicy({
    documentLocked: false,
    docRole: 'viewer',
  }), 'cancel');
  assert.equal(resolveEraserInterruptionPolicy({
    documentLocked: false,
    docRole: 'editor',
  }), 'commit');
});

test('revoked plus locked remains cancelled when either reason clears first', () => {
  assert.equal(resolveEraserInterruptionPolicy({
    accessRevoked: true,
    documentLocked: true,
  }), 'cancel');
  assert.equal(resolveEraserInterruptionPolicy({
    accessRevoked: true,
    documentLocked: false,
  }), 'cancel');
  assert.equal(resolveEraserInterruptionPolicy({
    accessRevoked: false,
    documentLocked: true,
  }), 'cancel');
});
