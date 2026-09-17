/**
 * Auto-select after a mark is drawn — the Drawboard PDF contract.
 *
 * Draw a shape and it comes up already selected, handles showing, tool still
 * armed. Free-form ink does not: Drawboard leaves a pen or highlighter stroke
 * unselected so the next stroke is not fighting a set of handles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_SELECT_AFTER_COMMIT_TOOLS,
  NO_AUTO_SELECT_TOOLS,
  shouldAutoSelectAfterCommit,
} from '../src/utils/autoSelectAfterCommit.js';
import { readFileSync } from 'node:fs';

// Read the layer's own tool lists out of the source so this test fails the day
// a new drawing tool is added without a ruling below.
const layerSource = readFileSync(
  new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
  'utf8',
);
const toolListFromSource = (name) => {
  const match = layerSource.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
  assert.ok(match, `could not find ${name} in SVGAnnotationLayer.jsx`);
  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
};
const CREATION_TOOLS = [
  ...toolListFromSource('SHAPE_CREATION_TOOLS'),
  ...toolListFromSource('FREEHAND_CREATION_TOOLS'),
  'polygon',
  'polyline',
  'counter',
  'text',
  'callout',
];

test('every shape tool comes up selected the moment it commits', () => {
  for (const tool of ['rect', 'ellipse', 'line', 'arrow', 'polygon', 'polyline', 'counter']) {
    assert.equal(shouldAutoSelectAfterCommit(tool), true, `${tool} should auto-select`);
  }
});

test('free-form ink stays unselected', () => {
  assert.equal(shouldAutoSelectAfterCommit('pen'), false);
  assert.equal(shouldAutoSelectAfterCommit('highlighter'), false);
});

test('tools that open their own editor are not also selected', () => {
  // Text and callout drop straight into typing; a selection on top would fight
  // the caret. Survey markers are not annotation objects at all.
  assert.equal(shouldAutoSelectAfterCommit('text'), false);
  assert.equal(shouldAutoSelectAfterCommit('callout'), false);
  assert.equal(shouldAutoSelectAfterCommit('survey-marker'), false);
});

test('the two lists never claim the same tool', () => {
  for (const tool of AUTO_SELECT_AFTER_COMMIT_TOOLS) {
    assert.equal(NO_AUTO_SELECT_TOOLS.includes(tool), false, `${tool} is on both lists`);
  }
});

test('a missing or junk tool name selects nothing', () => {
  assert.equal(shouldAutoSelectAfterCommit(undefined), false);
  assert.equal(shouldAutoSelectAfterCommit(null), false);
  assert.equal(shouldAutoSelectAfterCommit(''), false);
  assert.equal(shouldAutoSelectAfterCommit(42), false);
});

test('every drag-out and click-to-place tool the layer knows about has a ruling', () => {
  // Guards against a new tool silently defaulting to "not selected" — if a tool
  // is added to the creation lists it must be put on one of the two lists here.
  for (const tool of CREATION_TOOLS) {
    const ruled = AUTO_SELECT_AFTER_COMMIT_TOOLS.includes(tool)
      || NO_AUTO_SELECT_TOOLS.includes(tool);
    assert.equal(ruled, true, `${tool} has no auto-select ruling`);
  }
});
