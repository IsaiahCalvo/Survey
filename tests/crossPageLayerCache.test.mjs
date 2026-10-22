// Perf guard (dense-sheet drags): a move reads the page layers once and again
// only after something scrolls, zooms or resizes, instead of a document-wide
// querySelectorAll + getScreenCTM on every pointermove.
import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Map();
const target = () => ({
  addEventListener: (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); },
});
globalThis.window = { ...target(), visualViewport: target() };
globalThis.document = target();
const fire = (type) => (listeners.get(type) || []).forEach((fn) => fn());

const { readPageLayersCached } = await import('../src/utils/crossPageMove.js');

function rootWith(offset) {
  const root = {
    reads: 0,
    offset,
    querySelectorAll() {
      root.reads += 1;
      return [{
        getAttribute: () => '1',
        viewBox: { baseVal: { width: 612, height: 792 } },
        getClientRects: () => [{}],
        getScreenCTM: () => ({ inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: root.offset, f: 0 }) }),
      }];
    },
  };
  return root;
}

test('one read serves every pointermove of a drag', () => {
  const root = rootWith(0);
  const drag = {};
  for (let i = 0; i < 60; i += 1) readPageLayersCached(drag, root);
  assert.equal(root.reads, 1);
});

for (const type of ['scroll', 'wheel', 'resize', 'keydown']) {
  test(`a ${type} re-reads the layers on the next move`, () => {
    const root = rootWith(0);
    const drag = {};
    assert.equal(readPageLayersCached(drag, root)[0].matrix[4], 0);
    root.offset = 40;
    fire(type);
    assert.equal(readPageLayersCached(drag, root)[0].matrix[4], 40);
    assert.equal(root.reads, 2);
  });
}

test('a new drag starts from a fresh read, and an empty read is not cached', () => {
  const root = rootWith(0);
  readPageLayersCached({}, root);
  readPageLayersCached({}, root);
  assert.equal(root.reads, 2);
  const empty = { reads: 0, querySelectorAll() { empty.reads += 1; return []; } };
  const drag = {};
  readPageLayersCached(drag, empty);
  readPageLayersCached(drag, empty);
  assert.equal(empty.reads, 2);
});
