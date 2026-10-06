// Test plan item 68 (2026-10-06): erasing across one big, very detailed pen
// drawing froze the page for ~10 s. The lane rebase (rebaseErasedPathSurvivor,
// run when the erase is saved AND again when the page is rebuilt from the
// store) asked pathToPageAnnotation for the base stroke's full polygon outline
// — a Martinez self-union of every outline command — and then used only its
// paint fields (fill, sourceWidth, paperSourceStroke). The outline is now
// skipped there; the survivor already carries its own polygons.
import assert from 'node:assert/strict';
import test from 'node:test';

import { rebaseErasedPathSurvivor } from '../src/utils/pageSpaceEraser.js';

// A filled pen-style outline made of 1,500 overlapping squares: its polygon
// outline is a large self-union (seconds), its paint fields are trivial.
function bigOverlappingInk() {
  const path = [];
  for (let i = 0; i < 1500; i += 1) {
    const x = 50 + i * 0.3 + 12 * Math.cos(i / 2.2);
    const y = 300 + 12 * Math.sin(i / 2.2);
    path.push(['M', x, y], ['L', x + 6, y], ['L', x + 6, y + 6], ['L', x, y + 6], ['Z']);
  }
  return {
    id: 'big-detailed-ink',
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
    data: { id: 'big-detailed-ink', tool: 'pen' },
  };
}

test('rebasing an erased survivor of a big detailed stroke skips the unused outline build', () => {
  const base = bigOverlappingInk();
  const survivor = {
    ...base,
    polygons: [[[[60, 290], [120, 290], [120, 320], [60, 320], [60, 290]]]],
  };
  const started = performance.now();
  const rebased = rebaseErasedPathSurvivor(base, base, survivor);
  const elapsed = performance.now() - started;

  assert.ok(rebased, 'the survivor is rebased');
  assert.deepEqual(rebased.polygons, survivor.polygons, 'the survivor keeps its own outline');
  assert.equal(rebased.fill, '#ff0000', 'paint comes from the current base');
  assert.equal(rebased.strokeWidth, 0);
  // Before the fix this shape ran over 13 minutes in Node (the self-union of
  // 1,500 overlapping squares) and was killed; now it is just the
  // copy. Generous bound for loaded CI machines.
  assert.ok(elapsed < 750, `rebase took ${elapsed.toFixed(0)} ms`);
});
