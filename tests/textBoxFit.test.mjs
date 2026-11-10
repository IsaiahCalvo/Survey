// A text box narrowed from its side grows downward to fit its rewrapped
// words (Drawboard), and never shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitTextBoxToWords, growTextBoxToFit, isTextSideHandle, probeStyleValue } from '../src/utils/textBoxFit.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

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
  // DELIBERATE CHANGE (2026-11-10): with Nightly 'text-fit-height' the same
  // calls fit both ways (fitTextBoxToWords); without it they only grow.
  const fit = "\\(isFeatureOn\\('text-fit-height'\\) \\? fitTextBoxToWords : growTextBoxToFit\\)";
  assert.match(hook, new RegExp(`if \\(obj\\.height && isTextSideHandle\\(ds\\.handleId\\)\\) \\{\\s*(//[^\\n]*\\s*)*Object\\.assign\\(obj, ${fit}\\(obj, measureTextContentHeight\\(obj\\)\\)\\);`));
  assert.match(hook, new RegExp(`Object\\.assign\\(target, ${fit}\\(target, measureTextContentHeight\\(target\\)\\)\\);`));
});

test('Nightly text-fit-height: a side drag fits the box to its words both ways', () => {
  assert.deepEqual(fitTextBoxToWords({ left: 10, top: 20, height: 30 }, 50.2, 6), { left: 10, top: 20, height: 63 });
  assert.deepEqual(fitTextBoxToWords({ left: 10, top: 20, height: 235 }, 14, 6), { left: 10, top: 20, height: 26 }, 'a tall box comes back down');
  assert.deepEqual(fitTextBoxToWords({ left: 10, top: 20, height: 26 }, 14, 6), { left: 10, top: 20, height: 26 });
  assert.deepEqual(fitTextBoxToWords({ left: 10, top: 20, height: 30 }, null, 6), { left: 10, top: 20, height: 30 });
  const shrunk = fitTextBoxToWords({ left: 0, top: 0, height: 40, angle: 90 }, 8, 6);
  assert.equal(shrunk.height, 20);
  assert.ok(Math.abs(shrunk.left - 10) < 1e-9);
  assert.ok(Math.abs(shrunk.top - 10) < 1e-9);
  assert.equal(FEATURE_FLAGS['text-fit-height']?.stage, 'beta');
});

test('the measuring probe keeps a numeric font weight unitless, so bold text measures bold', () => {
  assert.equal(probeStyleValue('fontWeight', 700), '700');
  assert.equal(probeStyleValue('lineHeight', 1.2), '1.2');
  assert.equal(probeStyleValue('fontSize', 14), '14px');
  assert.equal(probeStyleValue('fontWeight', 'bold'), 'bold');
  assert.match(readFileSync(new URL('../src/utils/textContentMeasure.js', import.meta.url), 'utf8'), /probe\.style\[key\] = probeStyleValue\(key, value\)/);
});
