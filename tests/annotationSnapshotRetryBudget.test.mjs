import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentSurveyModelV2Fixture } from '../src/dev/documentSurveyModelV2Fixture.js';
import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { openAnnotationDoc, purgeAnnotationDoc } from '../src/services/annotationDocSync.js';
import { purgeYDoc } from '../src/lib/collab/ydocRegistry.js';

const pdf = () => new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate, message) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

const lazy = value => {
  const request = {
    setHeader() { return request; },
    abortSignal() { return request; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return request;
};

async function createHeldRepairScenario(t) {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const bundle = await backend.read();
  const outbox = await createAnnotationOutbox({ indexedDb: new IDBFactory() });
  const heldRepair = deferred();
  const snapshotCalls = [];
  let appendCalls = 0;
  let repairHeld = false;
  const client = {
    ...backend.client,
    rpc(name, params) {
      if (name === 'append_annotation_update_v3') {
        appendCalls += 1;
        return lazy({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
      }
      if (name === 'store_annotation_snapshot_v3') {
        snapshotCalls.push(structuredClone(params));
        if (snapshotCalls.length === 5) {
          repairHeld = true;
          return lazy(heldRepair.promise);
        }
        return lazy({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
      }
      return backend.client.rpc(name, params);
    },
  };
  const handle = await openAnnotationDoc({
    documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle,
    supabase: client,
    outboxStore: outbox,
    enableLocal: false,
    enableRealtime: false,
    writerId: `snapshot-lifecycle-${crypto.randomUUID()}`,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 100,
  });
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const controlledDelays = new Set([100, 200, 400, 800, 1600, 3200]);
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (!controlledDelays.has(Number(delay))) return nativeSetTimeout(callback, delay, ...args);
    const token = { controlledSnapshotRetryTimer: true, callback, args, delay: Number(delay), cleared: false };
    scheduled.push(token);
    return token;
  };
  globalThis.clearTimeout = token => {
    if (token?.controlledSnapshotRetryTimer) { token.cleared = true; return; }
    nativeClearTimeout(token);
  };
  const activeTimer = delay => scheduled.find(timer => !timer.cleared && timer.delay === delay);
  const activeTimers = () => scheduled.filter(timer => !timer.cleared);
  const fire = timer => {
    assert.ok(timer, 'expected a controlled retry timer');
    timer.cleared = true;
    return timer.callback(...timer.args);
  };

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    heldRepair.resolve({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
    try {
      await handle.destroy().catch(() => {});
      await outbox.close().catch(() => {});
      purgeYDoc(`annoflat:${backend.ids.documentId}:${backend.ids.actorUserId}:pdf-generation:${backend.ids.generationId}:content-model:2`);
      backend.destroy();
    } finally {
      globalThis.setTimeout = nativeSetTimeout;
      globalThis.clearTimeout = nativeClearTimeout;
    }
  };
  t.after(cleanup);

  handle.updateSurveyMarkers(markers => ({
    ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'held lifecycle repair' },
  }));
  await handle.drain();
  assert.equal(appendCalls, 1);
  assert.equal(snapshotCalls.length, 4);
  await until(() => scheduled.filter(timer => !timer.cleared && timer.delay === 100).length === 2,
    'repair and replay timers were not armed');
  const firstRepair = fire(activeTimer(100));
  await until(() => repairHeld, 'held repair did not reach the snapshot backend');

  return {
    backend,
    handle,
    outbox,
    heldRepair,
    firstRepair,
    snapshotCalls,
    activeTimers,
    cleanup,
  };
}

test('snapshot repair retry budget', async t => {
  await t.test('one repair retry cycle stays in flight while the same record replay fails again', async t => {
  const backend = await createDocumentSurveyModelV2Fixture({ pdfBlob: pdf() });
  const bundle = await backend.read();
  const indexedDb = new IDBFactory();
  const outbox = await createAnnotationOutbox({ indexedDb });
  const heldRepair = deferred();
  const snapshotCalls = [];
  let appendCalls = 0;
  let holdRepair = false;
  let repairHeld = false;
  let failWrites = true;
  let reopened = null;
  let reopenedOutbox = null;
  const client = {
    ...backend.client,
    rpc(name, params) {
      if (name === 'append_annotation_update_v3' && failWrites) {
        appendCalls += 1;
        return lazy({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
      }
      if (name === 'store_annotation_snapshot_v3') {
        snapshotCalls.push(structuredClone(params));
        if (!failWrites) return backend.client.rpc(name, params);
        if (holdRepair && !repairHeld) {
          repairHeld = true;
          return lazy(heldRepair.promise);
        }
        return lazy({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
      }
      return backend.client.rpc(name, params);
    },
  };
  const handle = await openAnnotationDoc({
    documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId,
    checkedBundle: bundle,
    supabase: client,
    outboxStore: outbox,
    enableLocal: false,
    enableRealtime: false,
    writerId: 'snapshot-retry-budget-writer',
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 100,
  });
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const isControlledDelay = delay => [100, 200, 400, 800, 1600, 3200].includes(Number(delay));
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (!isControlledDelay(delay)) return nativeSetTimeout(callback, delay, ...args);
    const token = { controlledSnapshotRetryTimer: true, callback, args, delay: Number(delay), cleared: false };
    scheduled.push(token);
    return token;
  };
  globalThis.clearTimeout = token => {
    if (token?.controlledSnapshotRetryTimer) { token.cleared = true; return; }
    nativeClearTimeout(token);
  };
  const activeTimer = delay => scheduled.find(timer => !timer.cleared && timer.delay === delay);
  const activeTimers = delay => scheduled.filter(timer => !timer.cleared && timer.delay === delay);
  const fire = timer => {
    assert.ok(timer, 'expected a controlled retry timer');
    timer.cleared = true;
    return timer.callback(...timer.args);
  };
  t.after(async () => {
    failWrites = false;
    heldRepair.resolve({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
    try {
      await handle.destroy().catch(() => {});
      await reopened?.destroy().catch(() => {});
      await reopenedOutbox?.close().catch(() => {});
      await outbox.close().catch(() => {});
      purgeYDoc(`annoflat:${backend.ids.documentId}:${backend.ids.actorUserId}:pdf-generation:${backend.ids.generationId}:content-model:2`);
      backend.destroy();
    } finally {
      globalThis.setTimeout = nativeSetTimeout;
      globalThis.clearTimeout = nativeClearTimeout;
    }
  });

  handle.updateSurveyMarkers(markers => ({
    ...markers,
    'fixture-marker-left': { ...markers['fixture-marker-left'], notes: 'offline edit' },
  }));
  await handle.drain();
  assert.equal(appendCalls, 1);
  assert.equal(snapshotCalls.length, 4, 'the eager fallback keeps its original four-attempt budget');
  await until(() => activeTimers(100).length === 2,
    'gap repair and exact outbox replay timers were not both armed');

  holdRepair = true;
  const firstRepair = fire(activeTimer(100));
  await until(() => repairHeld, 'the scheduled repair snapshot did not start');
  fire(activeTimer(100));
  await until(() => appendCalls === 2, 'the same exact outbox row did not replay');
  await until(() => activeTimers(200).length >= 1,
    'the replay failure did not schedule its next retry');
  const overlappingRetry = fire(activeTimer(200));

  heldRepair.resolve({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
  await Promise.all([firstRepair, overlappingRetry].filter(Boolean));
  await handle.drain();

  assert.equal(snapshotCalls.length, 8,
    'the eager fallback and one repair cycle each spend four attempts; no second repair queues behind it');
  assert.equal(new Set(snapshotCalls.map(call => call.p_snapshot)).size, 1,
    'all measured retries used the same immutable checkpoint bytes');
  const bytesPerAttempt = (snapshotCalls[0].p_snapshot.length - 2) / 2;
  t.diagnostic(
    `duplicate-repair budget: baseline 12 calls/${12 * bytesPerAttempt} bytes; fixed 8 calls/${8 * bytesPerAttempt} bytes`,
  );

  assert.equal(activeTimers(200).length, 1,
    'the newer gap leaves exactly one later repair armed after the old repair finishes');
  failWrites = false;
  await fire(activeTimer(200));
  await handle.drain();
  assert.equal(snapshotCalls.length, 9,
    'the one later repair succeeds on its first request');
  assert.equal(handle.getSyncStatus().healthy, true);
  assert.equal(handle.getSyncStatus().queueSize, 0);

  await handle.destroy();
  purgeYDoc(`annoflat:${backend.ids.documentId}:${backend.ids.actorUserId}:pdf-generation:${backend.ids.generationId}:content-model:2`);
  reopenedOutbox = await createAnnotationOutbox({ indexedDb });
  reopened = await openAnnotationDoc({
    documentId: backend.ids.documentId,
    actorUserId: backend.ids.actorUserId,
    pdfGenerationId: backend.ids.generationId,
    checkedBundle: await backend.read(),
    supabase: backend.client,
    outboxStore: reopenedOutbox,
    enableLocal: false,
    enableRealtime: false,
    writerId: 'snapshot-retry-budget-reopen',
  });
  assert.equal(
    reopened.getSurveyMarkers()['fixture-marker-left']?.notes,
    'offline edit',
    'a cold registry reopen recovers the edit from the successful repair',
  );
});

  await t.test('close during a held repair cannot arm later repair work', async t => {
  const scenario = await createHeldRepairScenario(t);
  try {
    const closing = scenario.handle.destroy();
    scenario.heldRepair.resolve({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
    await closing;

    assert.equal(scenario.snapshotCalls.length, 12,
      'the eager repair, running repair, and explicit close checkpoint keep their own fixed budgets');
    assert.equal(scenario.activeTimers().length, 0,
      'the held repair cannot restore a cleared timer after close begins');
  } finally {
    await scenario.cleanup();
  }
});

  await t.test('purge during a held repair cannot arm or send later repair work', async t => {
  const scenario = await createHeldRepairScenario(t);
  try {
    await purgeAnnotationDoc(scenario.backend.ids.documentId);
    scenario.heldRepair.resolve({ data: null, error: { code: 'NETWORK', message: 'forced outage' } });
    await scenario.firstRepair;
    await scenario.handle.destroy();

    assert.equal(scenario.snapshotCalls.length, 5,
      'purge blocks every retry after the already-dispatched held request');
    assert.equal(scenario.activeTimers().length, 0,
      'the held repair cannot restore a cleared timer after purge');
  } finally {
    await scenario.cleanup();
  }
});
});
