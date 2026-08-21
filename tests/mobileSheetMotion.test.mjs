import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHEET_CLOSE_MS,
  SHEET_DISMISS_DY,
  SHEET_DISMISS_VY,
  createSheetCloseController,
  prefersReducedMotion,
  shouldDismissSheet,
} from '../src/mobile/useMobileSheetMotion.js';

test('dismiss thresholds match the demo (dy>82 or vy>0.65)', () => {
  assert.equal(shouldDismissSheet(SHEET_DISMISS_DY, 0), false);
  assert.equal(shouldDismissSheet(SHEET_DISMISS_DY + 1, 0), true);
  assert.equal(shouldDismissSheet(10, SHEET_DISMISS_VY), false);
  assert.equal(shouldDismissSheet(10, SHEET_DISMISS_VY + 0.01), true);
  assert.equal(shouldDismissSheet(0, 0), false);
});

test('close timer is cancellable so a reopen cannot inherit the previous dismiss', () => {
  const calls = [];
  let now = 0;
  const timers = new Map();
  let nextId = 1;
  const setTimeoutFn = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, fireAt: now + ms });
    return id;
  };
  const clearTimeoutFn = (id) => {
    timers.delete(id);
  };
  const flush = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers.entries()]) {
      if (timer.fireAt <= now) {
        timers.delete(id);
        timer.fn();
      }
    }
  };

  const controller = createSheetCloseController(setTimeoutFn, clearTimeoutFn);
  controller.schedule(() => calls.push('first-close'), SHEET_CLOSE_MS);
  assert.equal(controller.isPending(), true);

  controller.cancel();
  controller.schedule(() => calls.push('second-close'), SHEET_CLOSE_MS);
  flush(SHEET_CLOSE_MS);

  assert.deepEqual(calls, ['second-close']);
  assert.equal(controller.isPending(), false);
});

test('a stale scheduled close is a no-op after cancel', () => {
  let captured = null;
  const setTimeoutFn = (fn) => {
    captured = fn;
    return 1;
  };
  const controller = createSheetCloseController(setTimeoutFn, () => {});
  const fired = [];
  controller.schedule(() => fired.push('late'), 170);
  controller.cancel();
  captured();
  assert.deepEqual(fired, []);
});

test('prefers-reduced-motion is false when matchMedia is missing', () => {
  assert.equal(prefersReducedMotion(undefined), false);
  assert.equal(prefersReducedMotion(() => ({ matches: true })), true);
  assert.equal(prefersReducedMotion(() => ({ matches: false })), false);
});
