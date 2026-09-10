/**
 * offsetPreservingResize.js — grab-time offset capture for handles that are
 * DRAWN somewhere other than the box the resize math writes to.
 *
 * UX 2026-09-09 (Drawboard PDF parity). A revision cloud draws its eight
 * grabbers on the padded crown hull (cloudSelectionChrome), which sits several
 * page units outside the inner box the cloud was built from. The bbox resize
 * math in useSVGInteraction writes that INNER edge to the absolute pointer
 * position, so grabbing a cloud grabber snapped the cloud outward by the
 * hull overhang before it started tracking the cursor (measured live: a rect
 * cloud's inner width jumped 120.15 -> 147.18 on a +12.5 pointer move, while
 * a plain rect tracked 1:1).
 *
 * The fix is a delta resize: at pointerdown capture the offset between the
 * pointer and where the resize math expects the dragged edge to be, then
 * subtract that constant on every move. The edge keeps its grab-time offset
 * from the pointer, so a +25 pointer move grows the box by exactly +25 on
 * that axis — for all eight grabbers, at any rotation and any scale — and the
 * shape can never skew or jump on grab.
 *
 * Pure math, no DOM: the same numbers the hook feeds its own resize formula.
 */

/** Handles whose drag grows the shape when the pointer moves LEFT. */
export const RESIZE_LEFT_HANDLES = ['tl', 'ml', 'bl'];
/** Handles whose drag grows the shape when the pointer moves UP. */
export const RESIZE_TOP_HANDLES = ['tl', 'mt', 'tr'];
/** Handles that do not move the horizontal edges. */
export const RESIZE_VERTICAL_ONLY_HANDLES = ['mt', 'mb'];
/** Handles that do not move the vertical edges. */
export const RESIZE_HORIZONTAL_ONLY_HANDLES = ['ml', 'mr'];

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

/**
 * The rendered (world) position of a resize anchor: the stored anchor lives in
 * the shape's un-rotated frame, so rotate it about the shape's center. Mirrors
 * the identical block in useSVGInteraction's resize pointermove.
 */
export function worldResizeAnchor({ anchorX, anchorY, centerX, centerY, angleDeg = 0 }) {
  const radians = (finite(angleDeg) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = finite(anchorX) - finite(centerX);
  const dy = finite(anchorY) - finite(centerY);
  return {
    x: finite(centerX) + dx * cos - dy * sin,
    y: finite(centerY) + dx * sin + dy * cos,
  };
}

/**
 * The pointer's offset from the world anchor, expressed in the shape's own
 * un-rotated frame and already signed by the handle's growth direction — i.e.
 * exactly the `signedLocalDx` / `signedLocalDy` the resize formula divides by
 * the raw dimensions.
 */
export function signedLocalGrabDelta({
  handleId,
  pointerX,
  pointerY,
  anchorX,
  anchorY,
  centerX,
  centerY,
  angleDeg = 0,
}) {
  const radians = (finite(angleDeg) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const anchor = worldResizeAnchor({ anchorX, anchorY, centerX, centerY, angleDeg });
  const dxWorld = finite(pointerX) - anchor.x;
  const dyWorld = finite(pointerY) - anchor.y;
  const dxLocal = dxWorld * cos + dyWorld * sin;
  const dyLocal = -dxWorld * sin + dyWorld * cos;
  return {
    dx: RESIZE_LEFT_HANDLES.includes(handleId) ? -dxLocal : dxLocal,
    dy: RESIZE_TOP_HANDLES.includes(handleId) ? -dyLocal : dyLocal,
  };
}

/**
 * How far the pointer sits from the edge the resize math is about to write.
 * Zero for a handle drawn on the box itself; the hull overhang for a cloud
 * grabber drawn on the padded crown frame.
 *
 * Subtract `{dx, dy}` from the signed local delta on every pointermove and the
 * resize becomes offset-preserving. Axes the handle does not drive report 0,
 * so an edge grabber can never introduce motion on the other axis (no skew).
 *
 * @returns {{dx:number, dy:number}} offset in the signed local frame
 */
export function resizeGrabOffset({
  handleId,
  pointerX,
  pointerY,
  anchorX,
  anchorY,
  centerX,
  centerY,
  angleDeg = 0,
  width = 0,
  height = 0,
  scaleX = 1,
  scaleY = 1,
}) {
  const affectsX = !RESIZE_VERTICAL_ONLY_HANDLES.includes(handleId);
  const affectsY = !RESIZE_HORIZONTAL_ONLY_HANDLES.includes(handleId);
  const rawWidth = finite(width);
  const rawHeight = finite(height);
  const grab = signedLocalGrabDelta({
    handleId, pointerX, pointerY, anchorX, anchorY, centerX, centerY, angleDeg,
  });
  // The delta the math would see if the pointer sat exactly on the dragged
  // edge: |scale| * raw dimension. Magnitude (not signed scale) so a shape
  // that is already flipped behaves on grab exactly as it did before.
  const expectedDx = Math.abs(finite(scaleX, 1)) * rawWidth;
  const expectedDy = Math.abs(finite(scaleY, 1)) * rawHeight;
  return {
    dx: affectsX && rawWidth !== 0 ? grab.dx - expectedDx : 0,
    dy: affectsY && rawHeight !== 0 ? grab.dy - expectedDy : 0,
  };
}

/**
 * Rotation's equivalent: the angular offset between the pointer at grab time
 * and the shape's committed angle. A cloud's rotation handle hangs off the top
 * of the padded hull frame, whose horizontal midpoint need not be the shape's
 * rotation pivot, so without this the cloud snapped to the pointer's absolute
 * bearing on grab. Subtract the returned degrees from every live angle.
 *
 * @returns {number} degrees, normalized to (-180, 180]
 */
export function rotationGrabOffsetDeg({ pointerAngleDeg, originalAngleDeg = 0 }) {
  const delta = finite(pointerAngleDeg) - finite(originalAngleDeg);
  return ((delta % 360) + 540) % 360 - 180;
}
