// Resize rules for a multi-selection (one frame around several marks).
//
// Drawboard PDF's rules (read from its web app's code, see
// docs/research/MULTI-SELECT-RESIZE-2026-10-22.md): the frame scales about
// the grabber opposite the one dragged, or about its centre with Alt; Shift
// keeps its proportions, following the bigger move. A photo in the
// selection always keeps them, and so does text unless the grabber is the
// left or right side. Text dragged by any other grabber scales its font with
// the frame; from a side its box only gets wider or narrower and the words
// rewrap. Line widths never change.
//
// Drawboard stores a full matrix per mark, so a mark turned by an odd angle
// shears into a slanted shape under an uneven stretch. Survey stores angle +
// scale and can't draw that, so we use tldraw's answer: while one member is
// turned by anything but a right angle the whole frame keeps its
// proportions, as if Shift were held. A member turned by 90 / 270 takes the
// two scales swapped.
import { isRightAngle, keepsProportions, lockAspectToBiggerMove } from './snapGuides.js';
import { MIN_RESIZE_PAGE_UNITS } from './resizeMinimum.js';

const CORNERS = new Set(['tl', 'tr', 'bl', 'br']);
const MIN_GROUP_SCALE = 1e-6;

export const handleAffectsX = (handleId) => handleId !== 'mt' && handleId !== 'mb';
export const handleAffectsY = (handleId) => handleId !== 'ml' && handleId !== 'mr';

export function isTextMark(obj) {
  const type = String(obj?.type || '').toLowerCase();
  return type === 'textbox' || type === 'i-text' || type === 'text';
}

/** True when the mark's local x axis lies along the page's y axis. */
export function isSideways(angle) {
  const a = ((Number(angle) || 0) % 180 + 180) % 180;
  return Math.abs(a - 90) < 0.01;
}

/** Does a text member scale its font for this grabber (not a side one)? */
export function textScalesFontFor(handleId) {
  return handleId !== 'ml' && handleId !== 'mr';
}

/**
 * Can this mark take a group resize? An old-style arrow (type 'group': a
 * line child plus a head) draws from its children's endpoints, which the
 * group resize doesn't rewrite, so a selection holding one only moves.
 */
export function canGroupResizeMember(obj) {
  if (!obj) return true;
  return String(obj.type || '').toLowerCase() !== 'group';
}

/**
 * Must the whole selection keep its proportions because of this mark?
 * A tilted mark (not a right angle), a photo / stamp, or text (unless the
 * grabber is a left / right side).
 */
export function markNeedsUniformGroupScale(obj, handleId) {
  if (!obj) return false;
  if (!isRightAngle(obj.angle || 0)) return true;
  // A line / arrow keeps its endpoints unturned and spins them about its
  // own pivot, so only 0 / 180 read the frame's axes straight.
  const type = String(obj.type || '').toLowerCase();
  if ((type === 'line' || type === 'group') && isSideways(obj.angle)) return true;
  if (keepsProportions(obj)) return true;
  if (isTextMark(obj) && textScalesFontFor(handleId)) return true;
  return false;
}

/**
 * A text member's new font size: scaled by the smaller of its two axis
 * scales (equal whenever text forced the proportions), never under 1.
 */
export function scaledGroupFontSize(fontSize, axisScaleX, axisScaleY) {
  const size = Number(fontSize) || 16;
  const k = Math.min(Math.abs(axisScaleX), Math.abs(axisScaleY));
  if (!Number.isFinite(k) || k <= 0) return size;
  return Math.max(1, size * k);
}

/**
 * The frame's scale for a drag.
 *
 * @param {object} p
 * @param {string} p.handleId  tl tr bl br mt mb ml mr
 * @param {number} p.sx        raw x scale the pointer asks for (signed)
 * @param {number} p.sy        raw y scale the pointer asks for (signed)
 * @param {boolean} [p.keepProportions]  Shift, or a member that needs it
 * @param {number} [p.minScaleX]  smallest |sx| allowed
 * @param {number} [p.minScaleY]  smallest |sy| allowed
 * @returns {{ sx: number, sy: number }} positive scales (a group never flips)
 */
export function resolveGroupResizeScale({
  handleId,
  sx,
  sy,
  keepProportions = false,
  minScaleX = 0,
  minScaleY = 0,
}) {
  const affectsX = handleAffectsX(handleId);
  const affectsY = handleAffectsY(handleId);
  let x = affectsX && Number.isFinite(sx) ? sx : 1;
  let y = affectsY && Number.isFinite(sy) ? sy : 1;
  // A group never mirrors: past the fixed side it stops at its minimum.
  x = Math.max(x, 0);
  y = Math.max(y, 0);
  if (keepProportions) {
    if (CORNERS.has(handleId)) {
      const locked = lockAspectToBiggerMove(x, y, 1, 1);
      x = Math.abs(locked.scaleX);
      y = Math.abs(locked.scaleY);
    } else if (affectsX) {
      y = x;
    } else {
      x = y;
    }
  }
  // The floor applies to both axes together when proportions are kept, so
  // the frame never stops shrinking on one axis while the other carries on.
  // It is never zero: a zero scale would make the group's page matrix
  // singular (ink resizes through it).
  minScaleX = Math.max(minScaleX, MIN_GROUP_SCALE);
  minScaleY = Math.max(minScaleY, MIN_GROUP_SCALE);
  if (keepProportions) {
    const floor = Math.max(minScaleX, minScaleY);
    const k = Math.max(x, floor);
    return { sx: k, sy: k };
  }
  return {
    sx: affectsX ? Math.max(x, minScaleX) : 1,
    sy: affectsY ? Math.max(y, minScaleY) : 1,
  };
}

/**
 * Smallest frame scale on each axis that keeps every member at least
 * MIN_RESIZE_PAGE_UNITS wide / tall (or its own size, if already thinner).
 *
 * @param {Array<{width:number,height:number}>} boxes  members' page boxes
 */
export function groupResizeMinimumScale(boxes, minSize = MIN_RESIZE_PAGE_UNITS) {
  let minScaleX = 0;
  let minScaleY = 0;
  for (const box of boxes || []) {
    const w = Math.abs(Number(box?.width) || 0);
    const h = Math.abs(Number(box?.height) || 0);
    if (w > 0) minScaleX = Math.max(minScaleX, Math.min(minSize, w) / w);
    if (h > 0) minScaleY = Math.max(minScaleY, Math.min(minSize, h) / h);
  }
  return { minScaleX, minScaleY };
}

/** The frame's scale seen in a member's own (unrotated) axes. */
export function memberAxisScale(angle, sx, sy) {
  return isSideways(angle) ? { x: sy, y: sx } : { x: sx, y: sy };
}

/**
 * A text box side scaled with its font. The renderer insets the words by a
 * fixed padding, so only the inner length scales — scaling the whole side
 * would leave the words a few units short and wrap the last one away.
 */
export function scaledTextBoxLength(length, k, padding) {
  const size = Math.abs(Number(length) || 0);
  const pad = Math.max(0, Number(padding) || 0);
  return Math.max(2 * pad, (size - 2 * pad) * k + 2 * pad);
}
