import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import {
  EMPTY_OUTBOX_RETRY,
  STUCK_THRESHOLD_MS,
  summarizeOutboxRetry,
} from '../src/services/annotationOutboxRetryView.js';

function pendingRecord(overrides = {}) {
  return {
    key: overrides.key || 'doc-a\u0000actor-a\u0000writer-a\u00001',
    documentId: overrides.documentId || 'doc-a',
    actorUserId: overrides.actorUserId || 'actor-a',
    writerId: 'writer-a',
    clientSeq: 1,
    ordinal: 1,
    status: 'pending',
    queuedAt: Date.now(),
    update: new Uint8Array([1]),
    ...overrides,
  };
}

test('empty outbox is not stuck, pending, or quarantined', () => {
  assert.deepEqual(summarizeOutboxRetry({ pending: [], quarantined: [] }), {
    stuckCount: 0,
    quarantinedAnnoIds: [],
    hasPending: false,
    pendingDocumentIds: [],
  });
  assert.equal(EMPTY_OUTBOX_RETRY.hasPending, false);
});

test('fresh pending records are pending but not stuck', () => {
  const snapshot = summarizeOutboxRetry({
    pending: [pendingRecord({ queuedAt: Date.now() - 5_000 })],
    now: Date.now(),
  });
  assert.equal(snapshot.hasPending, true);
  assert.equal(snapshot.stuckCount, 0);
  assert.deepEqual(snapshot.pendingDocumentIds, ['doc-a']);
});

test('offline leftover older than 30s is stuck and still retrying', () => {
  const snapshot = summarizeOutboxRetry({
    pending: [pendingRecord({ queuedAt: Date.now() - STUCK_THRESHOLD_MS - 1 })],
    now: Date.now(),
  });
  assert.equal(snapshot.hasPending, true);
  assert.equal(snapshot.stuckCount, 1);
});

test('missing queuedAt counts as already stuck', () => {
  const snapshot = summarizeOutboxRetry({
    pending: [pendingRecord({ queuedAt: undefined })],
    now: Date.now(),
  });
  assert.equal(snapshot.stuckCount, 1);
  assert.equal(snapshot.hasPending, true);
});

test('quarantined records keep the marker and drop out of pending/stuck', () => {
  const key = 'doc-a\u0000actor-a\u0000writer-a\u00009';
  const snapshot = summarizeOutboxRetry({
    pending: [pendingRecord({
      key,
      status: 'rejected',
      queuedAt: Date.now() - 60_000,
    })],
    quarantined: [pendingRecord({ key, status: 'rejected' })],
    now: Date.now(),
  });
  assert.equal(snapshot.hasPending, false);
  assert.equal(snapshot.stuckCount, 0);
  assert.deepEqual(snapshot.quarantinedAnnoIds, [key]);
});

test('entry.quarantined === true is treated as quarantined without a store row', () => {
  const snapshot = summarizeOutboxRetry({
    pending: [pendingRecord({
      key: 'anno-q',
      quarantined: true,
      queuedAt: Date.now() - 60_000,
    })],
    now: Date.now(),
  });
  assert.deepEqual(snapshot.quarantinedAnnoIds, ['anno-q']);
  assert.equal(snapshot.hasPending, false);
});

test('online replay: draining pending clears stuck and tab-dot state', () => {
  const record = pendingRecord({
    documentId: 'doc-b',
    queuedAt: Date.now() - 45_000,
  });
  const offline = summarizeOutboxRetry({ pending: [record], now: Date.now() });
  assert.equal(offline.hasPending, true);
  assert.equal(offline.stuckCount, 1);
  const replayed = summarizeOutboxRetry({ pending: [], quarantined: [] });
  assert.deepEqual(replayed.pendingDocumentIds, []);
  assert.equal(replayed.stuckCount, 0);
});

test('memory outbox lists by actor and quarantine skips pending', async () => {
  const outbox = createMemoryAnnotationOutbox();
  await outbox.put(pendingRecord({
    key: 'doc-a\u0000actor-a\u0000w\u00001',
    queuedAt: Date.now() - 40_000,
  }));
  await outbox.put(pendingRecord({
    key: 'doc-a\u0000actor-b\u0000w\u00001',
    actorUserId: 'actor-b',
  }));
  await outbox.markRejected(['doc-a\u0000actor-a\u0000w\u00001']);

  const pendingA = await outbox.listAllPendingForActor('actor-a');
  const quarantinedA = await outbox.listAllQuarantinedForActor('actor-a');
  const snapshot = summarizeOutboxRetry({
    pending: pendingA,
    quarantined: quarantinedA,
    now: Date.now(),
  });
  assert.equal(snapshot.hasPending, false);
  assert.equal(snapshot.quarantinedAnnoIds.length, 1);
  assert.equal((await outbox.listAllPendingForActor('actor-b')).length, 1);
});

test('hooks and live producers do not import crdtDualWriteQueue', () => {
  const hookFiles = [
    'src/hooks/useDualWriteQueue.js',
    'src/hooks/useTabPendingDualWrite.js',
    'src/components/collab/YDocProvider.jsx',
    'src/services/annotationCloudSync.js',
    'src/services/annotationOutboxRetryView.js',
  ];
  for (const rel of hookFiles) {
    const src = readFileSync(resolve(rel), 'utf8');
    assert.equal(
      src.includes("from '../lib/collab/crdtDualWriteQueue.js'")
        || src.includes("from '../../lib/collab/crdtDualWriteQueue.js'"),
      false,
      `${rel} must not import crdtDualWriteQueue`,
    );
  }
  assert.ok(existsSync(resolve('src/services/annotationOutboxRetryView.js')));
  const dual = readFileSync(resolve('src/hooks/useDualWriteQueue.js'), 'utf8');
  const tab = readFileSync(resolve('src/hooks/useTabPendingDualWrite.js'), 'utf8');
  assert.ok(dual.includes('summarizeOutboxRetry'));
  assert.ok(tab.includes('summarizeOutboxRetry'));
  assert.ok(tab.includes('return false'));
  assert.ok(tab.includes('entry.documentId'));
  assert.ok(/!\s*\w+\.quarantined/.test(tab));
});
