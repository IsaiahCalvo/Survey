/**
 * realtimePolicy.js — Shared Realtime backoff + hidden-tab subscription gating.
 *
 * Reduces Postgres `realtime.list_changes` load and prevents synchronized
 * thundering-herd reconnect storms when Supabase Realtime or Micro Postgres
 * restarts or drops connections:
 *   1. `computeRealtimeReconnectDelayMs` — exponential backoff with ±25% jitter
 *      (higher ceiling while the tab is hidden).
 *   2. `createVisibilityGatedSubscription` — pauses non-critical `postgres_changes`
 *      channels after a short grace window when `document.visibilityState === 'hidden'`,
 *      then re-subscribes with small jitter + optional catch-up refresh when the
 *      tab becomes visible again. No-op pass-through when `document` is absent
 *      (e.g., Node unit tests).
 */

export const REALTIME_RECONNECT_BASE_MS = 1_000;
export const REALTIME_RECONNECT_MAX_MS = 60_000;
export const REALTIME_RECONNECT_HIDDEN_MAX_MS = 120_000;
export const REALTIME_RECONNECT_JITTER_RATIO = 0.25;

export const DEFAULT_HIDDEN_UNSUBSCRIBE_GRACE_MS = 15_000;
export const DEFAULT_VISIBLE_RESUME_JITTER_MS = 1_500;

/**
 * Exponential reconnect delay for `@supabase/supabase-js` `realtime.reconnectAfterMs`.
 * Spreads reconnects across clients with ±25% jitter so an outage recovery does
 * not slam Postgres + Realtime in lockstep every 10 seconds.
 *
 * @param {number} tries - 1-based reconnect attempt count from RealtimeClient.
 * @param {{ hidden?: boolean, random?: () => number }} [options]
 * @returns {number} delay in milliseconds
 */
export function computeRealtimeReconnectDelayMs(
  tries,
  {
    hidden = typeof document !== 'undefined' && document?.visibilityState === 'hidden',
    random = Math.random,
  } = {},
) {
  const attempt = Math.max(1, Math.floor(Number(tries) || 1));
  const cap = hidden ? REALTIME_RECONNECT_HIDDEN_MAX_MS : REALTIME_RECONNECT_MAX_MS;
  const raw = Math.min(cap, REALTIME_RECONNECT_BASE_MS * (2 ** Math.min(attempt - 1, 10)));
  const rawRand = typeof random === 'function' ? random() : 0.5;
  const r = Number.isFinite(rawRand) ? Math.min(1, Math.max(0, rawRand)) : 0.5;
  const jitterFactor = 1 + ((r * 2 - 1) * REALTIME_RECONNECT_JITTER_RATIO);
  return Math.max(REALTIME_RECONNECT_BASE_MS, Math.round(raw * jitterFactor));
}

/**
 * Wraps a subscribe/unsubscribe pair so non-critical `postgres_changes` channels
 * detach while the browser tab sits hidden (after `hiddenGraceMs`) and re-attach
 * with a small random jitter (`0..resumeJitterMs`) plus an optional catch-up
 * callback when the user returns.
 *
 * @param {object} config
 * @param {() => (() => void)|void} config.subscribe
 * @param {() => void} [config.onResume]
 * @param {number} [config.hiddenGraceMs]
 * @param {number} [config.resumeJitterMs]
 * @param {Document|null} [config.doc]
 * @param {() => number} [config.random]
 * @returns {{ dispose: () => void, isSubscribed: () => boolean }}
 */
export function createVisibilityGatedSubscription({
  subscribe,
  onResume = null,
  hiddenGraceMs = DEFAULT_HIDDEN_UNSUBSCRIBE_GRACE_MS,
  resumeJitterMs = DEFAULT_VISIBLE_RESUME_JITTER_MS,
  doc = typeof document !== 'undefined' ? document : null,
  random = Math.random,
} = {}) {
  let disposed = false;
  let teardown = null;
  let hideTimer = null;
  let resumeTimer = null;
  let pausedByHidden = false;

  const isHidden = () => Boolean(doc && doc.visibilityState === 'hidden');

  const clearTimers = () => {
    if (hideTimer != null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (resumeTimer != null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };

  const detach = () => {
    const fn = teardown;
    teardown = null;
    if (typeof fn === 'function') {
      try { fn(); } catch { /* best-effort teardown */ }
    }
  };

  const attach = (resuming = false) => {
    if (disposed || teardown) return;
    if (typeof subscribe !== 'function') return;
    const cleanup = subscribe();
    teardown = typeof cleanup === 'function' ? cleanup : () => {};
    if (resuming && typeof onResume === 'function') {
      try { onResume(); } catch { /* best-effort catch-up */ }
    }
  };

  const onVisibilityChange = () => {
    if (disposed) return;
    if (isHidden()) {
      if (resumeTimer != null) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
      if (!teardown || hideTimer != null) return;
      const delay = Math.max(0, Number(hiddenGraceMs) || 0);
      if (delay === 0) {
        pausedByHidden = true;
        detach();
        return;
      }
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (disposed || !isHidden()) return;
        pausedByHidden = true;
        detach();
      }, delay);
      return;
    }

    // Tab is visible again.
    if (hideTimer != null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (teardown || resumeTimer != null) return;
    const wasPaused = pausedByHidden;
    pausedByHidden = false;
    const maxJitter = Math.max(0, Number(resumeJitterMs) || 0);
    const rawRand = typeof random === 'function' ? random() : 0;
    const r = Number.isFinite(rawRand) ? Math.min(1, Math.max(0, rawRand)) : 0;
    const delay = maxJitter > 0 ? Math.round(r * maxJitter) : 0;
    if (delay === 0) {
      attach(wasPaused);
      return;
    }
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (disposed || isHidden()) return;
      attach(wasPaused);
    }, delay);
  };

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', onVisibilityChange);
  }

  if (isHidden()) {
    pausedByHidden = true;
  } else {
    attach(false);
  }

  return {
    isSubscribed: () => Boolean(teardown),
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('visibilitychange', onVisibilityChange);
      }
      detach();
    },
  };
}
