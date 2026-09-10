import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import * as Y from 'yjs';
import {
  openAnnotationDoc,
  purgeAnnotationDoc,
} from '../src/services/annotationDocSync.js';
import {
  createAnnotationOutbox,
  createMemoryAnnotationOutbox,
} from '../src/services/annotationDocOutbox.js';
import { purgeYDoc } from '../src/lib/collab/ydocRegistry.js';
import { ERASE_OUTBOX_MAP } from '../src/utils/annotationEraseTransaction.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function within(promise, message, timeoutMs = 1000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function backend() {
  const updates = [];
  const snapshots = [];
  const result = value => {
    const builder = {};
    for (const method of ['select', 'eq', 'gt', 'order', 'limit']) builder[method] = () => builder;
    builder.maybeSingle = async () => value;
    builder.then = done => done(value);
    return builder;
  };
  return {
    updates,
    snapshots,
    from(table) {
      if (table === 'annotation_updates') return {
        select: () => result({ data: [] }),
        insert: row => ({ select: () => ({ single: async () => {
          updates.push(row);
          return { data: { seq: updates.length }, error: null };
        } }) }),
      };
      if (table === 'annotation_snapshots') return {
        select: () => result({ data: null }),
        upsert: async row => {
          snapshots.push(row);
          return { error: null };
        },
      };
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

function pendingEntry(mutationId) {
  return {
    mutationId,
    actorUserId: 'erase-lifecycle-actor',
    status: 'pending',
    committedAt: '2026-09-10T00:00:00.000Z',
    effects: [
      {
        type: 'trash',
        targetKey: 'marker-one',
        idempotencyKey: `${mutationId}:trash:marker-one`,
        payload: { before: { id: 'marker-one', pageNumber: 1 } },
      },
      {
        type: 'history',
        targetKey: 'marker-one',
        idempotencyKey: `${mutationId}:history:marker-one`,
        payload: { before: { id: 'marker-one', pageNumber: 1 } },
      },
    ],
    acknowledgedEffectKeys: [],
  };
}

async function decodeSnapshot(row) {
  const compressed = Uint8Array.from(Buffer.from(row.snapshot.slice(2), 'hex'));
  return new Uint8Array(await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).arrayBuffer());
}

function options(t, supabase, eraseEffectConsumer, outboxStore = createMemoryAnnotationOutbox()) {
  const documentId = `erase-lifecycle-${crypto.randomUUID()}`;
  const actorUserId = 'erase-lifecycle-actor';
  t.after(() => purgeYDoc(`annoflat:${documentId}:${actorUserId}`));
  return {
    documentId,
    actorUserId,
    supabase,
    eraseEffectConsumer,
    enableLocal: false,
    enableRealtime: false,
    snapshotRetryDelayMs: 0,
    outboxStore,
  };
}

async function readPersistedDoc(outbox, documentId) {
  const stored = await outbox.readLocalState(documentId, 'erase-lifecycle-actor', 0);
  const doc = new Y.Doc();
  for (const update of [
    stored.checkpointUpdate,
    ...stored.accepted.map(row => row.update),
    ...stored.pending.filter(row => !row.publishAfterAcceptance).map(row => row.update),
  ].filter(Boolean)) Y.applyUpdate(doc, update);
  return doc;
}

test('a live handle runs and acknowledges every queued erase effect', async t => {
  const supabase = backend();
  const calls = [];
  const handle = await openAnnotationDoc(options(t, supabase, async effect => {
    calls.push(effect.type);
  }));
  const mutationId = 'live-two-effects';
  try {
    handle.doc.transact(() => {
      handle.doc.getMap(ERASE_OUTBOX_MAP).set(mutationId, pendingEntry(mutationId));
    }, 'erase-lifecycle-test');
    await handle.drain();
    const result = await handle.drainEraseOutbox();
    await handle.drain();

    assert.deepEqual(calls, ['trash', 'history']);
    assert.equal(result.pending, 0);
    assert.equal(handle.doc.getMap(ERASE_OUTBOX_MAP).get(mutationId).status, 'acknowledged');
  } finally {
    await handle.destroy();
  }
});

for (const outcome of ['success', 'failure']) {
  test(`close blocks effect 2 after held effect 1 ${outcome}`, async t => {
    const supabase = backend();
    const indexedDb = new IDBFactory();
    const outbox = await createAnnotationOutbox({ indexedDb });
    const effectOneStarted = deferred();
    const releaseEffectOne = deferred();
    const calls = [];
    const openOptions = options(t, supabase, async effect => {
      calls.push(effect.type);
      if (effect.type !== 'trash') return;
      effectOneStarted.resolve();
      await releaseEffectOne.promise;
      if (outcome === 'failure') throw new Error('late effect failure');
    }, outbox);
    const handle = await openAnnotationDoc(openOptions);
    t.after(async () => {
      releaseEffectOne.resolve();
      await handle.destroy().catch(() => {});
    });
    const mutationId = `close-${outcome}`;

    handle.doc.transact(() => {
      handle.doc.getMap(ERASE_OUTBOX_MAP).set(mutationId, pendingEntry(mutationId));
    }, 'erase-lifecycle-test');
    await within(effectOneStarted.promise, 'effect 1 did not start');

    const firstClose = handle.destroy();
    const secondClose = handle.destroy();
    assert.strictEqual(secondClose, firstClose, 'repeated close shares the same receipt work');
    const originalSetTimeout = globalThis.setTimeout;
    const snapshotDebounces = [];
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 1200) {
        const timer = { unref() {} };
        snapshotDebounces.push({ callback, timer });
        return timer;
      }
      return originalSetTimeout(callback, delay, ...args);
    };
    try {
      releaseEffectOne.resolve();
      await firstClose;
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    assert.deepEqual(calls, ['trash'], 'no new destination starts once close begins');
    assert.equal(snapshotDebounces.length, 0, 'late effect receipts cannot re-arm snapshot debounce after close');
    assert.ok(supabase.snapshots.length > 0, 'close persists the final durable outbox state');
    const cold = new Y.Doc();
    try {
      Y.applyUpdate(cold, await decodeSnapshot(supabase.snapshots.at(-1)));
      const entry = cold.getMap(ERASE_OUTBOX_MAP).get(mutationId);
      assert.equal(entry.status, 'pending');
      assert.deepEqual(
        entry.acknowledgedEffectKeys,
        outcome === 'success' ? [`${mutationId}:trash:marker-one`] : [],
        'only a completed external effect gains a durable acknowledgement',
      );
      assert.equal(entry.effects.length, 2, 'the unstarted effect remains recoverable');
    } finally {
      cold.destroy();
    }

    const reopenedOutbox = await createAnnotationOutbox({ indexedDb });
    const persisted = await readPersistedDoc(reopenedOutbox, openOptions.documentId);
    try {
      const entry = persisted.getMap(ERASE_OUTBOX_MAP).get(mutationId);
      assert.ok(entry, 'the close keeps the pending outbox bytes in persistent local storage');
      assert.equal(entry.effects.length, 2);
      assert.equal(entry.status, 'pending');
      assert.deepEqual(
        entry.acknowledgedEffectKeys,
        outcome === 'success' ? [`${mutationId}:trash:marker-one`] : [],
      );
    } finally {
      persisted.destroy();
    }

    purgeYDoc(`annoflat:${openOptions.documentId}:${openOptions.actorUserId}`);
    const recoveryCalls = [];
    const reopened = await openAnnotationDoc({
      ...openOptions,
      eraseEffectConsumer: async effect => { recoveryCalls.push(effect.type); },
      outboxStore: reopenedOutbox,
    });
    try {
      await reopened.drain();
      await reopened.drainEraseOutbox();
      await reopened.drain();
      assert.deepEqual(
        recoveryCalls,
        outcome === 'success' ? ['history'] : ['trash', 'history'],
        'cold recovery runs only effects without a durable acknowledgement',
      );
    } finally {
      await reopened.destroy();
    }
  });
}

test('purge during held effect 1 never runs effect 2 or restores cleared state', async t => {
  const supabase = backend();
  const effectOneStarted = deferred();
  const releaseEffectOne = deferred();
  const effectOneFinished = deferred();
  const calls = [];
  const openOptions = options(t, supabase, async effect => {
    calls.push(effect.type);
    if (effect.type !== 'trash') return;
    effectOneStarted.resolve();
    try {
      await releaseEffectOne.promise;
    } finally {
      effectOneFinished.resolve();
    }
  });
  const handle = await openAnnotationDoc(openOptions);
  t.after(async () => {
    releaseEffectOne.resolve();
    await handle.destroy().catch(() => {});
  });
  const mutationId = 'purged-two-effects';

  handle.doc.transact(() => {
    handle.doc.getMap(ERASE_OUTBOX_MAP).set(mutationId, pendingEntry(mutationId));
  }, 'erase-lifecycle-test');
  await within(effectOneStarted.promise, 'effect 1 did not start');

  await purgeAnnotationDoc(openOptions.documentId);
  releaseEffectOne.resolve();
  await effectOneFinished.promise;
  await Promise.resolve();

  assert.deepEqual(calls, ['trash']);
  assert.equal(handle.doc.getMap(ERASE_OUTBOX_MAP).size, 0, 'late acknowledgement cannot restore purged data');
  const snapshotsAfterPurge = supabase.snapshots.length;
  const originalWarn = console.warn;
  const snapshotRetryWarnings = [];
  console.warn = (...args) => {
    if (String(args[0] || '').startsWith('[annotationDocSync] snapshot ')) {
      snapshotRetryWarnings.push(args);
      return;
    }
    originalWarn(...args);
  };
  try {
    await handle.destroy();
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(supabase.snapshots.length, snapshotsAfterPurge,
    'destroy after purge cannot reach the snapshot backend');
  assert.deepEqual(snapshotRetryWarnings, [],
    'destroy after purge cannot start snapshot retry work');
});

test('purge after close starts cannot be undone by a late effect receipt', async t => {
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const previousKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
  const indexedDb = new IDBFactory();
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDb });
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
  const supabase = backend();
  const effectOneStarted = deferred();
  const releaseEffectOne = deferred();
  const calls = [];
  let handle;
  let reopened;
  try {
    const outbox = await createAnnotationOutbox({ indexedDb });
    const openOptions = options(t, supabase, async effect => {
      calls.push(effect.type);
      if (effect.type === 'trash') {
        effectOneStarted.resolve();
        await releaseEffectOne.promise;
      }
    }, outbox);
    handle = await openAnnotationDoc(openOptions);
    const mutationId = 'close-then-purge';
    handle.doc.transact(() => {
      handle.doc.getMap(ERASE_OUTBOX_MAP).set(mutationId, pendingEntry(mutationId));
    }, 'erase-lifecycle-test');
    await within(effectOneStarted.promise, 'effect 1 did not start');

    const closing = handle.destroy();
    await purgeAnnotationDoc(openOptions.documentId);
    releaseEffectOne.resolve();
    await closing;

    assert.deepEqual(calls, ['trash'], 'the closed consumer never starts the second destination');
    const reopenedOutbox = await createAnnotationOutbox({ indexedDb });
    assert.deepEqual(
      await reopenedOutbox.list(openOptions.documentId, openOptions.actorUserId),
      [],
      'the late acknowledgement cannot recreate a purged journal row',
    );
    reopened = await openAnnotationDoc({
      ...openOptions,
      eraseEffectConsumer: null,
      outboxStore: reopenedOutbox,
    });
    assert.equal(
      reopened.doc.getMap(ERASE_OUTBOX_MAP).size,
      0,
      'a new registry handle does not recover the purged intent',
    );
  } finally {
    releaseEffectOne.resolve();
    await handle?.destroy().catch(() => {});
    await reopened?.destroy().catch(() => {});
    if (previousIndexedDb) Object.defineProperty(globalThis, 'indexedDB', previousIndexedDb);
    else delete globalThis.indexedDB;
    if (previousKeyRange) Object.defineProperty(globalThis, 'IDBKeyRange', previousKeyRange);
    else delete globalThis.IDBKeyRange;
  }
});
