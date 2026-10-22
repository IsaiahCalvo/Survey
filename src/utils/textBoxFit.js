// A text box made narrower from its left / right side rewraps its words onto
// more lines. Drawboard then grows the box downward so no line is cut off
// (docs/research/MULTI-SELECT-RESIZE-2026-10-22.md); Survey does the same for
// a single box and for text in a group. The box only grows: a box the user
// made taller than its words keeps its height.
import { TEXT_PADDING } from './textEditCommit.js';

/** Does this grabber only change a text box's width (left / right side)? */
export function isTextSideHandle(handleId) {
  return handleId === 'ml' || handleId === 'mr';
}

/**
 * The box grown to fit its words (or the same box). `naturalInnerHeight` is
 * the measured height of the wrapped words at the box's width; null (no
 * measure, e.g. in Node) leaves the box as it is. A turned box keeps its
 * turned top-left corner in place (same rule as a text edit's commit).
 *
 * @param {object} obj  text mark: left, top, width, height, angle (scale 1)
 * @param {number|null} naturalInnerHeight
 * @returns {{ left:number, top:number, height:number }}
 */
export function growTextBoxToFit(obj, naturalInnerHeight, padding = TEXT_PADDING) {
  const left = Number(obj?.left) || 0;
  const top = Number(obj?.top) || 0;
  const height = Number(obj?.height) || 0;
  const natural = Number(naturalInnerHeight);
  if (!Number.isFinite(natural) || natural <= 0) return { left, top, height };
  const needed = Math.ceil(natural) + 2 * padding;
  if (needed <= height + 0.5) return { left, top, height };
  const dh = needed - height;
  const angle = Number(obj?.angle) || 0;
  if (!angle) return { left, top, height: needed };
  const rad = (angle * Math.PI) / 180;
  return {
    left: left - (dh / 2) * Math.sin(rad),
    top: top - (dh / 2) * (1 - Math.cos(rad)),
    height: needed,
  };
}

// A React style value as a DOM style string: React writes these keys as bare
// numbers (a bold 700 weight must not become "700px"); any other number is px.
const UNITLESS_STYLE_KEYS = new Set(['lineHeight', 'fontWeight', 'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink']);
export function probeStyleValue(key, value) {
  return typeof value === 'number' && !UNITLESS_STYLE_KEYS.has(key) ? `${value}px` : String(value);
}
