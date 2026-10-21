// Drawboard gap #16: right-click on bare page space offers Select all markups,
// Paste in place and Set page scale above the page operations; read-only /
// viewer role keeps only Select all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableActions,
  buildCanvasPageItems,
  buildPageMenuItems,
  runPageMenuAction,
} from '../src/sidebar/pageMenuItems.js';

const rowKeys = (items) => items.filter((i) => !i.separator && !i.header).map((i) => i.key);
const noop = () => {};
const handlers = { selectAll: noop, pasteInPlace: noop, setScale: noop, delete: noop, rotate: noop };

test('canvas extras: all three rows, paste in place disabled without a clipboard', () => {
  const items = buildCanvasPageItems({ available: availableActions(handlers) });
  assert.deepEqual(rowKeys(items), ['selectAllMarks', 'pasteInPlace', 'setScale']);
  assert.equal(items.find((i) => i.key === 'pasteInPlace').disabled, true);
  const withClip = buildCanvasPageItems({ available: availableActions(handlers), canPasteInPlace: true });
  assert.equal(withClip.find((i) => i.key === 'pasteInPlace').disabled, false);
});

test('canvas extras: read-only keeps only Select all', () => {
  const items = buildCanvasPageItems({ available: availableActions(handlers), canPasteInPlace: true, readOnly: true });
  assert.deepEqual(rowKeys(items), ['selectAllMarks']);
});

test('canvas extras: a host without the handler hides its row', () => {
  const items = buildCanvasPageItems({ available: availableActions({ selectAll: noop }) });
  assert.deepEqual(rowKeys(items), ['selectAllMarks']);
});

test('page operations: read-only offers none', () => {
  const items = buildPageMenuItems({ pageNumber: 2, pageCount: 4, readOnly: true });
  assert.deepEqual(rowKeys(items), []);
});

test('runPageMenuAction dispatches the canvas extras with the page number', () => {
  const calls = [];
  const h = {
    selectAll: (p) => calls.push(['selectAll', p]),
    pasteInPlace: (p) => calls.push(['pasteInPlace', p]),
    setScale: (p) => calls.push(['setScale', p]),
  };
  assert.equal(runPageMenuAction('selectAllMarks', 3, h), true);
  assert.equal(runPageMenuAction('pasteInPlace', 3, h), true);
  assert.equal(runPageMenuAction('setScale', 3, h), true);
  assert.equal(runPageMenuAction('setScale', 3, {}), false);
  assert.deepEqual(calls, [['selectAll', 3], ['pasteInPlace', 3], ['setScale', 3]]);
});
