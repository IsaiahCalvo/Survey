import test from 'node:test';
import assert from 'node:assert/strict';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

for (const width of [0.02, 10]) {
  test(`exact-contact erase preserves an untouched ${width}-unit dot`, () => {
    const dot = createProductionPaperInk({ id: 'dot', points: [{ x: 50, y: 50 }], width, color: '#000000' });
    const result = erasePageAnnotations({ pageAnnotations: { objects: [dot] },
      eraserPoints: [{ x: 100, y: 100 }], eraserRadius: 2, mode: 'partial' });
    assert.deepEqual(result.pageAnnotations.objects, [dot]);
    assert.deepEqual(result.changedIds, []);
  });
}

test('exact-contact erase removes a contacted hairline and preserves a separate ribbon', () => {
  const ribbon = (id, y) => ({ id, type: 'path', left: 0, top: 0, fill: '#000000', stroke: null,
    strokeWidth: 0, path: [['M', 0, y], ['L', 40, y], ['L', 40, y + 0.3], ['L', 0, y + 0.3], ['Z']] });
  const inside = ribbon('inside', 20), outside = ribbon('outside', 30);
  const result = erasePageAnnotations({ pageAnnotations: { objects: [inside, outside] },
    eraserPoints: [{ x: 0, y: 20.15 }, { x: 40, y: 20.15 }], eraserRadius: 2, mode: 'partial' });
  assert.deepEqual(result.pageAnnotations.objects, [outside]);
  assert.deepEqual(result.deletedIds, ['inside']);
});
