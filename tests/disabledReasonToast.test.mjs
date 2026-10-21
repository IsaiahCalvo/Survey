import test from 'node:test';
import assert from 'node:assert/strict';
import { activateOrExplain, showDisabledReason } from '../src/utils/disabledReasonToast.js';

test('a blocked item toasts its reason and never runs the action', () => {
  const toasts = [];
  let ran = 0;
  const result = activateOrExplain('Only the owner can delete this', () => { ran += 1; }, (d) => toasts.push(d));
  assert.equal(result, false);
  assert.equal(ran, 0);
  assert.deepEqual(toasts, [{ message: 'Only the owner can delete this', type: 'info' }]);
});

test('an allowed item runs the action without a toast', () => {
  const toasts = [];
  let ran = 0;
  assert.equal(activateOrExplain(null, () => { ran += 1; }, (d) => toasts.push(d)), true);
  assert.equal(ran, 1);
  assert.equal(toasts.length, 0);
});

test('no reason, no toast', () => {
  const toasts = [];
  showDisabledReason('', (d) => toasts.push(d));
  assert.equal(toasts.length, 0);
});
