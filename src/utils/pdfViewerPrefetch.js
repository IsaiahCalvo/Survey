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

  const run = () => {
    if (cancelled) return;
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
    if (timerId !== null) windowObject.clearTimeout?.(timerId);
    if (idleId !== null) windowObject.cancelIdleCallback?.(idleId);
  };
}
