// src/utils/toast.js
//
// KAL-57 — lightweight global toast bus. `showToast()` dispatches an event that
// <ToastHost> (mounted once at the app root) renders as a non-blocking pill.
// This is the in-app replacement for native `alert()`: same fire-and-forget
// semantics (alert() never returned a value either), but it doesn't freeze the
// thread or look like a browser system dialog.
//
// type: 'info' | 'success' | 'error' | 'warn' — controls the accent stripe only.
// Default 'error' because the large majority of the call sites we replaced were
// failure / "couldn't do that" messages; pass 'success'/'info' explicitly for
// the positive ones.

export function showToast(message, type = 'error') {
  if (typeof window === 'undefined' || message == null || message === '') return;
  try {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: String(message),
          type,
          // Unique enough to key the React list and de-dupe rapid repeats.
          id: `${Math.round(performance.now())}-${Math.random().toString(36).slice(2, 8)}`,
        },
      })
    );
  } catch (_e) {
    // Last-ditch fallback so a notification is never silently lost if event
    // dispatch is somehow unavailable (very old webview, SSR).
    try { console.warn('[toast]', message); } catch (_e2) { /* swallow */ }
  }
}

