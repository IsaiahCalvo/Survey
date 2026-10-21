// The loading state for opening a document (owner 2026-10-20, after studying
// Drawboard PDF; supersedes the 2026-10-04 "one quiet line, faint outline"):
// recorded 2026-10-20: Drawboard draws NO fake page while a PDF opens (a
// letter-shaped skeleton lies about landscape/odd sizes). Its viewer chrome is
// up at once and the canvas shows only a small centred mark over a thin
// 3px progress bar until the real page appears whole. We show the bar
// (indeterminate: parse progress is not plumbed here) over the
// "Opening <name>…" caption. Library loads use the row skeletons in Skeleton.jsx instead.
//
// It shows nothing for the first SHOW_AFTER_MS, so a fast open never flashes a
// loading screen at all, then fades in. An open can pass through
// several of these in a row (the app shell, the viewer code arriving, the PDF
// parsing, the page sizes) — they count as ONE: a QuietLoading that mounts
// while another is up, or right after one went away, keeps the first one's
// clock, so the page never blinks off and back on and never restarts its wait.

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
.quiet-loading-stack { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  width: 100%; height: 100%; padding: 24px; box-sizing: border-box; }
.quiet-loading-bar { position: relative; flex: none; width: 120px; height: 3px; border-radius: 2px; overflow: hidden;
  background: color-mix(in srgb, var(--text-3) 22%, transparent); opacity: 0;
  animation: quietLoadingIn 220ms ease-out both; pointer-events: none; }
.quiet-loading-bar::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; border-radius: 2px;
  background: var(--text-2, var(--text-3)); animation: quietLoadingBar 1.4s ease-in-out infinite; }
@keyframes quietLoadingBar { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
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
@media screen and (max-device-width: 599px), screen and (max-device-height: 599px) {
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
  /* 2026-10-21: the "Opening <name>…" bar + caption pin as ONE stack at that
     same middle, so the bar shows on phones too and the two never part. */
  .quiet-loading-stack {
    --quiet-phone-header-h: calc(34px + env(safe-area-inset-top, 0px));
    --quiet-phone-dock-h: calc(36px + max(10px, var(--native-safe-area-bottom, env(safe-area-inset-bottom, 0px))));
    position: fixed;
    /* the page area starts right of the 36px tool rail, which is up at once */
    left: calc(50% + 18px);
    top: calc((var(--quiet-phone-header-h) + 100% - var(--quiet-phone-dock-h)) / 2);
    transform: translate(-50%, -50%);
    width: max-content;
    max-width: 80vw;
    height: auto;
    padding: 0;
  }
  html[data-native-shell="expo"] .quiet-loading-stack { --quiet-phone-header-h: 34px; }
  .survey-pdfjs-viewer .quiet-loading-stack { left: 50%; top: 50%; }
  .quiet-loading-stack .quiet-loading-text { position: static; transform: none; max-width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .quiet-loading-text, .quiet-loading-bar { animation-duration: 1ms; }
  .quiet-loading-bar::after { animation: none; left: 30%; }
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
      {(label || shownLabel).startsWith('Opening') ? (
        <div className="quiet-loading-stack">
          <span aria-hidden="true" className="quiet-loading-bar" style={{ animationDelay: `${delayMs}ms` }} />
          <span className="quiet-loading-text" style={{ animationDelay: `${delayMs}ms` }}>{label || shownLabel}</span>
        </div>
      ) : (
        <span className="quiet-loading-text" style={{ animationDelay: `${delayMs}ms` }}>{label || shownLabel}</span>
      )}
    </div>
  );
}
