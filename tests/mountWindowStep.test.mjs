import assert from 'node:assert/strict';
import test from 'node:test';
import { stepMountWindow } from '../src/utils/mountWindowStep.js';

function walk(prev, target, visible) {
  const seen = [];
  let cur = prev;
  for (let i = 0; i < 50; i += 1) {
    const next = stepMountWindow(cur, target, visible);
    if (next[0] === cur[0] && next[1] === cur[1]) break;
    seen.push(next);
    cur = next;
    if (cur[0] === target[0] && cur[1] === target[1]) break;
  }
  return seen;
}

test('after a fast glide, the pages on screen mount together, then the overscan one a step', () => {
  // Held window far behind (pages 2-5); the glide stopped showing 20-22, overscan 19-23.
  assert.deepEqual(walk([2, 5], [19, 23], [20, 22]), [[20, 22], [20, 23], [19, 23]]);
});

test('a held window that overlaps the screen keeps its pages and grows from them', () => {
  assert.deepEqual(stepMountWindow([18, 21], [19, 23], [20, 22]), [19, 22]);
  assert.deepEqual(stepMountWindow([19, 22], [19, 23], [20, 22]), [19, 23]);
  assert.deepEqual(walk([18, 21], [19, 23], [20, 22]).pop(), [19, 23]);
});

test('nothing on screen or an empty target goes straight to the target', () => {
  assert.deepEqual(stepMountWindow([2, 5], [0, -1], [0, -1]), [0, -1]);
  assert.deepEqual(stepMountWindow([0, -1], [3, 6], [4, 5]), [4, 5]);
});
