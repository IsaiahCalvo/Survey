// Test plan item 68 (2026-10-06): erasing across one big, very detailed pen
// drawing froze the page for ~10 s. The lane rebase (rebaseErasedPathSurvivor,
// run when the erase is saved AND again when the page is rebuilt from the
// store) asked pathToPageAnnotation for the base stroke's full polygon outline
// — a Martinez self-union of every outline command — and then used only its
// paint fields (fill, sourceWidth, paperSourceStroke). It now asks for the
// paint fields only (paintOnly); the survivor already carries its polygons.
// (Speed is measured by debug/scenarios/test-plan/part10-eraser.spec.mjs —
// 9.9 s -> 1.4 s longest block; blocking CI tests may not assert time.) Here:
// the rebased result is unchanged.
import assert from 'node:assert/strict';
import test from 'node:test';

import { rebaseErasedPathSurvivor } from '../src/utils/pageSpaceEraser.js';

// A filled pen-style outline made of overlapping squares (its polygon outline
// is a self-union; its paint fields are trivial).
function overlappingInk({ curved = false, count = 40 } = {}) {
  const path = [];
  for (let i = 0; i < count; i += 1) {
    const x = 50 + i * 2 + 12 * Math.cos(i / 2.2);
    const y = 300 + 12 * Math.sin(i / 2.2);
    path.push(['M', x, y]);
    if (curved) path.push(['C', x + 2, y - 2, x + 4, y - 2, x + 6, y]);
    else path.push(['L', x + 6, y]);
    path.push(['L', x + 6, y + 6], ['L', x, y + 6], ['Z']);
  }
  return {
    id: 'detailed-ink',
    type: 'path',
    tool: 'pen',
    path,
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    fill: '#ff0000',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 3,
    fillRule: 'nonzero',
    data: { id: 'detailed-ink', tool: 'pen' },
  };
}

const survivorOf = (base) => ({
  ...base,
  polygons: [[[[60, 290], [120, 290], [120, 320], [60, 320], [60, 290]]]],
});

test('a rebased erase survivor keeps its own outline and the base stroke\'s paint', () => {
  const base = overlappingInk();
  const survivor = survivorOf(base);
  const rebased = rebaseErasedPathSurvivor(base, base, survivor);
  assert.ok(rebased, 'the survivor is rebased');
  assert.deepEqual(rebased.polygons, survivor.polygons, 'the survivor keeps its own outline');
  assert.equal(rebased.fill, '#ff0000', 'paint comes from the current base');
  assert.equal(rebased.strokeWidth, 0);
  assert.equal(rebased.paperSourceStroke ?? null, null, 'straight outlines carry no source paint');
});

test('a curved base still hands its authored fill paint to the survivor', () => {
  const base = overlappingInk({ curved: true });
  const rebased = rebaseErasedPathSurvivor(base, base, survivorOf(base));
  assert.ok(rebased);
  assert.equal(rebased.paperSourceStroke?.paintMode, 'fill');
  assert.equal(rebased.paperSourceStroke?.fill, '#ff0000');
  assert.deepEqual(rebased.paperSourceStroke?.path, base.path);
});
