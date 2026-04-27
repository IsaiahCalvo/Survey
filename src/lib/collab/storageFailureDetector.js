// src/lib/collab/storageFailureDetector.js
// Phase 27 - IndexedDB failure-event subscriber.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md Pattern 4 + Code Examples
// Defends: silent-fallback anti-pattern (CONTEXT.md decision - users MUST know when local saving is offline)
//
// Why a custom detector and not y-indexeddb's onError: y-indexeddb (#25) does not surface
// IDBRequest errors on its public API. Subscribing at the browser-API level (window.unhandledrejection)
// is the only way to catch all four documented IDB error names.

const IDB_ERROR_TO_CODE = {
  QuotaExceededError: 'quota_exceeded',
  InvalidStateError:  'invalid_state',
  VersionError:       'version_mismatch',
};

const CODE_TO_MESSAGE = {
  quota_exceeded:    'Local storage is full.',
  invalid_state:     'Local storage is unavailable in this browser context (often private browsing).',
  version_mismatch:  'Local cache was made by a newer version. Clear browser cache to fix.',
};

/**
 * Attach a listener that fires `onState` when IDB-related errors land on
 * window.unhandledrejection. Returns a `detach` function that cleanly removes
 * all listeners.
 *
 * @param {object} options
 * @param {(state: {code: string, message: string, error?: Error}) => void} options.onState
 * @param {Window} [options.windowRef] - Optional window-like override for testing.
 *   When omitted, uses the real `window` global. Lets the Plan 27-01 scaffold
 *   inject a fake window without touching real DOM.
 * @returns {{ detach: () => void }}
 */
export function attachStorageFailureDetector(options) {
  const onState = options?.onState;
  if (typeof onState !== 'function') {
    throw new Error('[storageFailureDetector] options.onState callback is required');
  }

  // Resolve the window target: explicit windowRef > globalThis.window > undefined.
  // SSR-safe: in a non-browser env (server-side render, node test without globalThis.window),
  // return a no-op detach so callers never crash.
  const windowRef = options?.windowRef
    ?? (typeof window !== 'undefined' ? window : undefined);

  if (!windowRef || typeof windowRef.addEventListener !== 'function') {
    return { detach: () => {} };
  }

  const handlers = [];
  const wrap = (eventName, handler) => {
    windowRef.addEventListener(eventName, handler);
    handlers.push(() => windowRef.removeEventListener(eventName, handler));
  };

  const onUnhandled = (event) => {
    const errorName = event?.reason?.name;
    const code = IDB_ERROR_TO_CODE[errorName];
    if (!code) return;
    onState({
      code,
      message: CODE_TO_MESSAGE[code],
      error: event.reason,
    });
  };

  wrap('unhandledrejection', onUnhandled);

  return {
    detach() {
      for (const off of handlers) off();
      handlers.length = 0;
    },
  };
}
