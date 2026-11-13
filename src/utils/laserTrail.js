/**
 * laserTrail — the pure part of the Laser pointer (Nightly 'laser-pointer',
 * Drawboard PDF Free-form > Laser pointer; owner 2026-11-13: "nothing can be
 * missing").
 *
 * A laser stroke is never a mark: it is not saved, not sent, and has no Undo.
 * It follows the pen or mouse as a glowing line and fades away after you let
 * go (Drawboard's "After complete" fade). A finger runs it only where a finger
 * runs the other drawing tools (utils/pencilMode.js decides).
 */

/** How long a finished stroke stays fully lit before it starts to fade. */
export const LASER_HOLD_MS = 650;
/** How long the fade itself takes. */
export const LASER_FADE_MS = 450;
/** Drawboard's default laser red. */
export const LASER_COLOR = '#ff2d2d';
/** Screen width of the line (px) and of the lit head (px radius). */
export const LASER_WIDTH = 4;
export const LASER_HEAD_RADIUS = 5;
/** Points closer than this (px) to the last one are skipped. */
export const LASER_MIN_STEP = 1.5;
/** A very long stroke keeps only its newest points. */
export const LASER_MAX_POINTS = 2000;

/** Add a point to a stroke's point list (a new array), skipping tiny steps. */
export function addLaserPoint(points, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return points;
  const last = points[points.length - 1];
  if (last && Math.hypot(last.x - x, last.y - y) < LASER_MIN_STEP) return points;
  const next = points.length >= LASER_MAX_POINTS ? points.slice(points.length - LASER_MAX_POINTS + 1) : points.slice();
  next.push({ x, y });
  return next;
}

/** An SVG path through the points, smoothed with midpoint curves. */
export function laserPath(points) {
  if (!points?.length) return '';
  const r = (n) => Math.round(n * 10) / 10;
  if (points.length === 1) return `M${r(points[0].x)} ${r(points[0].y)}l0.01 0`;
  let d = `M${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += `Q${r(points[i].x)} ${r(points[i].y)} ${r(mx)} ${r(my)}`;
  }
  const end = points[points.length - 1];
  return `${d}L${r(end.x)} ${r(end.y)}`;
}

/**
 * How lit a stroke is at time `now`: 1 while drawing and for LASER_HOLD_MS
 * after release, then down to 0 over LASER_FADE_MS. `endedAt` is null while
 * the stroke is still being drawn.
 */
export function laserOpacity(endedAt, now) {
  if (endedAt == null) return 1;
  const since = now - endedAt;
  if (since <= LASER_HOLD_MS) return 1;
  return Math.max(0, 1 - (since - LASER_HOLD_MS) / LASER_FADE_MS);
}

/** True once a finished stroke has faded out and can be dropped. */
export const laserGone = (endedAt, now) => endedAt != null && laserOpacity(endedAt, now) <= 0;
