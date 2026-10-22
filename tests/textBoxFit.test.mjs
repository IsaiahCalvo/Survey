// A text box narrowed from its side grows downward to fit its rewrapped
// words (Drawboard), and never shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { growTextBoxToFit, isTextSideHandle } from '../src/utils/textBoxFit.js';

test('only the left / right grabbers rewrap', () => {
  assert.equal(isTextSideHandle('ml'), true);
  assert.equal(isTextSideHandle('mr'), true);
  for (const h of ['tl', 'tr', 'bl', 'br', 'mt', 'mb']) assert.equal(isTextSideHandle(h), false, h);
});

test('the box grows to its words plus padding, from its top edge', () => {
  assert.deepEqual(growTextBoxToFit({ left: 10, top: 20, height: 30 }, 50.2, 6), { left: 10, top: 20, height: 63 });
});

test('a box already tall enough, or with no measure, keeps its size', () => {
  assert.deepEqual(growTextBoxToFit({ left: 10, top: 20, height: 80 }, 40, 6), { left: 10, top: 20, height: 80 });
  assert.deepEqual(growTextBoxToFit({ left: 10, top: 20, height: 30 }, null, 6), { left: 10, top: 20, height: 30 });
});

test('a turned box keeps its turned top-left corner', () => {
  const grown = growTextBoxToFit({ left: 0, top: 0, height: 20, angle: 90 }, 28, 6);
  assert.equal(grown.height, 40);
  assert.ok(Math.abs(grown.left - -10) < 1e-9);
  assert.ok(Math.abs(grown.top - -10) < 1e-9);
});

test('single and group side resizes grow text to fit', () => {
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /if \(obj\.height && isTextSideHandle\(ds\.handleId\)\) \{\s*Object\.assign\(obj, growTextBoxToFit\(obj, measureTextContentHeight\(obj\)\)\);/);
  assert.match(hook, /Object\.assign\(target, growTextBoxToFit\(target, measureTextContentHeight\(target\)\)\);/);
});
