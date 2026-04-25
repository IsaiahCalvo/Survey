import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../src/utils/pdfNativeExport/index.js';

test('exports the expected public API', () => {
  assert.equal(typeof api.bakeAnnotationsIntoPdf, 'function');
  assert.equal(typeof api.registerAdapter, 'function');
  assert.equal(typeof api.getAdapter, 'function');
});

test('bakeAnnotationsIntoPdf throws not-implemented until Phase D', async () => {
  await assert.rejects(
    () => api.bakeAnnotationsIntoPdf(new Uint8Array(), {}),
    /not-implemented/,
  );
});

test('registerAdapter and getAdapter round-trip a stub adapter', () => {
  const stub = { toPdfAnnotation: () => ({}) };
  api.registerAdapter('__test_type__', stub);
  assert.equal(api.getAdapter('__test_type__'), stub);
  assert.equal(api.getAdapter('__missing__'), null);
});
