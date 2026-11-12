/**
 * snapshotArea.js — the Snapshot tool's box (Nightly 'snapshot-tool', Drawboard
 * PDF Pro push 2026-11-12, drawboard-trial/pdf-pro/apps-side-by-side.md A10).
 *
 * The box lives in page FRACTIONS (0..1 of the page as drawn), so it stays on
 * the same spot through zoom. Pure: no DOM, no React.
 */

/** Smallest box, in screen pixels, that counts as a drag and not a click. */
export const SNAPSHOT_MIN_PX = 6;

/** Longest side of the page picture the copy is cut from (crisp, inside canvas limits). */
export const SNAPSHOT_MAX_RENDER_PX = 4096;

const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** A box from two corner points (fractions), kept on the page. */
export function boxFromCorners(a, b) {
  const x1 = clamp01(a?.x);
  const y1 = clamp01(a?.y);
  const x2 = clamp01(b?.x);
  const y2 = clamp01(b?.y);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** True when the box is big enough on screen to copy (a click makes no box). */
export function isBigEnough(box, pageWidthPx, pageHeightPx, min = SNAPSHOT_MIN_PX) {
  if (!box) return false;
  return box.w * pageWidthPx >= min && box.h * pageHeightPx >= min;
}

/** The 8 handles, named by compass point. */
export const SNAPSHOT_HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

/**
 * The box after a handle (or the whole box, handle 'move') is carried by
 * (dx, dy) fractions from where it was at press. Edges never cross: a handle
 * pulled past the far edge flips the box, the way a drag from a corner does.
 */
export function moveBoxEdge(box, handle, dx, dy) {
  if (!box) return box;
  if (handle === 'move') {
    const x = Math.min(1 - box.w, Math.max(0, box.x + dx));
    const y = Math.min(1 - box.h, Math.max(0, box.y + dy));
    return { ...box, x, y };
  }
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;
  return boxFromCorners({ x: left, y: top }, { x: right, y: bottom });
}

/** The page-picture size to render for a page of `pageWidth` x `pageHeight` points. */
export function renderTargetPx(pageWidth, pageHeight, { pixelRatio = 2, max = SNAPSHOT_MAX_RENDER_PX } = {}) {
  const longest = Math.max(Number(pageWidth) || 0, Number(pageHeight) || 0);
  if (!(longest > 0)) return max;
  return Math.max(600, Math.min(max, Math.round(longest * pixelRatio)));
}

/** The box as whole pixels of a canvas `width` x `height`, at least 1 x 1, inside it. */
export function boxToPixels(box, width, height) {
  const left = Math.max(0, Math.min(width - 1, Math.floor(box.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(box.y * height)));
  const right = Math.max(left + 1, Math.min(width, Math.ceil((box.x + box.w) * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil((box.y + box.h) * height)));
  return { sx: left, sy: top, sw: right - left, sh: bottom - top };
}
