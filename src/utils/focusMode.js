/**
 * focusMode.js — the keys and the browser full screen behind the rail's
 * Full screen button (flag 'focus-mode').
 *
 * Owner 2026-11-10: full screen keeps the tabs, both rails and the tool bar
 * (Survey mode must still work); it only hides the browser and system bars.
 * Ctrl/Cmd+Shift+F or the rail button toggle it; Esc leaves it too.
 */

/** Ctrl/Cmd+Shift+F, by key code so every layout has it. */
export function isFocusModeKey(event) {
  if (!event || event.altKey || !event.shiftKey || !(event.metaKey || event.ctrlKey)) return false;
  return event.code === 'KeyF' || String(event.key).toLowerCase() === 'f';
}

export async function enterBrowserFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  const el = doc?.documentElement;
  if (!el?.requestFullscreen || doc.fullscreenElement) return false;
  try {
    await el.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false; // not allowed here (an iframe, a policy): focus mode still works
  }
}

export function leaveBrowserFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  if (doc?.fullscreenElement && doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
}
