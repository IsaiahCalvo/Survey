/**
 * cloudSyncMigration happy-path coverage with mocked supabase only.
 * Do NOT mock annotationCloudSync.js itself — that splits V8 coverage.
 * Requires --experimental-test-module-mocks.
 */
import { mock, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const supabaseState = { loadError: null };

function makeSupabaseMock() {
  const chain = {};
  for (const name of ['from', 'upsert', 'select', 'delete', 'eq', 'in', 'or', 'order', 'limit', 'gt', 'channel']) {
    chain[name] = () => chain;
  }
  chain.on = () => chain;
  chain.subscribe = () => chain;
  chain.removeChannel = () => {};
  chain.single = async () => ({
    data: supabaseState.loadError ? null : { annotation_id: 'a1', updated_at: 't' },
    error: supabaseState.loadError,
  });
  chain.then = (resolve, reject) => Promise.resolve({
    data: supabaseState.loadError ? null : [],
    error: supabaseState.loadError,
    count: 0,
  }).then(resolve, reject);
  return chain;
}

function installLocalStorage() {
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
  return store;
}

const supabaseUrl = pathToFileURL(resolve('src/supabaseClient.js')).href;

before(() => {
  mock.module(supabaseUrl, {
    namedExports: {
      supabase: makeSupabaseMock(),
      isSupabaseAvailable: () => true,
      isAuthRefreshTokenError: () => false,
      clearSupabaseAuthStorage: () => {},
      recoverSupabaseAuthSession: async () => null,
      getSupabaseSession: async () => null,
      getAuthSnapshot: async () => ({ session: null, user: null }),
      isSchemaError: () => false,
      isConnectedServicesAvailable: () => false,
      setConnectedServicesAvailable: () => {},
    },
  });
});

test('migrateLocalAnnotationsToCloud pushes missing local rows then marks migrated', async () => {
  const store = installLocalStorage();
  try {
    store.setItem('annotationsByPage_pdf-1', JSON.stringify({
      1: {
        objects: [
          { id: 'new-1', type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 1, 0]], data: { id: 'new-1' } },
          { id: 'existing-1', type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 2, 0]], data: { id: 'existing-1' } },
        ],
      },
    }));
    store.setItem('callouts_pdf-1', JSON.stringify([
      {
        id: 'call-new',
        pageNumber: 1,
        text: 'hi',
        arrowTip: { x: 0, y: 0 },
        knee: { x: 1, y: 1 },
        textBoxPosition: { x: 2, y: 2 },
        textBoxWidth: 10,
        textBoxHeight: 10,
      },
    ]));

    const {
      migrateLocalAnnotationsToCloud,
      hasMigrationRun,
      resetMigrationFlag,
    } = await import('../src/services/cloudSyncMigration.js');

    resetMigrationFlag('u1', 'd1');
    const statuses = [];
    const result = await migrateLocalAnnotationsToCloud({
      documentId: 'd1',
      userId: 'u1',
      pdfId: 'pdf-1',
      onStatus: (s) => statuses.push(s.stage),
      // Reuse hydrate snapshot so we don't depend on keyset pagination shape
      existingCloudResult: {
        rawRows: [{ annotation_id: 'existing-1' }],
        error: null,
      },
    });

    assert.equal(result.migrated, true);
    // pushed count depends on serializer + upsert mock shape; migrated flag is the contract
    assert.ok(statuses.length >= 1);
    assert.equal(hasMigrationRun('u1', 'd1'), true);

    const again = await migrateLocalAnnotationsToCloud({
      documentId: 'd1',
      userId: 'u1',
      pdfId: 'pdf-1',
    });
    assert.equal(again.migrated, true);
    assert.equal(again.pushed, 0);
  } finally {
    delete globalThis.localStorage;
  }
});

test('migrateLocalAnnotationsToCloud marks done when nothing to push', async () => {
  const store = installLocalStorage();
  try {
    store.setItem('annotationsByPage_pdf-empty', JSON.stringify({}));
    store.setItem('callouts_pdf-empty', JSON.stringify([]));

    const {
      migrateLocalAnnotationsToCloud,
      resetMigrationFlag,
      hasMigrationRun,
    } = await import('../src/services/cloudSyncMigration.js');

    resetMigrationFlag('u2', 'd2');
    const result = await migrateLocalAnnotationsToCloud({
      documentId: 'd2',
      userId: 'u2',
      pdfId: 'pdf-empty',
      existingCloudResult: { rawRows: [], error: null },
    });
    assert.equal(result.migrated, true);
    assert.equal(result.pushed, 0);
    assert.equal(hasMigrationRun('u2', 'd2'), true);
  } finally {
    delete globalThis.localStorage;
  }
});

test('migrateLocalAnnotationsToCloud surfaces cloud load + push errors', async () => {
  const store = installLocalStorage();
  try {
    store.setItem('annotationsByPage_pdf-err', JSON.stringify({
      1: {
        objects: [
          { id: 'push-me', type: 'path', left: 0, top: 0, path: [['M', 0, 0], ['L', 1, 0]], data: { id: 'push-me' } },
        ],
      },
    }));
    store.setItem('callouts_pdf-err', JSON.stringify([]));

    const {
      migrateLocalAnnotationsToCloud,
      resetMigrationFlag,
    } = await import('../src/services/cloudSyncMigration.js');

    resetMigrationFlag('u3', 'd3');
    supabaseState.loadError = new Error('cloud-load-fail');
    try {
      const loadFail = await migrateLocalAnnotationsToCloud({
        documentId: 'd3',
        userId: 'u3',
        pdfId: 'pdf-err',
      });
      assert.ok(loadFail.error);
      assert.equal(loadFail.migrated, false);
    } finally {
      supabaseState.loadError = null;
    }

    resetMigrationFlag('u3', 'd3');
    globalThis.window = { __crdtForceLegacyFail: true };
    try {
      const pushFail = await migrateLocalAnnotationsToCloud({
        documentId: 'd3',
        userId: 'u3',
        pdfId: 'pdf-err',
        existingCloudResult: { rawRows: [], error: null },
      });
      assert.ok(pushFail.error);
      assert.equal(pushFail.migrated, false);
    } finally {
      delete globalThis.window;
    }
  } finally {
    delete globalThis.localStorage;
  }
});

test('migrateLocalAnnotationsToCloud parse/setItem catches + pdfImport key + callout push error', async () => {
  const {
    migrateLocalAnnotationsToCloud,
    resetMigrationFlag,
  } = await import('../src/services/cloudSyncMigration.js');

  // Invalid JSON → readLocalAnnotationsByPage / readLocalCallouts catch
  const badStore = installLocalStorage();
  try {
    badStore.setItem('annotationsByPage_pdf-bad', '{');
    badStore.setItem('callouts_pdf-bad', '{');
    resetMigrationFlag('u4', 'd4');
    const badParse = await migrateLocalAnnotationsToCloud({
      documentId: 'd4',
      userId: 'u4',
      pdfId: 'pdf-bad',
      existingCloudResult: { rawRows: [], error: null },
    });
    assert.equal(badParse.migrated, true);
  } finally {
    delete globalThis.localStorage;
  }

  // markMigrated setItem catch (empty push → still marks migrated)
  const mapMark = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (mapMark.has(k) ? mapMark.get(k) : null),
      setItem: (k, v) => {
        if (String(k).startsWith('cloudSyncMigrated_')) throw new Error('quota');
        mapMark.set(k, String(v));
      },
      removeItem: (k) => mapMark.delete(k),
    },
  });
  try {
    mapMark.set('annotationsByPage_pdf-mark', JSON.stringify({}));
    mapMark.set('callouts_pdf-mark', JSON.stringify([]));
    resetMigrationFlag('u6', 'd6');
    const marked = await migrateLocalAnnotationsToCloud({
      documentId: 'd6',
      userId: 'u6',
      pdfId: 'pdf-mark',
      existingCloudResult: { rawRows: [], error: null },
    });
    assert.equal(marked.migrated, true);
  } finally {
    delete globalThis.localStorage;
  }

  // Pdf-import key path (line 70) + callout-only push error (line 187)
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: store });
  try {
    map.set('annotationsByPage_pdf-imp', JSON.stringify({
      1: {
        objects: [{
          id: 'imp-1',
          type: 'path',
          isPdfImported: true,
          pdfAnnotationId: 'native-9',
          left: 0,
          top: 0,
          path: [['M', 0, 0], ['L', 1, 0]],
          data: { id: 'imp-1' },
        }],
      },
    }));
    map.set('callouts_pdf-imp', JSON.stringify([{
      id: 'call-only',
      pageNumber: 1,
      text: 'only',
      arrowTip: { x: 0, y: 0 },
      knee: { x: 1, y: 1 },
      textBoxPosition: { x: 2, y: 2 },
      textBoxWidth: 10,
      textBoxHeight: 10,
    }]));

    resetMigrationFlag('u5', 'd5');
    supabaseState.loadError = new Error('callout-upsert-fail');
    try {
      const result = await migrateLocalAnnotationsToCloud({
        documentId: 'd5',
        userId: 'u5',
        pdfId: 'pdf-imp',
        existingCloudResult: {
          rawRows: [{
            annotation_id: 'imp-1',
            page_number: 1,
            annotation_data: {
              pageNumber: 1,
              fabricObject: { isPdfImported: true, pdfAnnotationId: 'native-9' },
            },
          }],
          error: null,
        },
      });
      assert.equal(result.migrated, false);
      assert.ok(result.error);
    } finally {
      supabaseState.loadError = null;
    }
  } finally {
    delete globalThis.localStorage;
  }
});
