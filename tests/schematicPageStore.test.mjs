// KAL-402 (F12 Schematic Mode): the page store reads each page once, one at a
// time, and remembers a "turn off on this page" choice per document.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureSchematicDetection, getSchematicResult, isSchematicTurnedOff, requestSchematicDetection,
  resetSchematicStoreForTests, setSchematicTurnedOff, subscribeSchematicPages, waitForSchematicQueue,
} from '../src/utils/schematicPageStore.js';

const OPS = { save: 1, restore: 2, transform: 3, constructPath: 4, paintImageXObject: 5 };

const fakeDoc = (pages) => {
  const reads = [];
  return {
    reads,
    async getPage(n) {
      reads.push(n);
      if (!pages[n]) throw new Error('no such page');
      return {
        getViewport: () => ({ width: 100, height: 100 }),
        getTextContent: async () => ({ items: pages[n].text || [] }),
        getOperatorList: async () => pages[n].ops,
      };
    },
  };
};

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
};

test('reads a page once, and only when asked', async () => {
  configureSchematicDetection({ ops: OPS });
  const doc = fakeDoc({
    1: { ops: { fnArray: [OPS.transform, OPS.paintImageXObject], argsArray: [[100, 0, 0, 100, 0, 0], []] } },
    2: { ops: { fnArray: [], argsArray: [] } },
  });
  let notified = 0;
  const unsubscribe = subscribeSchematicPages(() => { notified += 1; });
  assert.equal(getSchematicResult(doc, 1), undefined);
  requestSchematicDetection(doc, 1);
  requestSchematicDetection(doc, 1);
  requestSchematicDetection(doc, 2);
  assert.equal(getSchematicResult(doc, 1), 'pending');
  await waitForSchematicQueue();
  unsubscribe();
  assert.deepEqual(doc.reads, [1, 2]);
  assert.equal(getSchematicResult(doc, 1).kind, 'raster');
  assert.equal(getSchematicResult(doc, 2).schematic, false);
  assert.ok(notified >= 2);
});

test('an unreadable page is not a schematic and does not stop the queue', async () => {
  configureSchematicDetection({ ops: OPS });
  const doc = fakeDoc({ 2: { ops: { fnArray: [OPS.transform, OPS.paintImageXObject], argsArray: [[100, 0, 0, 100, 0, 0], []] } } });
  requestSchematicDetection(doc, 1);
  requestSchematicDetection(doc, 2);
  await waitForSchematicQueue();
  assert.equal(getSchematicResult(doc, 1).schematic, false);
  assert.equal(getSchematicResult(doc, 2).schematic, true);
});

test('turning a page off is kept per document and survives a reload', () => {
  const storage = memoryStorage();
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    resetSchematicStoreForTests();
    setSchematicTurnedOff('doc-a', 3, true);
    assert.equal(isSchematicTurnedOff('doc-a', 3), true);
    assert.equal(isSchematicTurnedOff('doc-b', 3), false);
    resetSchematicStoreForTests(); // a reload: read storage again
    assert.equal(isSchematicTurnedOff('doc-a', 3), true);
    setSchematicTurnedOff('doc-a', 3, false);
    assert.equal(storage.map.size, 0);
    resetSchematicStoreForTests();
    assert.equal(isSchematicTurnedOff('doc-a', 3), false);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('turn-off key ignores the page-view fingerprint suffix', () => {
  const storage = memoryStorage();
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    resetSchematicStoreForTests();
    setSchematicTurnedOff('abc123', 2, true);
    assert.equal(isSchematicTurnedOff('abc123~pv4', 2), true);
    resetSchematicStoreForTests();
    assert.equal(isSchematicTurnedOff('abc123', 2), true);
    setSchematicTurnedOff('abc123~pv9', 1, true);
    resetSchematicStoreForTests();
    assert.equal(isSchematicTurnedOff('abc123', 1), true);
    assert.equal(isSchematicTurnedOff('abc123', 2), true);
    assert.equal(storage.map.has('survey:schematic-off:abc123'), true);
    assert.equal(storage.map.has('survey:schematic-off:abc123~pv9'), false);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('blocked storage still lets the choice last for the session', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  try {
    resetSchematicStoreForTests();
    setSchematicTurnedOff('doc-c', 1, true);
    assert.equal(isSchematicTurnedOff('doc-c', 1), true);
    setSchematicTurnedOff(undefined, 2, true);
    assert.equal(isSchematicTurnedOff(undefined, 2), true);
  } finally {
    globalThis.localStorage = previous;
  }
});
