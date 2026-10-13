import { useEffect, useRef } from 'react';

// A home list that failed to load tries again by itself (owner 2026-10-07: the
// phone "doesn't automatically load"). It used to wait on its Try again button
// for ever, even after the connection came back. Now it retries when the
// connection returns, when the app comes back to the front, and on a widening
// timer, and stops the moment a read succeeds (the error clears, so `active`
// goes false). The button stays for anyone who does not want to wait.
export const AUTO_RETRY_DELAYS_MS = [3000, 6000, 12000, 24000, 30000];

export function nextAutoRetryDelay(attempt) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, AUTO_RETRY_DELAYS_MS.length - 1));
  return AUTO_RETRY_DELAYS_MS[index];
}

export default function useAutoRetryLoad(active, retry) {
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    let attempt = 0;
    let timer = null;
    let stopped = false;
    let inFlight = false;

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, nextAutoRetryDelay(attempt));
      attempt += 1;
    };
    function run() {
      if (stopped || inFlight) return;
      // No point asking while the device says it is offline; the 'online'
      // event below brings the next try forward.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        schedule();
        return;
      }
      inFlight = true;
      Promise.resolve()
        .then(() => retryRef.current?.())
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (!stopped) schedule();
        });
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    schedule();
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
}
