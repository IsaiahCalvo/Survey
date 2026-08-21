import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { retryActiveOutboxes } from '../src/services/annotationDocSync.js';

const providerSrc = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/collab/YDocProvider.jsx'),
  'utf8',
);

test('P2-02 wiring: stuck-banner Retry now calls retryActiveOutboxes', () => {
  assert.match(providerSrc, /retryActiveOutboxes/);
  assert.match(providerSrc, /documentId: docId/);
  assert.match(providerSrc, /actorUserId: userId/);
  assert.doesNotMatch(providerSrc, /from '\.\.\/\.\.\/lib\/collab\/crdtDualWriteQueue\.js'/);
  assert.doesNotMatch(providerSrc, /drainQueue\(/);
  assert.doesNotMatch(providerSrc, /__crdtForceLegacyFail/);
});

test('collab-ux wiring: access-removed banner outranks sign-in expiry', () => {
  assert.match(providerSrc, /storageStateAfterSignedOut/);
  assert.match(providerSrc, /storageStateAfterResignIn/);
  assert.match(providerSrc, /storageStateWhenAccessRevoked/);
  assert.match(providerSrc, /accessRevokedRef/);
});

test('collab-ux wiring: Restore\\? uses live interaction seams', () => {
  assert.match(providerSrc, /isLocallyInteractingWith/);
  assert.doesNotMatch(
    providerSrc,
    /interactionState\.selectedId === annoId/,
  );
});

test('retryActiveOutboxes no-ops when no annotation-doc handle is mounted', async () => {
  const result = await retryActiveOutboxes({
    documentId: 'doc-missing-handle',
    actorUserId: 'actor-missing',
  });
  assert.deepEqual(result, { retried: 0 });
});
