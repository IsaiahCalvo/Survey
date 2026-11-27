/**
 * Coalesces and rate-limits passive tab-visibility / window-focus refetches.
 *
 * Several list and project hooks subscribe to both `visibilitychange` and
 * `window.focus`, which often fire back-to-back on a single Alt+Tab (causing
 * duplicate queries) and re-query large tables on rapid window switches.
 *
 * - Passive triggers (`{ force: false }`) skip when hidden/offline, join any
 *   in-flight run, and enforce `minIntervalMs` since the last run started.
 * - Explicit triggers (`{ force: true }`, e.g. mount, local write, user reload)
 *   always run (sequencing after any in-flight run so fresh mutations are never
 *   dropped or overtaken by an older read).
 */

export const DEFAULT_FOCUS_REFRESH_MIN_MS = 15_000;

const defaultIsVisible = () => (
  typeof document === 'undefined' || document.visibilityState !== 'hidden'
);
const defaultIsOnline = () => (
  typeof navigator === 'undefined' || navigator.onLine !== false
);

export function createFocusRefreshGuard({
  minIntervalMs = DEFAULT_FOCUS_REFRESH_MIN_MS,
  now = () => Date.now(),
  isVisible = defaultIsVisible,
  isOnline = defaultIsOnline,
} = {}) {
  let lastStartedAt = -Infinity;
  let inFlight = null;

  const start = (fn) => {
    lastStartedAt = now();
    let promise;
    promise = Promise.resolve()
      .then(() => fn())
      .finally(() => {
        if (inFlight === promise) inFlight = null;
      });
    inFlight = promise;
    return promise;
  };

  return {
    run(fn, { force = false } = {}) {
      if (typeof fn !== 'function') return null;
      if (!force) {
        if (!isVisible() || !isOnline()) return null;
        if (inFlight) return inFlight;
        if (now() - lastStartedAt < minIntervalMs) return null;
        return start(fn);
      }
      if (inFlight) {
        const previous = inFlight;
        let next;
        next = previous
          .catch(() => undefined)
          .then(() => {
            lastStartedAt = now();
            return fn();
          })
          .finally(() => {
            if (inFlight === next) inFlight = null;
          });
        inFlight = next;
        return next;
      }
      return start(fn);
    },
    isInFlight: () => Boolean(inFlight),
    lastRunAt: () => lastStartedAt,
    reset() {
      lastStartedAt = -Infinity;
    },
  };
}
