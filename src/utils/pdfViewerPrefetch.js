const DEFAULT_DELAY_MS = 1200;
const DEFAULT_IDLE_TIMEOUT_MS = 2500;

// Open speed: the scheduled prefetch waits for the home screen to settle, but
// a press on a document row says the viewer is about to be needed: fetch it
// now (preloadPdfViewerNow), so "Open file" does not start from nothing.
let fetchNow = null;
export function preloadPdfViewerNow() {
  fetchNow?.();
}

export function schedulePdfViewerPrefetch(loadViewer, {
  windowObject = typeof window === 'undefined' ? null : window,
  delayMs = DEFAULT_DELAY_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
} = {}) {
  if (!windowObject || typeof loadViewer !== 'function') return () => {};

  let cancelled = false;
  let started = false;
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
    if (started) return;
    if (windowObject.navigator?.onLine === false) {
      windowObject.addEventListener?.('online', onOnline, { once: true });
      return;
    }
    started = true;
    void Promise.resolve(loadViewer()).catch(() => {});
  };
  fetchNow = run;

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
    if (fetchNow === run) fetchNow = null;
    windowObject.removeEventListener?.('load', scheduleIdle);
    windowObject.removeEventListener?.('online', onOnline);
    if (timerId !== null) windowObject.clearTimeout?.(timerId);
    if (idleId !== null) windowObject.cancelIdleCallback?.(idleId);
  };
}
