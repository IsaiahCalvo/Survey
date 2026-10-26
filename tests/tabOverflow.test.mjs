import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTabs } from '../src/reorder/tabOverflow.js';

test('all tabs fit: nothing in the menu', () => {
  assert.deepEqual(fitTabs({ widths: [80, 80, 80], available: 240, moreWidth: 40 }), { visible: [0, 1, 2], hidden: [] });
});

test('too many: leading tabs that fit beside the more button', () => {
  // 300 - 40 = 260 room: 80 + 80 + 80 fit, the fourth does not.
  assert.deepEqual(fitTabs({ widths: [80, 80, 80, 80, 80], available: 300, moreWidth: 40 }), { visible: [0, 1, 2], hidden: [3, 4] });
});

test('the open tab is always shown, in the last place', () => {
  assert.deepEqual(fitTabs({ widths: [80, 80, 80, 80, 80], available: 300, moreWidth: 40, activeIndex: 4 }), { visible: [0, 1, 4], hidden: [2, 3] });
  // A wide open tab pushes out as many as it needs.
  assert.deepEqual(fitTabs({ widths: [80, 80, 80, 80, 200], available: 300, moreWidth: 40, activeIndex: 4 }), { visible: [4], hidden: [0, 1, 2, 3] });
});

test('at least one tab, even when none fits', () => {
  assert.deepEqual(fitTabs({ widths: [500, 500], available: 300, moreWidth: 40 }), { visible: [0], hidden: [1] });
  assert.deepEqual(fitTabs({ widths: [500, 500], available: 300, moreWidth: 40, activeIndex: 1 }), { visible: [1], hidden: [0] });
});

test('no tabs', () => {
  assert.deepEqual(fitTabs({ widths: [], available: 300, moreWidth: 40 }), { visible: [], hidden: [] });
});
