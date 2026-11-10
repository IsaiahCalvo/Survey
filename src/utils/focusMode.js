/**
 * focusMode.js — the keys and the browser full screen for focus mode
 * (Nightly, flag 'focus-mode'; Drawboard PDF Pro trial audit 2026-11-09).
 *
 * Focus mode hides the tab strip and both side rails so the drawing gets the
 * screen, and asks the browser for full screen. Ctrl/Cmd+Shift+F, the rail
 * button, or the Exit chip that always shows turn it off again; leaving the
 * browser's full screen (Esc) does too.
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
