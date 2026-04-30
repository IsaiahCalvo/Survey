// tests/phase35/undoToastQueue.test.mjs
// Phase 35 Wave 0 scaffold (Plan 35-01) — runs as test.skip until Plan 35-04
// lands src/hooks/useUndoToast.js.
//
// Per-test existsSync skip-guard pattern lifted verbatim from Phase 27/28/29
// scaffolds. Each test inlines the skip guard so the file auto-flips from
// all-skipped to all-running the moment Plan 35-04 commits the production
// hook.
//
// LOCKED enqueue signature (frontmatter contract — Plans 35-04 / 35-06 consume
// this verbatim):
//
//   enqueue({ kind: 'single' | 'bulk', message: string, count?: number,
//             onUndo: () => void })
//   dismiss()
//   toast: { kind, message, count?, onUndo } | null
//
// Behavior contract:
//   - kind: 'single' → 5000ms auto-dismiss (CONTEXT.md: "5-second undo toast")
//   - kind: 'bulk'   → 6000ms auto-dismiss (CONTEXT.md: "6-second undo toast")
//   - Single-toast queue (NOT a stack): enqueueing a second toast replaces the
//     first and clears its pending timer. Matches CONTEXT.md "5/6 second window"
//     simplicity — UI never shows two toasts at once.
//   - Clicking Undo fires the onUndo callback exactly once and clears the toast.
//   - Unmount clears any pending timer (no setTimeout leak).
//   - kind defaults to 'single' (5s) when omitted.
//
// To keep this module Node-runnable (no React renderer), the test harness
// expects the production module to expose two surfaces:
//   - default export: `useUndoToast` React hook (consumed by Plan 35-04 UI)
//   - named export:   `createUndoToastQueue({ now?, setTimeout?, clearTimeout? })`
//                     pure factory returning `{ enqueue, dismiss, getToast,
//                     onChange, dispose }` for non-React consumers and tests.
// The hook is a thin wrapper over the queue. These tests target the queue
// factory directly so the contract is engine-agnostic.
//
// See .planning/phases/35-per-user-delete-authority-confirm-before-wipe/35-CONTEXT.md
// "Single-annotation delete (regular case, all roles)" + "Confirmation modal"
// after-confirm sections for the design rationale.

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/hooks/useUndoToast.js');
const TARGET_URL = pathToFileURL(TARGET).href;

// --- Fake timers --------------------------------------------------------
//
// Manual scheduler so tests can advance time deterministically without
// real setTimeout. Plan 35-04 production hook accepts injected setTimeout/
// clearTimeout via the createUndoToastQueue factory.

function makeFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map(); // id -> { fireAt, fn }
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fireAt: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      // Fire timers in due order.
      let safety = 1000;
      while (safety-- > 0) {
        let nextDue = null;
        for (const [, t] of timers) {
          if (t.fireAt <= target && (nextDue === null || t.fireAt < nextDue.fireAt)) {
            nextDue = t;
          }
        }
        if (!nextDue) break;
        now = nextDue.fireAt;
        // Find and remove the matching timer entry.
        for (const [id, t] of timers) {
          if (t === nextDue) {
            timers.delete(id);
            break;
          }
        }
        nextDue.fn();
      }
      now = target;
    },
    pendingCount() {
      return timers.size;
    },
  };
}

// --- Tests --------------------------------------------------------------

test(
  "undoToastQueue #1: enqueue({ kind: 'single', message: 'Annotation deleted', onUndo }) schedules a 5000ms auto-dismiss timer; toast.message === 'Annotation deleted', toast.kind === 'single'",
  { skip: !existsSync(TARGET) ? 'useUndoToast module not yet present (Plan 35-04)' : false },
  async () => {
    const { createUndoToastQueue } = await import(TARGET_URL);
    const clock = makeFakeClock();
    const q = createUndoToastQueue({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      now: clock.now,
    });

    let undoCalls = 0;
    q.enqueue({ kind: 'single', message: 'Annotation deleted', onUndo: () => { undoCalls += 1; } });

    let toast = q.getToast();
    ok(toast, 'toast present after enqueue');
    strictEqual(toast.kind, 'single');
    strictEqual(toast.message, 'Annotation deleted');

    // Just before 5000ms — still present.
    clock.advance(4999);
    toast = q.getToast();
    ok(toast, 'toast still present at 4999ms');

    // At 5000ms — dismissed.
    clock.advance(1);
    toast = q.getToast();
    strictEqual(toast, null, 'toast auto-dismissed at 5000ms for kind:single');
    strictEqual(undoCalls, 0, 'auto-dismiss does NOT fire onUndo');
  },
);

test(
  "undoToastQueue #2: enqueue({ kind: 'bulk', message, count: 12, onUndo }) schedules a 6000ms auto-dismiss timer; toast.count === 12, toast.kind === 'bulk'",
  { skip: !existsSync(TARGET) ? 'useUndoToast module not yet present (Plan 35-04)' : false },
  async () => {
    const { createUndoToastQueue } = await import(TARGET_URL);
    const clock = makeFakeClock();
    const q = createUndoToastQueue({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      now: clock.now,
    });

    q.enqueue({ kind: 'bulk', message: '12 annotations deleted', count: 12, onUndo: () => {} });

    let toast = q.getToast();
    ok(toast, 'toast present after enqueue');
    strictEqual(toast.kind, 'bulk');
    strictEqual(toast.count, 12);
    strictEqual(toast.message, '12 annotations deleted');

    // Just before 6000ms — still present.
    clock.advance(5999);
    toast = q.getToast();
    ok(toast, 'toast still present at 5999ms');

    // At 6000ms — dismissed.
    clock.advance(1);
    toast = q.getToast();
    strictEqual(toast, null, 'toast auto-dismissed at 6000ms for kind:bulk');
  },
);

test(
  'undoToastQueue #3: clicking Undo before the timer expires fires the onUndo callback exactly once and clears the toast',
  { skip: !existsSync(TARGET) ? 'useUndoToast module not yet present (Plan 35-04)' : false },
  async () => {
    const { createUndoToastQueue } = await import(TARGET_URL);
    const clock = makeFakeClock();
    const q = createUndoToastQueue({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      now: clock.now,
    });

    let undoCalls = 0;
    q.enqueue({ kind: 'single', message: 'x', onUndo: () => { undoCalls += 1; } });

    clock.advance(2000);
    const toast = q.getToast();
    ok(toast, 'toast still present at 2000ms');
    // Invoke the captured onUndo through the toast surface — production hook
    // also exposes this as `q.undo()` which triggers onUndo + clears the toast.
    toast.onUndo();
    q.dismiss();

    strictEqual(undoCalls, 1, 'onUndo fired exactly once');
    strictEqual(q.getToast(), null, 'toast cleared after Undo');

    // Advance past the original timer — onUndo must NOT fire again.
    clock.advance(10000);
    strictEqual(undoCalls, 1, 'auto-dismiss timer cancelled — no second onUndo invocation');
  },
);

test(
  'undoToastQueue #4: a second toast enqueued before the first expires replaces the first (single-toast queue, not stack — matches CONTEXT.md "5/6 second window" simplicity)',
  { skip: !existsSync(TARGET) ? 'useUndoToast module not yet present (Plan 35-04)' : false },
  async () => {
    const { createUndoToastQueue } = await import(TARGET_URL);
    const clock = makeFakeClock();
    const q = createUndoToastQueue({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      now: clock.now,
    });

    let firstUndo = 0;
    let secondUndo = 0;
    q.enqueue({ kind: 'single', message: 'first', onUndo: () => { firstUndo += 1; } });
    clock.advance(1000);

    q.enqueue({ kind: 'single', message: 'second', onUndo: () => { secondUndo += 1; } });
    const toast = q.getToast();
    strictEqual(toast.message, 'second', 'second toast replaces first');

    // Advance past the FIRST toast's original 5000ms — it must NOT fire its
    // onUndo, because re-enqueuing cleared its pending timer.
    clock.advance(4001); // total = 5001ms since first enqueue
    strictEqual(firstUndo, 0, 'first toast onUndo never fired (timer was cleared)');

    // Second toast must still be alive at 4001ms post-second-enqueue (5s window).
    ok(q.getToast(), 'second toast still present');

    clock.advance(999); // hit the second toast's 5000ms mark
    strictEqual(q.getToast(), null, 'second toast auto-dismissed at its own 5000ms mark');
  },
);

test(
  'undoToastQueue #5: unmount clears any pending timer (no setTimeout leak)',
  { skip: !existsSync(TARGET) ? 'useUndoToast module not yet present (Plan 35-04)' : false },
  async () => {
    const { createUndoToastQueue } = await import(TARGET_URL);
    const clock = makeFakeClock();
    const q = createUndoToastQueue({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      now: clock.now,
    });

    q.enqueue({ kind: 'bulk', message: 'x', count: 5, onUndo: () => {} });
    strictEqual(clock.pendingCount(), 1, 'one pending auto-dismiss timer');

    q.dispose();
    strictEqual(clock.pendingCount(), 0, 'dispose() clears all pending timers');
    strictEqual(q.getToast(), null, 'toast cleared on dispose');
  },
);

test(
  "undoToastQueue #6: enqueue contract — required keys are { kind, message, onUndo }; count is optional and only meaningful for kind:'bulk'. Calling enqueue without kind defaults to 'single' (5s).",
  { skip: !existsSync(TARGET) ? 'useUndoToast module not yet present (Plan 35-04)' : false },
  async () => {
    const { createUndoToastQueue } = await import(TARGET_URL);
    const clock = makeFakeClock();
    const q = createUndoToastQueue({
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      now: clock.now,
    });

    // Contract: enqueue({ kind, message, onUndo }) — no count needed for single.
    q.enqueue({ kind: 'single', message: 'no count', onUndo: () => {} });
    let toast = q.getToast();
    strictEqual(toast.kind, 'single');
    strictEqual(toast.count, undefined, 'count absent on kind:single (optional)');

    // Default-kind: enqueue({ message, onUndo }) — kind defaults to 'single'.
    q.enqueue({ message: 'default kind', onUndo: () => {} });
    toast = q.getToast();
    strictEqual(toast.kind, 'single', 'kind defaults to "single" when omitted');

    clock.advance(4999);
    ok(q.getToast(), 'still present at 4999ms (5s window for default kind)');
    clock.advance(1);
    strictEqual(q.getToast(), null, 'auto-dismiss at 5000ms for default kind');

    // Bulk: enqueue({ kind, message, count, onUndo }) — count surfaces in toast.
    q.enqueue({ kind: 'bulk', message: 'bulk path', count: 47, onUndo: () => {} });
    toast = q.getToast();
    strictEqual(toast.kind, 'bulk');
    strictEqual(toast.count, 47, 'count surfaces on bulk toasts for "Deleted N annotations" copy');
  },
);
