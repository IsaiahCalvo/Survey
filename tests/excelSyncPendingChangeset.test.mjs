import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pendingKey,
  readPendingChangeset,
  writePendingChangeset,
  clearPendingChangeset,
  __testing,
} from '../src/services/excelSyncPendingChangeset.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _map: map,
  };
}

test('pendingKey prefixes document ids', () => {
  assert.equal(pendingKey(null), null);
  assert.equal(pendingKey('doc-1'), `${__testing.KEY_PREFIX}doc-1`);
});

test('write/read/clear pending changeset round-trip for matching workbook', () => {
  const storage = memoryStorage();
  assert.equal(
    writePendingChangeset({
      documentId: 'd1',
      templateId: 't1',
      workbookId: 'w1',
      clientChangeSetId: 'cs-1',
    }, storage),
    true,
  );
  const hit = readPendingChangeset({
    documentId: 'd1',
    templateId: 't1',
    workbookId: 'w1',
  }, storage);
  assert.equal(hit.clientChangeSetId, 'cs-1');
  assert.equal(hit.workbookId, 'w1');

  assert.equal(
    readPendingChangeset({ documentId: 'd1', templateId: 't1', workbookId: 'other' }, storage),
    null,
  );
  assert.equal(
    readPendingChangeset({ documentId: 'd1', templateId: 'other', workbookId: 'w1' }, storage),
    null,
  );

  assert.equal(clearPendingChangeset('d1', storage), true);
  assert.equal(
    readPendingChangeset({ documentId: 'd1', templateId: 't1', workbookId: 'w1' }, storage),
    null,
  );
});

test('readPendingChangeset fails safe on corrupt JSON and missing storage', () => {
  const storage = memoryStorage({ [`${__testing.KEY_PREFIX}d2`]: '{not-json' });
  assert.equal(
    readPendingChangeset({ documentId: 'd2', workbookId: 'w' }, storage),
    null,
  );
  assert.equal(readPendingChangeset({ documentId: 'd2' }, null), null);
  assert.equal(writePendingChangeset({ documentId: 'd2', clientChangeSetId: 'x' }, null), false);
  assert.equal(clearPendingChangeset('d2', null), false);
  assert.equal(writePendingChangeset({ documentId: null, clientChangeSetId: 'x' }, storage), false);
});

test('writePendingChangeset returns false when setItem throws', () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('fail'); },
  };
  assert.equal(
    writePendingChangeset({
      documentId: 'd3',
      clientChangeSetId: 'cs',
      workbookId: 'w',
    }, storage),
    false,
  );
  assert.equal(clearPendingChangeset('d3', storage), false);
});

test('getStorage returns null when localStorage access throws', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('blocked'); },
  });
  try {
    assert.equal(
      readPendingChangeset({ documentId: 'd4', workbookId: 'w' }),
      null,
    );
    assert.equal(
      writePendingChangeset({ documentId: 'd4', clientChangeSetId: 'cs', workbookId: 'w' }),
      false,
    );
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});
