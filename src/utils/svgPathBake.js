/**
 * svgPathBake.js — draw a moved-only path mark without its own SVG transform.
 *
 * Owner 2026-10-06 (smooth zoom on heavily marked drawings). Every path mark
 * was drawn as <path d="(local)" transform="matrix(1 0 0 1 tx ty)">. In
 * Chromium each element with its own transform starts a new paint chunk, and
 * every frame that repaints anything re-sorts ALL chunks of the page
 * ("Layerize"): ~6,000 transformed paths on a zoomed-out set of drawings made
 * each frame of a pinch or glide cost ~80 ms on a 4x-slowed phone. The same
 * marks with the move written into the path data cost ~0 (measured: 83 ms vs
 * 17 ms per frame, same element count). Only a PURE move (no scale, turn or
 * skew) is written in — the stroke, dashes and hit band then come out exactly
 * the same, and getBBox / getScreenCTM / isPointInStroke still agree with
 * each other because the move simply sits in a different place. Anything
 * else keeps its transform as before.
 */

// [a, b, c, d, e, f] -> { tx, ty } when it is a pure translation, else null.
export function pureTranslationOf(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 6) return null;
  const [a, b, c, d, e, f] = matrix.map(Number);
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  if (a !== 1 || b !== 0 || c !== 0 || d !== 1) return null;
  return { tx: e, ty: f };
}

// Parameters per group for each SVG path command, and which of them are x
// or y coordinates (absolute commands only; relative ones move with the pen).
const COMMAND_SHAPE = {
  M: { size: 2, xs: [0], ys: [1] },
  L: { size: 2, xs: [0], ys: [1] },
  T: { size: 2, xs: [0], ys: [1] },
  H: { size: 1, xs: [0], ys: [] },
  V: { size: 1, xs: [], ys: [0] },
  C: { size: 6, xs: [0, 2, 4], ys: [1, 3, 5] },
  S: { size: 4, xs: [0, 2], ys: [1, 3] },
  Q: { size: 4, xs: [0, 2], ys: [1, 3] },
  A: { size: 7, xs: [5], ys: [6] },
  Z: { size: 0, xs: [], ys: [] },
};

/**
 * Fabric path segments ([['M', x, y], ['C', ...], ...]) moved by (tx, ty), as
 * the same `d` string svgPathAttrs.renderPathToSvgD would build (segments
 * joined by spaces). Returns null for anything it does not fully understand,
 * so the caller keeps the transform.
 */
export function translatePathSegmentsToD(path, tx, ty) {
  if (!Array.isArray(path) || path.length === 0) return null;
  const dx = Number(tx);
  const dy = Number(ty);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const parts = new Array(path.length);
  for (let s = 0; s < path.length; s += 1) {
    const seg = path[s];
    if (!Array.isArray(seg) || typeof seg[0] !== 'string' || seg[0].length !== 1) return null;
    const cmd = seg[0];
    const upper = cmd.toUpperCase();
    const shape = COMMAND_SHAPE[upper];
    if (!shape) return null;
    const args = seg.slice(1);
    if (args.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
    if (shape.size === 0) {
      if (args.length) return null;
      parts[s] = cmd;
      continue;
    }
    if (args.length === 0 || args.length % shape.size !== 0) return null;
    const absolute = cmd === upper;
    // A path's first moveto is absolute even when written lowercase - only
    // its first pair; the pairs after it are relative line-tos.
    const firstRelativeMove = !absolute && s === 0 && upper === 'M';
    if (absolute || firstRelativeMove) {
      const groups = firstRelativeMove ? 1 : args.length / shape.size;
      for (let g = 0; g < groups; g += 1) {
        const base = g * shape.size;
        for (const i of shape.xs) args[base + i] += dx;
        for (const i of shape.ys) args[base + i] += dy;
      }
    }
    parts[s] = [cmd, ...args].join(' ');
  }
  return parts.join(' ');
}
