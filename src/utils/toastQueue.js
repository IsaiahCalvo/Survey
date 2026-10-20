// src/utils/toastQueue.js
//
// The state behind <ToastHost> (KAL-57 toast bus), kept free of React so the
// timing can be tested with a fake clock (tests/toastQueue.test.mjs).
//
// Drawboard shell audit, Chunk A (2026-10-13):
//   - How long a toast stays depends on its type: info / success 3 s,
//     error / warn 9 s (Drawboard's numbers; ours was 4.5 s for every type).
//     A caller may pass its own `duration`; <= 0 or Infinity = stays until
//     dismissed.
//   - Hover (or keyboard focus) pauses the clock; leaving resumes it with the
//     time that was left.
//   - An optional action button ({ label, onClick }, e.g. Undo): pressing it
//     runs onClick once and dismisses the toast.
//   - Leaving is two steps: the toast is first marked `leaving` (the host
//     plays the exit animation), then removed after `exitMs()` (0 under
//     reduced motion, so it goes at once).
//   - Kept from before: an identical message already on screen is not shown
//     twice, and at most `max` (4) toasts stand at once (the oldest leaves).

import { MOTION_MS, toastDurationMs } from './motion.js';

const TYPES = new Set(['info', 'success', 'error', 'warn']);

export function createToastStore({
  setTimeout: setT = (fn, ms) => setTimeout(fn, ms),
  clearTimeout: clearT = (h) => clearTimeout(h),
  now = () => Date.now(),
  max = 4,
  exitMs = () => MOTION_MS.toastExit,
} = {}) {
  let toasts = [];
  const timers = new Map(); // id -> { handle, startedAt, remaining, paused }
  const removals = new Map(); // id -> handle
  const listeners = new Set();
  let seq = 0;

  const notify = () => {
    const snapshot = toasts;
    listeners.forEach((fn) => { try { fn(snapshot); } catch { /* a listener must not break the queue */ } });
  };

  const stopTimer = (id) => {
    const t = timers.get(id);
    if (t?.handle != null) clearT(t.handle);
    timers.delete(id);
  };

  const startTimer = (id, ms) => {
    if (!Number.isFinite(ms)) {
      timers.set(id, { handle: null, startedAt: now(), remaining: Infinity, paused: false });
      return;
    }
    const handle = setT(() => dismiss(id), Math.max(0, ms));
    timers.set(id, { handle, startedAt: now(), remaining: ms, paused: false });
  };

  function remove(id) {
    stopTimer(id);
    const r = removals.get(id);
    if (r != null) clearT(r);
    removals.delete(id);
    const next = toasts.filter((t) => t.id !== id);
    if (next.length !== toasts.length) {
      toasts = next;
      notify();
    }
  }

  function dismiss(requestedId) {
    // A caller id that was still held by a leaving toast went to the newer
    // toast as `key` (see add), so dismissToast(callerId) must reach it too.
    const toast = toasts.find((t) => t.id === requestedId && !t.leaving)
      || toasts.find((t) => t.key === requestedId && !t.leaving);
    if (!toast) return;
    const { id } = toast;
    stopTimer(id);
    const ms = Number(exitMs()) || 0;
    if (ms <= 0) {
      remove(id);
      return;
    }
    toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    notify();
    removals.set(id, setT(() => remove(id), ms));
  }

  function add(detail = {}) {
    if (detail == null || detail.message == null || detail.message === '') return null;
    const message = String(detail.message);
    const existing = toasts.find((t) => !t.leaving && t.message === message);
    if (existing) return existing.id; // de-dupe rapid repeats
    const type = TYPES.has(detail.type) ? detail.type : 'info';
    // A toast that is only playing its exit must not keep its id: otherwise
    // the new toast gets a random id and a later dismiss(id) can't reach it
    // (Smart fill "Find more" left "looking for matching tags…" up forever).
    if (detail.id != null && toasts.some((t) => t.leaving && t.id === String(detail.id))) remove(String(detail.id));
    const id = detail.id != null && !toasts.some((t) => t.id === detail.id)
      ? String(detail.id)
      : `toast-${now()}-${(seq += 1)}`;
    const action = detail.action && typeof detail.action.onClick === 'function'
      ? { label: String(detail.action.label || 'Undo'), onClick: detail.action.onClick }
      : null;
    toasts = [...toasts, { id, key: detail.id != null ? String(detail.id) : id, message, type, action, leaving: false }];
    startTimer(id, toastDurationMs(type, detail.duration));
    // Cap the stack so a runaway loop can't paper over the screen.
    const standing = toasts.filter((t) => !t.leaving);
    notify();
    if (standing.length > max) {
      standing.slice(0, standing.length - max).forEach((t) => dismiss(t.id));
    }
    return id;
  }

  function pause(id) {
    const t = timers.get(id);
    if (!t || t.paused) return;
    if (t.handle != null) clearT(t.handle);
    const remaining = Number.isFinite(t.remaining) ? Math.max(0, t.remaining - (now() - t.startedAt)) : Infinity;
    timers.set(id, { handle: null, startedAt: now(), remaining, paused: true });
  }

  function resume(id) {
    const t = timers.get(id);
    if (!t || !t.paused) return;
    startTimer(id, t.remaining);
  }

  function runAction(id) {
    const toast = toasts.find((t) => t.id === id);
    if (!toast || toast.leaving || !toast.action) return false;
    // Take this toast down first: onClick may show a follow-up under the same
    // caller id, and that one must stay up.
    dismiss(id);
    try { toast.action.onClick(); } catch { /* the caller's error stays its own */ }
    return true;
  }

  return {
    add,
    dismiss,
    pause,
    resume,
    runAction,
    getToasts: () => toasts,
    /** ms left on a toast's clock (Infinity = sticky, null = unknown id). */
    remainingMs: (id) => {
      const t = timers.get(id);
      if (!t) return null;
      if (!Number.isFinite(t.remaining)) return Infinity;
      return t.paused ? t.remaining : Math.max(0, t.remaining - (now() - t.startedAt));
    },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      timers.forEach((t) => { if (t.handle != null) clearT(t.handle); });
      removals.forEach((h) => clearT(h));
      timers.clear();
      removals.clear();
      toasts = [];
      listeners.clear();
    },
    pendingTimers: () => [...timers.values()].filter((t) => t.handle != null).length + removals.size,
  };
}
