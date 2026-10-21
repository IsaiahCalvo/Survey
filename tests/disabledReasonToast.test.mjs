import test from 'node:test';
import assert from 'node:assert/strict';
import { activateOrExplain, showDisabledReason, DISABLED_REASON_TOAST_ID } from '../src/utils/disabledReasonToast.js';
import { createToastStore } from '../src/utils/toastQueue.js';

test('a blocked item toasts its reason and never runs the action', () => {
  const toasts = [];
  let ran = 0;
  const result = activateOrExplain('Only the owner can delete this', () => { ran += 1; }, (d) => toasts.push(d));
  assert.equal(result, false);
  assert.equal(ran, 0);
  assert.deepEqual(toasts, [{ message: 'Only the owner can delete this', type: 'info', id: DISABLED_REASON_TOAST_ID }]);
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

test('a second reason replaces the first instead of stacking', () => {
  const store = createToastStore({ exitMs: () => 0, setTimeout: () => 0, clearTimeout: () => {} });
  // Same order the browser dispatch uses: take the old reason down, then add.
  const dispatch = (d) => { store.dismiss(d.id); store.add(d); };
  activateOrExplain('Only the owner can share some of these', null, dispatch);
  activateOrExplain('Only the owner can delete some of these', null, dispatch);
  const standing = store.getToasts().filter((t) => !t.leaving);
  assert.deepEqual(standing.map((t) => t.message), ['Only the owner can delete some of these']);
});
