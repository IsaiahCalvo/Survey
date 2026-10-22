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
import { computeLineBboxCenter, getLineEndpoints } from './svgBoundingBox.js';

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

/**
 * A callout in a group resize. Its arrow tip and bend move with the frame;
 * its text box acts like a text mark: from a corner / top / bottom it keeps
 * the frame's proportions and scales its font (the box scales inside its
 * fixed padding), from a side only the width changes and the words rewrap.
 *
 * @param {object} orig  page-unit snapshot: { tip, knee, box: {left, top,
 *   width, height}, fontSize, style }
 * @param {(x:number, y:number) => {x:number, y:number}} scalePoint
 * @param {number} sx
 * @param {number} sy
 * @param {string} handleId
 * @param {{width:number, height:number}} page
 * @param {number} padding  the text box's side padding
 * @returns {object} the callout patch, in page fractions
 */
export function scaleCalloutForGroup(orig, scalePoint, sx, sy, handleId, page, padding) {
  const W = Number(page?.width) || 1;
  const H = Number(page?.height) || 1;
  const tip = scalePoint(orig.tip.x, orig.tip.y);
  const knee = scalePoint(orig.knee.x, orig.knee.y);
  const box = orig.box;
  const centre = scalePoint(box.left + box.width / 2, box.top + box.height / 2);
  const scalesFont = textScalesFontFor(handleId);
  const width = scalesFont ? scaledTextBoxLength(box.width, sx, padding) : box.width * sx;
  const height = box.height * sy;
  const patch = {
    arrowTip: { x: tip.x / W, y: tip.y / H },
    knee: { x: knee.x / W, y: knee.y / H },
    textBoxPosition: { x: (centre.x - width / 2) / W, y: (centre.y - height / 2) / H },
    textBoxWidth: width / W,
    textBoxHeight: height / H,
  };
  if (scalesFont) {
    const fontSize = Math.round(scaledGroupFontSize(orig.fontSize || 12, sx, sy) * 10) / 10;
    patch.style = { ...(orig.style || {}), fontSize };
  }
  return patch;
}

/**
 * A Survey Marker's box in a group resize. Like a rectangle: the box turns
 * about its own centre, so its centre moves with the frame and its sides take
 * the frame's scales (swapped when it is turned 90 / 270).
 */
export function scaleMarkerBoundsForGroup(bounds, scalePoint, sx, sy) {
  const axis = memberAxisScale(bounds.angle || 0, sx, sy);
  const centre = scalePoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const width = bounds.width * axis.x;
  const height = bounds.height * axis.y;
  return { ...bounds, x: centre.x - width / 2, y: centre.y - height / 2, width, height };
}

// A line's ends (and bend) on the page as drawn. Stored ends are offsets
// from the line's box centre, and a turned line spins about its curve box,
// so a group turn or resize must start from these, not the raw x1/y1.
export function lineWorldPoints(obj) {
  const ep = getLineEndpoints(obj);
  const mid = obj?.data?.midpoint ? { x: obj.data.midpoint.x, y: obj.data.midpoint.y } : null;
  const points = { p1: { x: ep.x1, y: ep.y1 }, p2: { x: ep.x2, y: ep.y2 }, mid };
  const angle = Number(obj?.angle) || 0;
  if (!angle) return points;
  const c = computeLineBboxCenter(ep, mid);
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const turn = (p) => p && {
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos,
  };
  return { p1: turn(points.p1), p2: turn(points.p2), mid: turn(mid) };
}

// Page ends back in the drawn-line form buildLineCommitJSON writes: the
// chord's box, ends as offsets from its centre, and no turn of its own.
export function packLineWorldPoints(p1, p2) {
  const left = Math.min(p1.x, p2.x);
  const top = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);
  const cx = left + width / 2;
  const cy = top + height / 2;
  return {
    left, top, width, height, angle: 0,
    x1: p1.x - cx, y1: p1.y - cy, x2: p2.x - cx, y2: p2.y - cy,
  };
}
