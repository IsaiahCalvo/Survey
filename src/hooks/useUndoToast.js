// src/hooks/useUndoToast.js
//
// Phase 35 Plan 04 — single-toast undo queue. Two surfaces:
//
//   - createUndoToastQueue({ now?, setTimeout?, clearTimeout? })
//       Pure factory returning { enqueue, dismiss, getToast, onChange,
//       dispose, undo }. Used by Plan 35-01 Wave 0 unit tests
//       (tests/phase35/undoToastQueue.test.mjs) — engine-agnostic so the
//       contract is verifiable without React.
//
//   - useUndoToast()
//       React hook returning { toast, enqueue, dismiss }. Thin wrapper
//       around the factory; consumed by App.jsx's bulk-delete + single-
//       delete paths.
//
// LOCKED enqueue signature (Plan 35-01 frontmatter contract — Plans 35-04
// / 35-06 consume this verbatim):
//
//   enqueue({ kind: 'single' | 'bulk', message: string, count?: number,
//             onUndo: () => void })
//
// Behavior:
//   - kind 'single' → 5000ms auto-dismiss (CONTEXT.md "5-second undo toast")
//   - kind 'bulk'   → 6000ms auto-dismiss (CONTEXT.md "6-second undo toast")
//   - Single-toast queue (NOT a stack): enqueueing a second toast replaces
//     the first and clears its pending timer. Matches CONTEXT.md "5/6 second
//     window" simplicity — UI never shows two toasts at once.
//   - Clicking Undo fires onUndo exactly once and clears the toast.
//   - Unmount / dispose clears any pending timer (no setTimeout leak).
//   - kind defaults to 'single' (5s) when omitted.

import { useState, useEffect, useRef, useCallback } from 'react';

const TTL_SINGLE_MS = 5000;
const TTL_BULK_MS = 6000;

/**
 * Pure factory for the single-toast undo queue. Engine-agnostic so unit
 * tests can drive it with a fake clock. The React hook below wraps this.
 *
 * @param {object} [options]
 * @param {() => number}              [options.now]
 * @param {(fn: () => void, ms: number) => any} [options.setTimeout]
 * @param {(handle: any) => void}     [options.clearTimeout]
 * @returns {{
 *   enqueue: (input: { kind?: 'single'|'bulk', message: string, count?: number, onUndo: () => void }) => void,
 *   dismiss: () => void,
 *   undo: () => void,
 *   getToast: () => null | { kind: 'single'|'bulk', message: string, count?: number, onUndo: () => void },
 *   onChange: (listener: (toast: any) => void) => (() => void),
 *   dispose: () => void
 * }}
 */
export function createUndoToastQueue(options = {}) {
  const _setTimeout = typeof options?.setTimeout === 'function' ? options.setTimeout : setTimeout;
  const _clearTimeout = typeof options?.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;

  let toast = null;
  let timerHandle = null;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try { fn(toast); } catch { /* listener errors must not break the queue */ }
    }
  }

  function clearActiveTimer() {
    if (timerHandle != null) {
      _clearTimeout(timerHandle);
      timerHandle = null;
    }
  }

  function enqueue(input) {
    // Locked signature per Plan 35-01: { kind, message, count?, onUndo }.
    const kind = input?.kind === 'bulk' ? 'bulk' : 'single';  // default: single
    const next = {
      kind,
      message: typeof input?.message === 'string' ? input.message : '',
      // count is optional and meaningful only for kind:'bulk'; preserve
      // undefined when omitted so test #6 (count absent on single) passes.
      count: input?.count,
      onUndo: typeof input?.onUndo === 'function' ? input.onUndo : () => {},
    };
    clearActiveTimer();
    toast = next;
    const ttl = kind === 'bulk' ? TTL_BULK_MS : TTL_SINGLE_MS;
    timerHandle = _setTimeout(() => {
      timerHandle = null;
      toast = null;
      notify();
    }, ttl);
    notify();
  }

  function dismiss() {
    clearActiveTimer();
    toast = null;
    notify();
  }

  function undo() {
    // Convenience: invokes the captured onUndo and clears the toast in one
    // call. UI button handlers can call enqueueResult.onUndo() then dismiss();
    // this is the same effect via a single API.
    if (toast && typeof toast.onUndo === 'function') {
      try { toast.onUndo(); } catch { /* user callback errors stay isolated */ }
    }
    dismiss();
  }

  function getToast() {
    return toast;
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function dispose() {
    // Clears any pending auto-dismiss timer + clears the active toast +
    // drops listeners. Test #5 asserts pendingCount() === 0 post-dispose.
    clearActiveTimer();
    toast = null;
    listeners.clear();
  }

  return { enqueue, dismiss, undo, getToast, onChange, dispose };
}

/**
 * React hook wrapping createUndoToastQueue. Returns the active toast and the
 * enqueue/dismiss API. Used by App.jsx's bulk-delete path (kind: 'bulk') and
 * its handleSaveAnnotations single-delete hook (kind: 'single').
 */
export function useUndoToast() {
  const [toast, setToast] = useState(null);
  const queueRef = useRef(null);

  if (queueRef.current === null) {
    queueRef.current = createUndoToastQueue();
  }

  useEffect(() => {
    const queue = queueRef.current;
    if (!queue || typeof queue.onChange !== 'function') return undefined;
    const off = queue.onChange((next) => {
      setToast(next);
    });
    // Sync initial state in case enqueue ran before subscription (defensive).
    setToast(queue.getToast());
    return () => {
      off();
      // dispose clears pending timers — prevents setTimeout leak across
      // unmount per Plan 35-01 test #5.
      queue.dispose();
      queueRef.current = null;
    };
  }, []);

  const enqueue = useCallback((input) => {
    if (queueRef.current) queueRef.current.enqueue(input);
  }, []);

  const dismiss = useCallback(() => {
    if (queueRef.current) queueRef.current.dismiss();
  }, []);

  return { toast, enqueue, dismiss };
}
