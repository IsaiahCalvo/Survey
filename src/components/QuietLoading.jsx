// The loading state for opening a document (owner 2026-10-20, after studying
// Drawboard PDF; supersedes the 2026-10-04 "one quiet line, faint outline"):
// a letter-shaped page skeleton with a few text-line placeholders and one
// soft sweep (components/skeleton.css), with the "Opening <name>…" caption
// under it. Library loads use the row skeletons in Skeleton.jsx instead.
//
// It shows nothing for the first SHOW_AFTER_MS, so a fast open never flashes a
// loading screen at all, then fades in. An open can pass through
// several of these in a row (the app shell, the viewer code arriving, the PDF
// parsing, the page sizes) — they count as ONE: a QuietLoading that mounts
// while another is up, or right after one went away, keeps the first one's
// clock, so the page never blinks off and back on and never restarts its wait.

import { useEffect, useState } from 'react';
import { SkeletonBlock } from './Skeleton';

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
.quiet-loading-page { position: relative; flex: none; height: min(72%, 860px); aspect-ratio: 612 / 792; max-width: 86%;
  box-sizing: border-box; border-radius: 2px; background: var(--surface-2); border: 1px solid var(--border);
  box-shadow: 0 2px 14px rgba(0,0,0,0.25); opacity: 0; overflow: hidden;
  display: flex; flex-direction: column; gap: 12px; padding: 44px 40px;
  animation: quietLoadingIn 220ms ease-out both; pointer-events: none; }
.quiet-loading-page .sk-block { --sk-glow: color-mix(in srgb, var(--text-3) 16%, var(--surface-3)); }
.quiet-loading-page .qlp-gap { flex: none; height: 6%; }
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
  /* 2026-10-20 (phone page placeholder): the page skeleton sits where the real
     page lands — fit-width with the viewer's 14px side margins, centred in the
     page area beside the 36px rail — and the caption rides at the page area's
     foot so it never pushes the page off centre. Fixed like the caption, for
     the same reason: one open passes through three boxes. */
  .quiet-loading-stack:has(.quiet-loading-page) {
    position: fixed; padding: 0; gap: 0;
    top: var(--quiet-phone-header-h, calc(34px + env(safe-area-inset-top, 0px)));
    bottom: calc(36px + max(10px, var(--native-safe-area-bottom, env(safe-area-inset-bottom, 0px))));
    left: var(--mobile-rail-w, 36px); right: 0; width: auto; height: auto;
  }
  html[data-native-shell="expo"] .quiet-loading-stack:has(.quiet-loading-page) { top: 34px; }
  .survey-pdfjs-viewer .quiet-loading-stack:has(.quiet-loading-page) { top: 0; bottom: 0; left: 0; }
  .quiet-loading-page { width: calc(100% - 28px); height: auto; max-width: none;
    max-height: calc(100% - 28px); padding: 9% 8%; gap: 2.2%; }
  .quiet-loading-stack:has(.quiet-loading-page) .quiet-loading-text {
    position: absolute; top: auto; bottom: 10px; left: 50%; transform: translateX(-50%); }
}
@media (prefers-reduced-motion: reduce) {
  .quiet-loading-text, .quiet-loading-page { animation-duration: 1ms; }
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
          <div aria-hidden="true" className="quiet-loading-page" style={{ animationDelay: `${delayMs}ms` }}>
            <SkeletonBlock w="46%" h={14} />
            <SkeletonBlock w="30%" h={9} />
            <span className="qlp-gap" />
            <SkeletonBlock w="92%" h={8} />
            <SkeletonBlock w="86%" h={8} />
            <SkeletonBlock w="90%" h={8} />
            <SkeletonBlock w="64%" h={8} />
            <span className="qlp-gap" />
            <SkeletonBlock w="100%" h="28%" />
            <span className="qlp-gap" />
            <SkeletonBlock w="88%" h={8} />
            <SkeletonBlock w="72%" h={8} />
          </div>
          <span className="quiet-loading-text" style={{ animationDelay: `${delayMs}ms` }}>{label || shownLabel}</span>
        </div>
      ) : (
        <span className="quiet-loading-text" style={{ animationDelay: `${delayMs}ms` }}>{label || shownLabel}</span>
      )}
    </div>
  );
}
