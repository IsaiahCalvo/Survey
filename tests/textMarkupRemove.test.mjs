import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTextMarkupRemoveTransaction, cutQuads } from '../src/utils/textMarkupRemove.js';
import { applyAnnotationHistoryAction, invertAnnotationHistoryAction } from '../src/utils/annotationLocalHistory.js';

const quad = (left, right, top = 100, bottom = 112) => ({
  x1: left, y1: top, x2: right, y2: top, x3: left, y3: bottom, x4: right, y4: bottom,
});
const mark = (id, quads, markupType = 'highlight', pageNumber = 1) => ({
  type: 'group',
  id,
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  exportType: markupType,
  data: {
    id,
    type: 'text-markup',
    markupType,
    pageNumber,
    selectionGroupId: `g-${id}`,
    selectedText: 'words',
    textRange: { start: 0, end: 10 },
    quads,
  },
});
const pages = (objects) => ({ 1: { objects } });

test('a drag over the middle of a highlight cuts that part out', () => {
  const { quads, changed } = cutQuads([quad(10, 110)], [{ left: 40, right: 60, top: 101, bottom: 111 }]);
  assert.equal(changed, true);
  assert.deepEqual(quads.map((q) => [q.x1, q.x2]), [[10, 40], [60, 110]]);
});

test('a cut on another line leaves the quad alone', () => {
  const { quads, changed } = cutQuads([quad(10, 110)], [{ left: 0, right: 200, top: 130, bottom: 142 }]);
  assert.equal(changed, false);
  assert.equal(quads.length, 1);
});

test('a wholly covered mark is removed; others stay', () => {
  const before = pages([
    mark('a', [quad(10, 50)]),
    mark('b', [quad(10, 50, 200, 212)]),
    { type: 'rect', id: 'r', data: { id: 'r' } },
  ]);
  const tx = buildTextMarkupRemoveTransaction(before, [{ pageNumber: 1, quads: [quad(0, 80)] }]);
  assert.ok(tx);
  assert.equal(tx.removed, 1);
  assert.equal(tx.trimmed, 0);
  assert.deepEqual(tx.nextByPage[1].objects.map((o) => o.id), ['b', 'r']);
  assert.deepEqual(tx.removedSelectionGroupIds, ['g-a']);
});

test('a partly covered mark is cut back and its box follows', () => {
  const before = pages([mark('a', [quad(10, 110)], 'underline')]);
  const tx = buildTextMarkupRemoveTransaction(before, [{ pageNumber: 1, quads: [quad(70, 130)] }]);
  const after = tx.nextByPage[1].objects[0];
  assert.equal(tx.trimmed, 1);
  assert.deepEqual(after.data.quads.map((q) => [q.x1, q.x2]), [[10, 70]]);
  assert.equal(after.left, 10);
  assert.equal(after.width, 60);
  assert.equal(after.data.textRange, undefined);
  assert.equal(after.data.markupType, 'underline');
});

test('redactions, links and other pages are never touched', () => {
  const before = { 1: { objects: [mark('x', [quad(10, 50)], 'redact'), mark('l', [quad(10, 50)], 'link')] }, 2: { objects: [mark('p2', [quad(10, 50)], 'highlight', 2)] } };
  assert.equal(buildTextMarkupRemoveTransaction(before, [{ pageNumber: 1, quads: [quad(0, 80)] }]), null);
});

test('nothing under the drag gives no transaction (no empty Undo step)', () => {
  const before = pages([mark('a', [quad(10, 50)])]);
  assert.equal(buildTextMarkupRemoveTransaction(before, [{ pageNumber: 1, quads: [quad(300, 400)] }]), null);
  assert.equal(buildTextMarkupRemoveTransaction(before, []), null);
});

test('one Undo step puts every mark back as it was', () => {
  const before = pages([mark('a', [quad(10, 50)]), mark('b', [quad(10, 110, 200, 212)], 'strikeout')]);
  const tx = buildTextMarkupRemoveTransaction(before, [
    { pageNumber: 1, quads: [quad(0, 80), quad(0, 60, 200, 212)] },
  ]);
  assert.equal(tx.removed, 1);
  assert.equal(tx.trimmed, 1);
  const undone = applyAnnotationHistoryAction(tx.nextByPage, invertAnnotationHistoryAction(tx.action));
  assert.deepEqual(JSON.parse(JSON.stringify(undone[1].objects)), JSON.parse(JSON.stringify(before[1].objects)));
});
