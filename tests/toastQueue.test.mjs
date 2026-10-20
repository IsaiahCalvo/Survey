// Drawboard shell audit, Chunk A (2026-10-13): the toast clock behind
// <ToastHost>. Per-type times (info / success 3 s, error / warn 9 s), pause on
// hover, an optional action button (Undo), a two-step exit, de-dupe and the
// 4-toast cap. Driven with a fake clock so the numbers are exact.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createToastStore } from '../src/utils/toastQueue.js';
import { MOTION_MS, TOAST_DURATION_MS, exitMs, toastDurationMs, prefersReducedMotion } from '../src/utils/motion.js';

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { seq += 1; timers.set(seq, { at: now + ms, fn }); return seq; },
    clearTimeout: (h) => { timers.delete(h); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

function storeWith(clock, extra = {}) {
  return createToastStore({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now, ...extra });
}

const ids = (store) => store.getToasts().map((t) => t.message);
const leaving = (store) => store.getToasts().filter((t) => t.leaving).map((t) => t.message);

test('per-type times: success and info 3 s, error and warn 9 s (Drawboard), then a 120 ms exit', () => {
  const clock = fakeClock();
  const store = storeWith(clock);
  store.add({ message: 'Saved', type: 'success' });
  store.add({ message: 'Note', type: 'info' });
  store.add({ message: 'Failed', type: 'error' });
  store.add({ message: 'Careful', type: 'warn' });
  clock.advance(2999);
  assert.deepEqual(leaving(store), []);
  clock.advance(1);
  assert.deepEqual(leaving(store), ['Saved', 'Note'], 'success / info start leaving at 3 s');
  clock.advance(MOTION_MS.toastExit);
  assert.deepEqual(ids(store), ['Failed', 'Careful'], 'and are gone after the exit');
  clock.advance(9000 - 3000 - MOTION_MS.toastExit - 1);
  assert.deepEqual(leaving(store), []);
  clock.advance(1);
  assert.deepEqual(leaving(store), ['Failed', 'Careful'], 'error / warn leave at 9 s');
  clock.advance(MOTION_MS.toastExit);
  assert.deepEqual(ids(store), []);
  assert.equal(clock.pending(), 0);
});

test('an unknown type is shown as info (3 s); a caller duration wins; <= 0 / Infinity stays until dismissed', () => {
  const clock = fakeClock();
  const store = storeWith(clock);
  store.add({ message: 'Odd', type: 'shout' });
  assert.equal(store.getToasts()[0].type, 'info');
  store.add({ message: 'Long', type: 'success', duration: 7000 });
  const sticky = store.add({ message: 'Sticky', type: 'error', duration: 0 });
  store.add({ message: 'Forever', type: 'info', duration: Infinity });
  clock.advance(3000);
  assert.deepEqual(leaving(store), ['Odd']);
  clock.advance(4000);
  assert.deepEqual(leaving(store), ['Long']);
  clock.advance(60_000);
  assert.deepEqual(ids(store), ['Sticky', 'Forever']);
  assert.equal(store.remainingMs(sticky), Infinity);
  store.dismiss(sticky);
  clock.advance(MOTION_MS.toastExit);
  assert.deepEqual(ids(store), ['Forever']);
});

test('hover pauses the clock and leaving resumes it with the time that was left', () => {
  const clock = fakeClock();
  const store = storeWith(clock);
  const id = store.add({ message: 'Saved', type: 'success' });
  clock.advance(1000);
  store.pause(id);
  clock.advance(10_000);
  assert.deepEqual(leaving(store), [], 'nothing leaves while hovered');
  assert.equal(store.remainingMs(id), 2000);
  store.resume(id);
  clock.advance(1999);
  assert.deepEqual(leaving(store), []);
  clock.advance(1);
  assert.deepEqual(leaving(store), ['Saved']);
  // pause / resume twice in a row are harmless
  store.pause(id); store.pause(id); store.resume(id); store.resume(id);
});

test('the action button runs once and closes the toast; a leaving toast takes no action', () => {
  const clock = fakeClock();
  const store = storeWith(clock);
  let undone = 0;
  const id = store.add({ message: 'Moved to Archive', type: 'info', action: { label: 'Undo', onClick: () => { undone += 1; } } });
  assert.deepEqual(store.getToasts()[0].action.label, 'Undo');
  assert.equal(store.runAction(id), true);
  assert.equal(store.runAction(id), false, 'a second press during the exit does nothing');
  assert.equal(undone, 1);
  assert.deepEqual(leaving(store), ['Moved to Archive']);
  clock.advance(MOTION_MS.toastExit);
  assert.deepEqual(ids(store), []);
  // An action without onClick is dropped (plain toast).
  store.add({ message: 'Plain', action: { label: 'Nope' } });
  assert.equal(store.getToasts()[0].action, null);
  // An action that throws still closes the toast.
  const bad = store.add({ message: 'Throws', action: { onClick: () => { throw new Error('x'); } } });
  assert.equal(store.runAction(bad), true);
  assert.equal(store.getToasts().find((t) => t.id === bad).leaving, true);
});

test('exit time 0 (reduced motion) removes at once; de-dupe; the stack keeps at most 4', () => {
  const clock = fakeClock();
  const store = storeWith(clock, { exitMs: () => 0 });
  const a = store.add({ message: 'Same', type: 'error' });
  const b = store.add({ message: 'Same', type: 'error' });
  assert.equal(a, b, 'an identical message on screen is not shown twice');
  assert.deepEqual(ids(store), ['Same']);
  store.dismiss(a);
  assert.deepEqual(ids(store), [], 'gone at once, no exit');
  for (let i = 1; i <= 6; i += 1) store.add({ message: `M${i}`, type: 'info' });
  assert.deepEqual(ids(store), ['M3', 'M4', 'M5', 'M6']);
  // With an exit, the over-cap toast plays its exit (still counted as leaving).
  const clock2 = fakeClock();
  const store2 = storeWith(clock2);
  for (let i = 1; i <= 5; i += 1) store2.add({ message: `N${i}` });
  assert.deepEqual(leaving(store2), ['N1']);
  assert.equal(store2.getToasts().filter((t) => !t.leaving).length, 4);
  // A leaving toast does not block the same message coming back.
  store2.add({ message: 'N1' });
  assert.equal(store2.getToasts().filter((t) => t.message === 'N1').length, 2);
});

test('subscribe / dispose: listeners see every change and dispose clears every timer', () => {
  const clock = fakeClock();
  const store = storeWith(clock);
  const seen = [];
  const off = store.subscribe((list) => seen.push(list.length));
  store.add({ message: 'One' });
  store.add({ message: 'Two' });
  assert.deepEqual(seen, [1, 2]);
  off();
  store.add({ message: 'Three' });
  assert.deepEqual(seen, [1, 2]);
  assert.ok(store.pendingTimers() > 0);
  store.dispose();
  assert.equal(store.pendingTimers(), 0);
  assert.equal(clock.pending(), 0, 'no timer left behind');
  assert.deepEqual(store.getToasts(), []);
  assert.equal(store.add({ message: '' }), null);
  assert.equal(store.add(null), null);
});

test('motion helpers: toast times, exit times, reduced motion', () => {
  assert.deepEqual({ ...TOAST_DURATION_MS }, { info: 3000, success: 3000, warn: 9000, error: 9000 });
  assert.equal(toastDurationMs('error'), 9000);
  assert.equal(toastDurationMs('nope'), 3000);
  assert.equal(toastDurationMs('info', 1234), 1234);
  assert.equal(toastDurationMs('info', 0), Infinity);
  assert.equal(toastDurationMs('info', -5), Infinity);
  assert.equal(toastDurationMs('info', Infinity), Infinity);
  const calm = { matchMedia: () => ({ matches: false }) };
  const reduce = { matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) };
  assert.equal(prefersReducedMotion(calm), false);
  assert.equal(prefersReducedMotion(reduce), true);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(exitMs('toast', calm), 120);
  assert.equal(exitMs('dialog', calm), 120);
  assert.equal(exitMs('menu', calm), 80);
  assert.equal(exitMs('unknown', calm), 120);
  assert.equal(exitMs('dialog', reduce), 0);
});

test('an explicit id replaces a standing or leaving toast so the latest action stays on that id', () => {
  const clock = fakeClock();
  const store = storeWith(clock);
  let applied = '';
  const first = store.add({
    message: 'Smart fill found this outline. Check it, then Apply.',
    type: 'info',
    id: 'smart-fill-preview',
    duration: Infinity,
    action: { label: 'Apply', onClick: () => { applied = 'first'; } },
  });
  assert.equal(first, 'smart-fill-preview');
  store.dismiss('smart-fill-preview');
  assert.equal(store.getToasts()[0].leaving, true);
  const second = store.add({
    message: 'Smart fill found this outline. Check it, then Apply.',
    type: 'info',
    id: 'smart-fill-preview',
    duration: Infinity,
    action: { label: 'Apply', onClick: () => { applied = 'second'; } },
  });
  assert.equal(second, 'smart-fill-preview');
  assert.equal(store.getToasts().length, 1);
  assert.equal(store.getToasts()[0].leaving, false);
  assert.equal(store.runAction('smart-fill-preview'), true);
  assert.equal(applied, 'second', 'Apply commits the latest outline, not the leaving one');
});

test('onDismiss runs when the toast starts leaving, not when the same id is replaced', () => {
  const clock = fakeClock();
  const store = storeWith(clock);
  const seen = [];
  store.add({
    message: 'Preview',
    type: 'info',
    id: 'smart-fill-preview',
    duration: Infinity,
    onDismiss: () => { seen.push('first'); },
  });
  store.add({
    message: 'Preview',
    type: 'info',
    id: 'smart-fill-preview',
    duration: Infinity,
    onDismiss: () => { seen.push('second'); },
  });
  assert.deepEqual(seen, [], 'replacing the same id does not treat it as a dismiss');
  store.dismiss('smart-fill-preview');
  assert.deepEqual(seen, ['second']);
  clock.advance(MOTION_MS.toastExit);
  assert.deepEqual(seen, ['second'], 'the exit does not run it again');
});

test('showToast passes an action, a duration and an id through the bus; dismissToast asks the host to close it', async () => {
  const events = [];
  const prevWindow = globalThis.window;
  const prevEvent = globalThis.CustomEvent;
  class FakeCustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  globalThis.CustomEvent = FakeCustomEvent;
  globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; } };
  try {
    const { showToast, dismissToast } = await import('../src/utils/toast.js');
    const onClick = () => {};
    const onDismiss = () => {};
    const id = showToast('Moved to Archive', 'info', { action: { label: 'Undo', onClick }, duration: 5000, id: 'archive-1', onDismiss });
    assert.equal(id, 'archive-1');
    assert.equal(events[0].type, 'app-toast');
    assert.deepEqual(events[0].detail, { message: 'Moved to Archive', type: 'info', id: 'archive-1', action: { label: 'Undo', onClick }, onDismiss, duration: 5000 });
    // The old two-argument call is unchanged (no action / duration keys).
    const plain = showToast('Saved', 'success');
    assert.equal(typeof plain, 'string');
    assert.deepEqual(Object.keys(events[1].detail).sort(), ['id', 'message', 'type']);
    assert.equal(showToast('', 'error'), null);
    dismissToast('archive-1');
    assert.equal(events[2].type, 'app-toast-dismiss');
    assert.deepEqual(events[2].detail, { id: 'archive-1' });
  } finally {
    globalThis.window = prevWindow;
    globalThis.CustomEvent = prevEvent;
  }
});
