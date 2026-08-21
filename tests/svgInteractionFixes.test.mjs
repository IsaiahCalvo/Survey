/**
 * P1-05 / P1-06 / P1-08 / P1-29 — SVG interaction helpers.
 * Exercises the exported seam in useSVGInteraction.js (no React mount).
 *
 * The hook file uses Vite-style extensionless relative imports, so this
 * suite registers a resolver before the dynamic import.
 */
import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getLineEndpoints } from '../src/utils/svgBoundingBox.js';

register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\\.[a-zA-Z0-9]+$/.test(specifier)) {
        return nextResolve(specifier + '.js', context);
      }
      throw err;
    }
  }
`)}`);

const {
  applyGroupLineWorldTransform,
  captureSelectionStableIds,
  getAnnotationStableId,
  packLineFromWorldEndpoints,
  remapSelectionByStableIds,
  resolveAnnotationIndexById,
  subtractIdSet,
  unionIdSet,
} = await import('../src/hooks/useSVGInteraction.js');

function fabricLine({ left, top, width, height, x1, y1, x2, y2, id }) {
  return { type: 'line', left, top, width, height, x1, y1, x2, y2, id };
}

test('P1-05 intended: getLineEndpoints + pack round-trips fabric-contract line', () => {
  // Drawn line (100,100)→(150,140) stored center-relative, matching
  // buildLineCommitJSON / the export-position fixture contract.
  const obj = fabricLine({
    left: 100, top: 100, width: 50, height: 40,
    x1: -25, y1: -20, x2: 25, y2: 20, id: 'line-a',
  });
  const ep = getLineEndpoints(obj);
  assert.equal(ep.x1, 100);
  assert.equal(ep.y1, 100);
  assert.equal(ep.x2, 150);
  assert.equal(ep.y2, 140);

  const packed = packLineFromWorldEndpoints(
    { x: ep.x1, y: ep.y1 },
    { x: ep.x2, y: ep.y2 },
  );
  const again = getLineEndpoints(packed);
  assert.deepEqual(again, ep);
});

test('P1-05 grouped line rotate uses getLineEndpoints, not x1+left', () => {
  const orig = fabricLine({
    left: 100, top: 100, width: 50, height: 40,
    x1: -25, y1: -20, x2: 25, y2: 20, id: 'line-rot',
  });
  // 90° around (100,100): (100,100) stays; (150,140) → (60,150)
  const pivotX = 100;
  const pivotY = 100;
  const cos = 0;
  const sin = 1;
  const rotPt = (x, y) => {
    const dx = x - pivotX;
    const dy = y - pivotY;
    return { x: pivotX + dx * cos - dy * sin, y: pivotY + dx * sin + dy * cos };
  };

  const next = applyGroupLineWorldTransform(orig, (x, y) => rotPt(x, y));
  const world = getLineEndpoints(next);
  assert.equal(world.x1, 100);
  assert.equal(world.y1, 100);
  assert.equal(world.x2, 60);
  assert.equal(world.y2, 150);

  // The pre-fix `x1 + left` path would have rotated (-25+100, -20+100) =
  // (75,80) instead of the painted (100,100) — displaced by width/2.
  const buggyWx1 = orig.x1 + orig.left;
  assert.notEqual(buggyWx1, getLineEndpoints(orig).x1);
});

test('P1-05 grouped line resize scales world endpoints from getLineEndpoints', () => {
  const orig = fabricLine({
    left: 100, top: 100, width: 50, height: 40,
    x1: -25, y1: -20, x2: 25, y2: 20, id: 'line-scale',
  });
  const scalePoint = (x, y) => ({ x: 100 + (x - 100) * 2, y: 100 + (y - 100) * 2 });
  const next = applyGroupLineWorldTransform(orig, scalePoint);
  const world = getLineEndpoints(next);
  assert.equal(world.x1, 100);
  assert.equal(world.y1, 100);
  assert.equal(world.x2, 200);
  assert.equal(world.y2, 180);
});

test('P1-06 stale-id drag re-resolves; missing id is a no-op (-1)', () => {
  const objects = [
    { id: 'keep', type: 'rect' },
    { id: 'other', type: 'rect' },
  ];
  assert.equal(resolveAnnotationIndexById(objects, 'other', 0), 1);
  // Captured id deleted; index 0 is now a different shape — must NOT fall back.
  assert.equal(resolveAnnotationIndexById([{ id: 'keep', type: 'rect' }], 'gone', 0), -1);
  // No id captured (legacy): fall back to the live index if occupied.
  assert.equal(resolveAnnotationIndexById(objects, null, 1), 1);
  assert.equal(resolveAnnotationIndexById(objects, null, 9), -1);
});

test('P1-08 undo remaps selection by id (and clears gone ids)', () => {
  const before = [
    { id: 'a', type: 'rect' },
    { id: 'b', type: 'line' },
    { id: 'c', type: 'rect' },
  ];
  const selected = new Set([1]); // index of b
  const stored = captureSelectionStableIds(selected, before);
  assert.deepEqual(stored, ['b']);

  // Undo of a prior create splices `a` out — `b` slides to index 0.
  const afterUndo = [
    { id: 'b', type: 'line' },
    { id: 'c', type: 'rect' },
  ];
  const remapped = remapSelectionByStableIds(stored, afterUndo);
  assert.deepEqual([...remapped], [0]);

  // Undo that deletes the selected shape clears the selection.
  const afterDelete = [{ id: 'a', type: 'rect' }, { id: 'c', type: 'rect' }];
  const cleared = remapSelectionByStableIds(stored, afterDelete);
  assert.equal(cleared.size, 0);

  assert.equal(getAnnotationStableId({ data: { id: 'nested' } }), 'nested');
});

test('P1-29 Shift+marquee unions callouts; Alt subtracts', () => {
  const current = new Set(['call-a']);
  const unioned = unionIdSet(current, ['call-b', 'call-a']);
  assert.deepEqual([...unioned].sort(), ['call-a', 'call-b']);

  const subtracted = subtractIdSet(unioned, ['call-a']);
  assert.deepEqual([...subtracted], ['call-b']);

  // Empty current + Shift hits still produces the hit set (union with empty).
  const fromEmpty = unionIdSet(undefined, ['call-c']);
  assert.deepEqual([...fromEmpty], ['call-c']);
});
