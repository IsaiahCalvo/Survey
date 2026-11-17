// Flip on the mark menu (Nightly flag 'flip-marks', KAL-723, Drawboard's
// More > Flip > Horizontal / Vertical). The picked marks and callouts mirror
// across the middle of their shared box, as one piece, exactly as a group
// resize dragged past its opposite side mirrors them (useSVGInteraction's
// group-resize branch, with a scale of -1 on one axis): points shapes and pen
// ink mirror, a tilted mark turns the other way, a counter's nub mirrors, and
// text, photos and stamps move over but stay the right way round.
//
// Pure. The viewer writes the result as one save (or one transaction across
// pages), so one Undo puts everything back.

import { canMoveAnnotation, getCalloutPageBox } from './annotationFamilyRules.js';
import { getAnnotationBBox, getAnnotationWorldAABB } from './svgBoundingBox.js';
import { applyPageAffineToInkObject } from './inkGeometryTransform.js';
import { buildPointsShapeResize } from './resizeMinimum.js';
import {
  isTextMark,
  lineWorldPoints,
  memberAxisScale,
  mirroredMemberAngle,
  mirroredPointerAngle,
  packLineWorldPoints,
  scaleCalloutForGroup,
} from './groupResize.js';

export const FLIP_AXES = Object.freeze(['horizontal', 'vertical']);

/** Horizontal mirrors left to right (across an up-down line); vertical, top to bottom. */
function mirrorFor(axis, centre) {
  const cx = Number(centre?.x) || 0;
  const cy = Number(centre?.y) || 0;
  if (axis === 'vertical') {
    return { sx: 1, sy: -1, point: (x, y) => ({ x, y: 2 * cy - y }), matrix: [1, 0, 0, -1, 0, 2 * cy] };
  }
  return { sx: -1, sy: 1, point: (x, y) => ({ x: 2 * cx - x, y }), matrix: [-1, 0, 0, 1, 2 * cx, 0] };
}

function markBox(obj) {
  try {
    const box = getAnnotationWorldAABB(obj);
    if (box) return box;
  } catch { /* fall through */ }
  try {
    return getAnnotationBBox(obj) || null;
  } catch {
    return null;
  }
}

/** Can Flip change this mark? Not a callout's page object, a text highlight or a locked mark. */
export function canFlipMark(obj) {
  return Boolean(obj) && obj?.data?.type !== 'callout' && canMoveAnnotation(obj);
}

/** Can Flip change this callout? It needs its tip, bend and box, and no lock. */
export function canFlipCallout(callout) {
  return Boolean(callout?.arrowTip && callout?.knee && callout?.textBoxPosition) && canMoveAnnotation(callout);
}

/**
 * The middle of the box every picked mark and callout shares (page units), or
 * null when there is none. Locked members still count toward the box, as in a
 * group resize: they hold their place and the rest mirror round the same
 * middle.
 */
export function flipCentre({ marks = [], callouts = [], page = {} } = {}) {
  const W = Number(page.width) || 1;
  const H = Number(page.height) || 1;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (box) => {
    if (!box || ![box.left, box.top, box.width, box.height].every(Number.isFinite)) return;
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.left + box.width);
    bottom = Math.max(bottom, box.top + box.height);
  };
  marks.forEach((obj) => add(markBox(obj)));
  callouts.forEach((callout) => add(getCalloutPageBox(callout, W, H)));
  if (!Number.isFinite(left)) return null;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** A copy of the mark mirrored across `centre`, or null when Flip leaves it alone. */
export function flipMark(obj, axis, centre) {
  if (!canFlipMark(obj) || !centre) return null;
  const { sx, sy, point, matrix } = mirrorFor(axis, centre);
  const objType = String(obj.type || '').toLowerCase();

  if (objType === 'path' && Array.isArray(obj.path)) {
    return { ...obj, ...applyPageAffineToInkObject(obj, matrix) };
  }

  if (objType === 'line') {
    const { p1, p2, mid } = lineWorldPoints(obj);
    const next = { ...obj, ...packLineWorldPoints(point(p1.x, p1.y), point(p2.x, p2.y)) };
    if (mid) {
      const mp = point(mid.x, mid.y);
      next.data = { ...(obj.data || {}), midpoint: { x: mp.x, y: mp.y } };
    }
    return next;
  }

  if (obj?.data?.type === 'counter') {
    const r = (Number(obj.radius) || 14) * Math.abs(Number(obj.scaleX) || 1);
    const centreNext = point((Number(obj.left) || 0) + r, (Number(obj.top) || 0) + r);
    return {
      ...obj,
      left: centreNext.x - r,
      top: centreNext.y - r,
      data: {
        ...(obj.data || {}),
        pointerAngle: mirroredPointerAngle(obj?.data?.pointerAngle, sx, sy),
      },
    };
  }

  // Every other mark: its seen middle mirrors, and it is placed from there.
  // The renderers turn a mark about its own middle, so the offset from its
  // corner to its middle is unchanged.
  const box = markBox(obj);
  const left = Number(obj.left) || 0;
  const top = Number(obj.top) || 0;
  const midX = box ? box.left + box.width / 2 : left;
  const midY = box ? box.top + box.height / 2 : top;
  const moved = point(midX, midY);
  const next = {
    ...obj,
    left: moved.x - (midX - left),
    top: moved.y - (midY - top),
  };
  if (obj.angle != null) next.angle = mirroredMemberAngle(obj.angle, sx, sy);
  if ((objType === 'polygon' || objType === 'polyline') && Array.isArray(obj.points)) {
    // Which of its own axes the points flip on: the page's flip seen from the
    // shape's own turn.
    const flipAxis = memberAxisScale(Number(obj.angle) || 0, sx, sy);
    const mirrored = buildPointsShapeResize(
      { ...obj, scaleX: 1, scaleY: 1 },
      { scaleX: flipAxis.x < 0 ? -1 : 1, scaleY: flipAxis.y < 0 ? -1 : 1, left: 0, top: 0 },
      { pointsLocalMinX: 0, pointsPathOffsetX: 0, pointsLocalMinY: 0, pointsPathOffsetY: 0 },
    );
    next.points = mirrored.points;
    next.data = mirrored.data;
  }
  if (isTextMark(obj)) {
    // Words never read backwards: the box moves over at its own size.
    const width = (Number(obj.width) || 0) * Math.abs(Number(obj.scaleX) || 1);
    next.left = moved.x - width / 2;
    if (obj.height) {
      const height = (Number(obj.height) || 0) * Math.abs(Number(obj.scaleY) || 1);
      next.top = moved.y - height / 2;
    }
  }
  return next;
}

/** The callout patch (page fractions) for a flip across `centre`: the arrow mirrors, the box moves over. */
export function flipCallout(callout, axis, centre, page = {}) {
  if (!canFlipCallout(callout) || !centre) return null;
  const W = Number(page.width) || 1;
  const H = Number(page.height) || 1;
  const { sx, sy, point } = mirrorFor(axis, centre);
  const orig = {
    tip: { x: callout.arrowTip.x * W, y: callout.arrowTip.y * H },
    knee: { x: callout.knee.x * W, y: callout.knee.y * H },
    box: {
      left: callout.textBoxPosition.x * W,
      top: callout.textBoxPosition.y * H,
      width: (Number(callout.textBoxWidth) || 0) * W,
      height: (Number(callout.textBoxHeight) || 0) * H,
    },
    fontSize: Number(callout.style?.fontSize) || 12,
    style: callout.style || {},
  };
  // A side grabber's rule: the box keeps its size and font.
  const patch = scaleCalloutForGroup(orig, point, sx, sy, axis === 'vertical' ? 'mt' : 'ml', { width: W, height: H }, 0);
  return {
    arrowTip: patch.arrowTip,
    knee: patch.knee,
    textBoxPosition: patch.textBoxPosition,
  };
}

/**
 * The flipped page: each picked member that may change is mirrored across
 * `centre`. Null when nothing changed.
 */
export function flipMarksOnPage(pageJSON, members, axis, centre, mayChange = () => true) {
  if (!pageJSON || !Array.isArray(pageJSON.objects) || !Array.isArray(members) || !centre) return null;
  let objects = null;
  const indexes = [];
  members.forEach(({ index }) => {
    const current = (objects || pageJSON.objects)[index];
    if (!current || !mayChange(current)) return;
    const next = flipMark(current, axis, centre);
    if (!next) return;
    if (!objects) objects = pageJSON.objects.slice();
    objects[index] = next;
    indexes.push(index);
  });
  return objects ? { page: { ...pageJSON, objects }, indexes } : null;
}

/** The rows under Flip on the mark menu (Drawboard's wording). */
export const FLIP_MENU_ROWS = Object.freeze([
  { axis: 'horizontal', label: 'Horizontal' },
  { axis: 'vertical', label: 'Vertical' },
]);
