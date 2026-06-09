import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  queueKey,
  enqueueWriteback,
  listWriteback,
  countWriteback,
  clearWriteback,
  __testing
} from '../rowIdWritebackQueue.js';

// Minimal in-memory localStorage stand-in.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k)
  };
}

const DOC = 'doc-1:pdf-1';

test('queueKey is null without a document id', () => {
  assert.equal(queueKey(null), null);
  assert.equal(queueKey(DOC), `${__testing.KEY_PREFIX}${DOC}`);
});

test('enqueue then list/count', () => {
  const s = makeStorage();
  assert.equal(countWriteback(DOC, s), 0);
  enqueueWriteback(DOC, { markerId: 'm1', scope: 'mod:cat', rowLocator: 5, expectedOldCellValue: '' }, s);
  enqueueWriteback(DOC, { markerId: 'm2', scope: 'mod:cat', rowLocator: 6 }, s);
  assert.equal(countWriteback(DOC, s), 2);
  const list = listWriteback(DOC, s);
  assert.deepEqual(list.map((e) => e.markerId).sort(), ['m1', 'm2']);
  assert.equal(list.find((e) => e.markerId === 'm1').retryState, 'pending');
});

test('enqueue is idempotent per marker (updates in place, no pile-up)', () => {
  const s = makeStorage();
  enqueueWriteback(DOC, { markerId: 'm1', rowLocator: 5 }, s);
  enqueueWriteback(DOC, { markerId: 'm1', rowLocator: 9, newToken: 'v1.k1.xx' }, s);
  assert.equal(countWriteback(DOC, s), 1);
  const e = listWriteback(DOC, s)[0];
  assert.equal(e.rowLocator, 9);
  assert.equal(e.newToken, 'v1.k1.xx');
});

test('clear removes one entry; clearing a missing one is a no-op success', () => {
  const s = makeStorage();
  enqueueWriteback(DOC, { markerId: 'm1' }, s);
  enqueueWriteback(DOC, { markerId: 'm2' }, s);
  assert.equal(clearWriteback(DOC, 'm1', s), true);
  assert.equal(countWriteback(DOC, s), 1);
  assert.equal(clearWriteback(DOC, 'nope', s), true);
  assert.equal(countWriteback(DOC, s), 1);
});

test('fail-safe: missing document id or storage never throws', () => {
  assert.equal(enqueueWriteback(null, { markerId: 'm1' }), false);
  assert.equal(enqueueWriteback(DOC, { markerId: 'm1' }, null), false);
  assert.equal(countWriteback(DOC, null), 0);
  assert.deepEqual(listWriteback(DOC, null), []);
});
