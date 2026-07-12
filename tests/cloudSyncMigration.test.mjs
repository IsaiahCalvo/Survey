import test from 'node:test';
import assert from 'node:assert/strict';

import {
  migrateLocalAnnotationsToCloud,
  hasMigrationRun,
  resetMigrationFlag,
} from '../src/services/cloudSyncMigration.js';

function installMemoryLocalStorage() {
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: store,
  });
  return {
    store,
    restore() {
      if (prev === undefined) {
        delete globalThis.localStorage;
      } else {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: prev });
      }
    },
  };
}

test('migrateLocalAnnotationsToCloud refuses missing ctx / offline supabase', async () => {
  const missing = await migrateLocalAnnotationsToCloud({});
  assert.equal(missing.migrated, false);
  assert.match(String(missing.error?.message || ''), /missing ctx/);

  const offline = await migrateLocalAnnotationsToCloud({
    documentId: 'd1',
    userId: 'u1',
    pdfId: 'pdf-1',
  });
  assert.equal(offline.migrated, false);
  assert.match(String(offline.error?.message || ''), /Supabase unavailable/);
});

test('hasMigrationRun / resetMigrationFlag round-trip via localStorage', () => {
  const ls = installMemoryLocalStorage();
  try {
    assert.equal(hasMigrationRun('u1', 'd1'), false);
    ls.store.setItem('cloudSyncMigrated_u1_d1', '1');
    assert.equal(hasMigrationRun('u1', 'd1'), true);
    resetMigrationFlag('u1', 'd1');
    assert.equal(hasMigrationRun('u1', 'd1'), false);

    // throwing getItem still fails closed
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem() { throw new Error('ls-boom'); },
        setItem() { throw new Error('ls-boom'); },
        removeItem() { throw new Error('ls-boom'); },
      },
    });
    assert.equal(hasMigrationRun('u1', 'd1'), false);
    resetMigrationFlag('u1', 'd1'); // should not throw
  } finally {
    ls.restore();
  }
});
