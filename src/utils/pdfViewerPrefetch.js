const DEFAULT_DELAY_MS = 1200;
const DEFAULT_IDLE_TIMEOUT_MS = 2500;

export function schedulePdfViewerPrefetch(loadViewer, {
  windowObject = typeof window === 'undefined' ? null : window,
  delayMs = DEFAULT_DELAY_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
} = {}) {
  if (!windowObject || typeof loadViewer !== 'function') return () => {};

  let cancelled = false;
  let timerId = null;
  let idleId = null;

  // 2026-10-07 (phone loading): never fetch the viewer while the device says
  // it is offline - wait for the connection instead. A prefetch that failed
  // offline fired main.jsx's stale-deploy reload (a "No internet" page on a
  // phone that had only lost signal), and the browser remembers a failed module
  // download for the life of the page, so the first document opened later
  // could not load either.
  const onOnline = () => run();
  const run = () => {
    if (cancelled) return;
    if (windowObject.navigator?.onLine === false) {
      windowObject.addEventListener?.('online', onOnline, { once: true });
      return;
    }
    void Promise.resolve(loadViewer()).catch(() => {});
  };

  const scheduleIdle = () => {
    if (cancelled) return;
    timerId = windowObject.setTimeout(() => {
      timerId = null;
      if (cancelled) return;
      if (typeof windowObject.requestIdleCallback === 'function') {
        idleId = windowObject.requestIdleCallback(run, { timeout: idleTimeoutMs });
      } else {
        run();
      }
    }, delayMs);
  };

  if (windowObject.document?.readyState === 'complete') {
    scheduleIdle();
  } else {
    windowObject.addEventListener?.('load', scheduleIdle, { once: true });
  }

  return () => {
    cancelled = true;
    windowObject.removeEventListener?.('load', scheduleIdle);
    windowObject.removeEventListener?.('online', onOnline);
    if (timerId !== null) windowObject.clearTimeout?.(timerId);
    if (idleId !== null) windowObject.cancelIdleCallback?.(idleId);
  };
}
