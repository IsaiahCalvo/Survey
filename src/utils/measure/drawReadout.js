// The live readout while a Length is drawn (Nightly flag 'measure-draw-readout',
// Drawboard's "4in · 0°" chip): the length so far and the line's angle, in a
// small pill just past the pointer. Pure.

import { formatMeasureLength } from './measureScale.js';

/**
 * The line's angle in whole degrees: 0 points right, 90 straight up (the page's
 * y runs down, so it is flipped), always 0 to 359.
 */
export function drawAngleDegrees(start, end) {
  const dx = Number(end?.x) - Number(start?.x);
  const dy = Number(end?.y) - Number(start?.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return 0;
  const deg = Math.round((Math.atan2(-dy, dx) * 180) / Math.PI);
  return ((deg % 360) + 360) % 360;
}

/**
 * The pill for a line being drawn from `start` to `end` (page units), or null
 * before it has any length: { text, x, y } with x / y its middle, set 14 screen
 * px right of and below the pointer (`unitsPerPx` page units per screen px),
 * and pulled back inside the page when it would run off the right or bottom.
 */
export function drawReadout(start, end, scale, unitsPerPx = 1, page = null) {
  const dx = Number(end?.x) - Number(start?.x);
  const dy = Number(end?.y) - Number(start?.y);
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0) return null;
  const text = `${formatMeasureLength(length, scale).replace(/ \(no scale\)$/, '')} · ${drawAngleDegrees(start, end)}°`;
  const u = Number(unitsPerPx) > 0 ? Number(unitsPerPx) : 1;
  // About 7 px a letter at the pill's 12 px text, plus its padding.
  const halfWidth = (text.length * 7 + 16) * u / 2;
  const halfHeight = 11 * u;
  let x = Number(end.x) + 14 * u + halfWidth;
  let y = Number(end.y) + 14 * u + halfHeight;
  const W = Number(page?.width);
  const H = Number(page?.height);
  if (Number.isFinite(W) && x + halfWidth > W) x = Number(end.x) - 14 * u - halfWidth;
  if (Number.isFinite(H) && y + halfHeight > H) y = Number(end.y) - 14 * u - halfHeight;
  return { text, x, y };
}
