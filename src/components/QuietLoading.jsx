// The one loading state (owner 2026-10-04): a single quiet line of text in the
// middle of the space that is waiting — "Opening <file>…", "Loading
// documents…". No spinner, no bar, no pulsing skeleton, the same on desktop and
// phone.
//
// It shows nothing for the first SHOW_AFTER_MS, so a fast open never flashes a
// loading screen at all, then fades the text in. An open can pass through
// several of these in a row (the app shell, the viewer code arriving, the PDF
// parsing, the page sizes) — they count as ONE: a QuietLoading that mounts
// while another is up, or right after one went away, keeps the first one's
// clock, so the text never blinks off and back on and never restarts its wait.

import { useEffect, useState } from 'react';

export const QUIET_LOADING_SHOW_AFTER_MS = 300;
// A gap shorter than this between two loading states still counts as one.
export const QUIET_LOADING_CONTINUITY_MS = 400;

let mountedCount = 0;
let startedAt = 0;
let lastGoneAt = Number.NEGATIVE_INFINITY;
let lastLabel = null;

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

// Pure: how long (ms) the text still waits before fading in. Negative once the
// wait is over, which starts the fade already finished.
export function resolveQuietLoadingDelay({ startedAtMs, nowMs, showAfterMs = QUIET_LOADING_SHOW_AFTER_MS }) {
  return Math.round(showAfterMs - (nowMs - startedAtMs));
}

// Pure: whether a new loading state continues the one before it.
export function continuesQuietLoading({ mounted, lastGoneAtMs, nowMs, continuityMs = QUIET_LOADING_CONTINUITY_MS }) {
  return mounted > 0 || (nowMs - lastGoneAtMs) <= continuityMs;
}

// "Opening Site plan…" — the file's own name, without ".pdf".
export function openingLabel(name) {
  const base = String(name || '').trim().replace(/\.pdf$/i, '').trim();
  return base ? `Opening ${base}…` : 'Opening…';
}

const QUIET_LOADING_CSS = `
@keyframes quietLoadingIn { from { opacity: 0; } to { opacity: 1; } }
.quiet-loading-text {
  max-width: min(80%, 440px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  letter-spacing: 0;
  color: var(--text-3);
  opacity: 0;
  animation: quietLoadingIn 220ms ease-out both;
}
/* 2026-10-07 (phone loading): on a phone the line always sits at the middle of
   the viewer's page area (between its 34px header and the dock), not of
   whichever box happens to be loading. One open passes through three boxes
   (the home while the PDF downloads, the viewer's frame while its code
   arrives, the page area while the PDF parses) whose middles were 34-52px
   apart, so the same words jumped twice on the way in. The page area itself
   is a containing box for fixed children (contain: strict), so inside it the
   middle is simply 50%. */
@media (max-width: 720px) {
  .quiet-loading-text {
    --quiet-phone-header-h: calc(34px + env(safe-area-inset-top, 0px));
    --quiet-phone-dock-h: calc(36px + max(10px, var(--native-safe-area-bottom, env(safe-area-inset-bottom, 0px))));
    position: fixed;
    left: 50%;
    top: calc((var(--quiet-phone-header-h) + 100% - var(--quiet-phone-dock-h)) / 2);
    transform: translate(-50%, -50%);
  }
  html[data-native-shell="expo"] .quiet-loading-text { --quiet-phone-header-h: 34px; }
  .survey-pdfjs-viewer .quiet-loading-text { top: 50%; }
}
@media (prefers-reduced-motion: reduce) {
  .quiet-loading-text { animation-duration: 1ms; }
}
`;

// `label` may be left out by a step that does not know what is opening (the
// page-size step inside the PDF engine); it then keeps the words already on
// screen.
export default function QuietLoading({ label, background = 'transparent', style }) {
  const [{ delayMs, shownLabel }] = useState(() => {
    const t = now();
    const continues = continuesQuietLoading({ mounted: mountedCount, lastGoneAtMs: lastGoneAt, nowMs: t });
    if (!continues) { startedAt = t; lastLabel = null; }
    const resolved = label || lastLabel || 'Opening…';
    if (label) lastLabel = label;
    return { delayMs: resolveQuietLoadingDelay({ startedAtMs: startedAt, nowMs: t }), shownLabel: resolved };
  });
  useEffect(() => {
    mountedCount += 1;
    return () => {
      mountedCount -= 1;
      if (mountedCount === 0) lastGoneAt = now();
    };
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      data-quiet-loading="true"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background,
        pointerEvents: 'none',
        ...style,
      }}
    >
      <style>{QUIET_LOADING_CSS}</style>
      <span className="quiet-loading-text" style={{ animationDelay: `${delayMs}ms` }}>{label || shownLabel}</span>
    </div>
  );
}
