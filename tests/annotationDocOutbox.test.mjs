import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnnotationOutbox } from '../src/services/annotationDocOutbox.js';

const OUTBOX_DB_NAME = 'survey-annotation-outbox-v2';

function makeStore(keyPath = 'key') {
  return {
    keyPath,
    indexes: new Set(),
    rows: new Map(),
  };
}

class TestTransaction {
  constructor(database, storeNames) {
    this.database = database;
    this.storeNames = storeNames;
    this.pending = 0;
    this.finished = false;
    this.aborted = false;
    this.completionTimer = null;
    this.scheduleCompletion();
  }

  objectStore(name) {
    const store = this.database.stores.get(name);
    if (!store) throw new DOMException(`Object store ${name} not found`, 'NotFoundError');
    return new TestObjectStore(store, this);
  }

  abort() {
    if (this.finished) throw new DOMException('Transaction is inactive', 'InvalidStateError');
    this.aborted = true;
    this.finished = true;
    clearTimeout(this.completionTimer);
    queueMicrotask(() => this.onabort?.());
  }

  scheduleCompletion() {
    clearTimeout(this.completionTimer);
    this.completionTimer = setTimeout(() => {
      if (this.finished || this.aborted || this.pending > 0) return;
      this.finished = true;
      this.oncomplete?.();
    }, 0);
  }

  request(operation) {
    if (this.finished) throw new DOMException('Transaction is inactive', 'TransactionInactiveError');
    const request = {};
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborted) return;
      try {
        request.result = operation();
        request.onsuccess?.();
      } catch (error) {
        request.error = error;
        request.onerror?.();
      } finally {
        this.pending -= 1;
        this.scheduleCompletion();
      }
    });
    return request;
  }
}

class TestObjectStore {
  constructor(store, transaction = null) {
    this.store = store;
    this.transaction = transaction;
  }

  createIndex(name) {
    this.store.indexes.add(name);
  }

  index(name) {
    if (!this.store.indexes.has(name)) {
      throw new DOMException(`Index ${name} not found`, 'NotFoundError');
    }
    return {
      getAll: (value) => this.transaction.request(() => (
        [...this.store.rows.values()].filter((row) => row[name] === value)
      )),
    };
  }

  get(key) {
    return this.transaction.request(() => this.store.rows.get(key));
  }

  getAll() {
    return this.transaction.request(() => [...this.store.rows.values()]);
  }

  put(value) {
    return this.transaction.request(() => {
      const key = value[this.store.keyPath];
      this.store.rows.set(key, structuredClone(value));
      return key;
    });
  }

  delete(key) {
    return this.transaction.request(() => {
      this.store.rows.delete(key);
    });
  }
}

class TestDatabase {
  constructor(record) {
    this.record = record;
  }

  get objectStoreNames() {
    const names = [...this.record.stores.keys()];
    return {
      contains: (name) => names.includes(name),
      [Symbol.iterator]: () => names[Symbol.iterator](),
    };
  }

  createObjectStore(name, { keyPath }) {
    const store = makeStore(keyPath);
    this.record.stores.set(name, store);
    return new TestObjectStore(store);
  }

  transaction(storeNames) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const name of names) {
      if (!this.record.stores.has(name)) {
        throw new DOMException(`Object store ${name} not found`, 'NotFoundError');
      }
    }
    return new TestTransaction(this.record, names);
  }

  close() {
    this.closed = true;
  }
}

function createTestIndexedDb() {
  const databases = new Map();
  return {
    databases,
    seedVersionOne(name, pendingRecord) {
      const pending = makeStore();
      pending.indexes.add('scopeKey');
      pending.rows.set(pendingRecord.key, structuredClone(pendingRecord));
      const accepted = makeStore();
      accepted.indexes.add('scopeKey');
      databases.set(name, {
        version: 1,
        stores: new Map([
          ['pending', pending],
          ['accepted', accepted],
          ['acceptedCheckpoints', makeStore('scopeKey')],
        ]),
      });
    },
    open(name, requestedVersion) {
      const request = {};
      queueMicrotask(() => {
        const record = databases.get(name) || { version: 0, stores: new Map() };
        databases.set(name, record);
        if (requestedVersion < record.version) {
          request.error = new DOMException('Version too old', 'VersionError');
          request.onerror?.();
          return;
        }
        const oldVersion = record.version;
        const database = new TestDatabase(record);
        request.result = database;
        if (requestedVersion > oldVersion) {
          request.transaction = new TestTransaction(record, [...record.stores.keys()]);
          request.onupgradeneeded?.({ oldVersion, newVersion: requestedVersion });
          record.version = requestedVersion;
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test('outbox upgrades an existing version-one database before quarantining a rejection', async () => {
  const indexedDb = createTestIndexedDb();
  const documentId = 'doc-outbox-schema-upgrade';
  const actorUserId = 'actor-a';
  const key = [documentId, actorUserId, 'writer-a', 1].join('\u0000');
  indexedDb.seedVersionOne(OUTBOX_DB_NAME, {
    key,
    scopeKey: `${documentId}\u0000${actorUserId}`,
    documentId,
    actorUserId,
    writerId: 'writer-a',
    clientSeq: 1,
    ordinal: 1,
    status: 'pending',
    update: new Uint8Array([1, 2, 3]),
  });

  const first = await createAnnotationOutbox({ indexedDb, timeoutMs: 100 });
  await first.markRejected([key]);
  assert.equal(indexedDb.databases.get(OUTBOX_DB_NAME).version, 4);
  assert.equal(indexedDb.databases.get(OUTBOX_DB_NAME).stores.has('quarantined'), true);
  assert.equal(indexedDb.databases.get(OUTBOX_DB_NAME).stores.has('documentIncarnations'), true);
  assert.deepEqual(
    (await first.listQuarantined(documentId, actorUserId)).map((record) => record.status),
    ['rejected'],
  );
  await first.close();

  const reopened = await createAnnotationOutbox({ indexedDb, timeoutMs: 100 });
  assert.deepEqual(
    (await reopened.listQuarantined(documentId, actorUserId)).map((record) => record.key),
    [key],
    'repeated opens keep the upgraded quarantine store readable',
  );
  await reopened.close();
});

test('purge incarnation rejects stale-handle pending and accepted writes atomically', async () => {
  const indexedDb = createTestIndexedDb();
  const documentId = 'doc-outbox-purge-incarnation';
  const actorUserId = 'actor-a';
  const stale = await createAnnotationOutbox({ indexedDb, timeoutMs: 100 });
  const purger = await createAnnotationOutbox({ indexedDb, timeoutMs: 100 });
  const incarnation = await stale.getDocumentIncarnation(documentId);
  const record = {
    key: [documentId, actorUserId, 'writer-a', 1].join('\u0000'),
    scopeKey: `${documentId}\u0000${actorUserId}`,
    documentId,
    actorUserId,
    writerId: 'writer-a',
    clientSeq: 1,
    ordinal: 1,
    status: 'pending',
    incarnation,
    update: new Uint8Array([4, 5, 6]),
  };
  await stale.put(record);
  await purger.deleteDocument(documentId);

  await assert.rejects(
    stale.put({ ...record, key: `${record.key}\u00002`, clientSeq: 2 }),
    (error) => error?.code === 'ANNOTATION_DOCUMENT_DELETED',
  );
  await assert.rejects(
    stale.settleAccepted(record),
    (error) => error?.code === 'ANNOTATION_DOCUMENT_DELETED',
  );
  assert.equal((await purger.list(documentId, actorUserId)).length, 0);
  assert.equal((await purger.loadCleanState(documentId, actorUserId)).records.length, 0);
  assert.equal(await purger.getDocumentIncarnation(documentId), incarnation + 1);

  await stale.close();
  await purger.close();
});

test('purge incarnation rejects a stale late accepted-state compaction', async () => {
  const indexedDb = createTestIndexedDb();
  const documentId = 'doc-outbox-late-compaction';
  const actorUserId = 'actor-a';
  const stale = await createAnnotationOutbox({ indexedDb, timeoutMs: 100 });
  const purger = await createAnnotationOutbox({ indexedDb, timeoutMs: 100 });
  const incarnation = await stale.getDocumentIncarnation(documentId);
  const record = {
    key: [documentId, actorUserId, 'writer-a', 1].join('\u0000'),
    documentId,
    actorUserId,
    writerId: 'writer-a',
    clientSeq: 1,
    ordinal: 1,
    status: 'pending',
    incarnation,
    update: new Uint8Array([7, 8, 9]),
  };
  await stale.put(record);
  await stale.settleAccepted(record);
  await purger.deleteDocument(documentId);

  await assert.rejects(
    stale.compactAccepted(
      documentId,
      actorUserId,
      new Uint8Array([10, 11]),
      true,
      incarnation,
    ),
    (error) => error?.code === 'ANNOTATION_DOCUMENT_DELETED',
  );
  const clean = await purger.loadCleanState(documentId, actorUserId);
  assert.equal(clean.checkpointUpdate, null);
  assert.equal(clean.records.length, 0);

  await stale.close();
  await purger.close();
});
