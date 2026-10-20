// src/utils/toast.js
//
// KAL-57 — lightweight global toast bus. `showToast()` dispatches an event that
// <ToastHost> (mounted once at the app root) renders as a non-blocking pill.
// This is the in-app replacement for native `alert()`: same fire-and-forget
// semantics (alert() never returned a value either), but it doesn't freeze the
// thread or look like a browser system dialog.
//
// type: 'info' | 'success' | 'error' | 'warn' — controls the tint and how long
// the toast stays (Drawboard shell audit 2026-10-13: info / success 3 s,
// error / warn 9 s; src/utils/motion.js TOAST_DURATION_MS).
// Default 'error' because the large majority of the call sites we replaced were
// failure / "couldn't do that" messages; pass 'success'/'info' explicitly for
// the positive ones.
//
// options (all optional, added 2026-10-13):
//   action   { label, onClick }  one button on the toast (e.g. Undo). Pressing
//                                it runs onClick once and dismisses the toast.
//   duration ms                  overrides the per-type time; <= 0 or Infinity
//                                keeps it until dismissToast(id) or a click.
//   id       string              your own id (to dismiss it later).
// Returns the toast id (or null when nothing was shown).

const newId = () => `${Math.round(performance.now())}-${Math.random().toString(36).slice(2, 8)}`;

export function showToast(message, type = 'error', options = {}) {
  if (typeof window === 'undefined' || message == null || message === '') return null;
  const opts = options && typeof options === 'object' ? options : {};
  // Unique enough to key the React list and de-dupe rapid repeats.
  const id = opts.id != null ? String(opts.id) : newId();
  try {
    const detail = { message: String(message), type, id };
    if (opts.action && typeof opts.action.onClick === 'function') {
      detail.action = { label: String(opts.action.label || 'Undo'), onClick: opts.action.onClick };
    }
    if (opts.duration !== undefined) detail.duration = opts.duration;
    window.dispatchEvent(new CustomEvent('app-toast', { detail }));
  } catch (_e) {
    // Last-ditch fallback so a notification is never silently lost if event
    // dispatch is somehow unavailable (very old webview, SSR).
    try { console.warn('[toast]', message); } catch (_e2) { /* swallow */ }
  }
  return id;
}

/** Take a toast down early (it plays its exit). Unknown ids are ignored. */
export function dismissToast(id) {
  if (typeof window === 'undefined' || id == null) return;
  try {
    window.dispatchEvent(new CustomEvent('app-toast-dismiss', { detail: { id: String(id) } }));
  } catch (_e) { /* nothing to take down */ }
}
