import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getInverseScale, inverseScaleFromWidth } from '../src/utils/svgTransformMath.js';

const SRC = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');

test('inverse scale from a width matches the clientWidth reading', () => {
  assert.equal(inverseScaleFromWidth(1224, 612), 0.5);
  assert.equal(inverseScaleFromWidth(0, 612), 1);
  assert.equal(getInverseScale({ clientWidth: 306 }, 612), 2);
  assert.equal(getInverseScale({ clientWidth: 0 }, 612), 1);
});

test('a mounting page layer starts from the last measured value and measures from the ResizeObserver, not clientWidth', () => {
  assert.match(SRC, /useState\(\(\) => lastInverseScaleByPageWidth\.get\(pageWidth\) \?\? 1\)/);
  assert.doesNotMatch(SRC, /setInverseScale\(getInverseScale\(svgEl, pageWidth\)\)/);
  assert.match(SRC, /const width = entries\[entries\.length - 1\]\?\.contentRect\?\.width \|\| 0;/);
  assert.match(SRC, /latestWidth > 0 \? inverseScaleFromWidth\(latestWidth, pageWidth\)/);
  // The deferred retune keeps the cache current.
  assert.match(SRC, /lastInverseScaleByPageWidth\.set\(pageWidth, next\);\n\s+startTransition\(\(\) => setInverseScale\(next\)\);/);
});
