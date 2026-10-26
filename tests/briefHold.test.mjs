// useBriefHold (owner note 2026-10-26, item 38): a pick swapped for another
// goes through a render with nothing picked; the survey bar must not leave
// and come back for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_HOLD_MS, resolveBriefHold } from '../src/hooks/useBriefHold.js';

test('true is true', () => {
  assert.equal(resolveBriefHold(true, -Infinity, 0), true);
});

test('a gap shorter than the hold still counts as true', () => {
  assert.equal(resolveBriefHold(false, 1000, 1016), true);
  assert.equal(resolveBriefHold(false, 1000, 1000 + BRIEF_HOLD_MS - 1), true);
});

test('a real drop lands once the hold runs out', () => {
  assert.equal(resolveBriefHold(false, 1000, 1000 + BRIEF_HOLD_MS), false);
  assert.equal(resolveBriefHold(false, -Infinity, 5), false);
});
