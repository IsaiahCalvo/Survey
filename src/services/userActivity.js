/**
 * "Is the user in the middle of something?" for background work.
 *
 * Thumbnail work must never compete with a pen stroke, a drag, a pinch or
 * typing (owner 2026-09-23: lightweight, no work while drawing). Any pointer
 * held down, or any input in the last `quietMs`, counts as busy, as does a
 * hidden window. Listeners are passive capture listeners installed once, on
 * first use, so they cost nothing until something asks.
 */

let installed = false;
let pointersDown = 0;
let lastInputAt = 0;

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const touch = () => { lastInputAt = Date.now(); };
  const down = () => { pointersDown += 1; touch(); };
  const up = () => { pointersDown = Math.max(0, pointersDown - 1); touch(); };
  const options = { capture: true, passive: true };
  window.addEventListener('pointerdown', down, options);
  window.addEventListener('pointerup', up, options);
  window.addEventListener('pointercancel', up, options);
  window.addEventListener('keydown', touch, options);
  window.addEventListener('wheel', touch, options);
  // A pointer released outside the window never sends pointerup here.
  window.addEventListener('blur', () => { pointersDown = 0; }, options);
}

export function isUserBusy({ quietMs = 1500 } = {}) {
  install();
  if (typeof document !== 'undefined' && document.hidden) return true;
  if (pointersDown > 0) return true;
  return Date.now() - lastInputAt < quietMs;
}
