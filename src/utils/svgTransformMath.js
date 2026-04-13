/**
 * SVG Transform Math Utilities
 *
 * Coordinate conversion, angle normalization, page constraint,
 * inverse-scale computation, and cursor mapping for SVG annotation interaction.
 *
 * Phase 9 Plan 01: Selection foundation utilities.
 */

/**
 * Convert DOM client coordinates to SVG viewBox coordinates.
 * Uses the browser's native CTM (current transform matrix) inversion
 * so the result is always accurate regardless of zoom, scroll, or CSS transforms.
 *
 * @param {SVGSVGElement} svgElement - The root <svg> element
 * @param {number} clientX - DOM clientX from a pointer event
 * @param {number} clientY - DOM clientY from a pointer event
 * @returns {{ x: number, y: number }} Coordinates in viewBox space
 */
export function screenToSVG(svgElement, clientX, clientY) {
  const ctm = svgElement.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const point = new DOMPoint(clientX, clientY);
  const svgPoint = point.matrixTransform(ctm.inverse());
  return { x: svgPoint.x, y: svgPoint.y };
}

/**
 * Convert atan2 radians to Fabric.js-style degrees (0-360).
 * atan2 uses 3 o'clock as 0; Fabric.js uses 12 o'clock as 0.
 * The +90 shifts the origin from east to north.
 *
 * @param {number} radians - Angle in radians from Math.atan2
 * @returns {number} Angle in degrees (0-360), Fabric.js convention
 */
export function normalizeAngle(radians) {
  return ((radians * 180 / Math.PI) + 90 + 360) % 360;
}

/**
 * Clamp annotation position so it stays within page bounds.
 *
 * @param {number} left - Current left position
 * @param {number} top - Current top position
 * @param {number} width - Annotation width
 * @param {number} height - Annotation height
 * @param {number} pageWidth - Page width (viewBox units)
 * @param {number} pageHeight - Page height (viewBox units)
 * @returns {{ left: number, top: number }} Clamped position
 */
export function constrainToPage(left, top, width, height, pageWidth, pageHeight) {
  return {
    left: Math.max(0, Math.min(left, pageWidth - width)),
    top: Math.max(0, Math.min(top, pageHeight - height)),
  };
}

/**
 * Compute the inverse scale factor needed to keep SVG handles at a
 * constant visual pixel size regardless of zoom level.
 *
 * inverseScale = 1 / (svgElement.clientWidth / viewBoxWidth)
 *
 * At 200% zoom the SVG element is twice as wide as the viewBox,
 * so inverseScale = 0.5 and handle coordinates are halved,
 * keeping them the same on-screen size.
 *
 * @param {SVGSVGElement} svgElement - The root <svg> element
 * @param {number} viewBoxWidth - The viewBox width (unscaled page width)
 * @returns {number} Inverse scale factor (always > 0)
 */
export function getInverseScale(svgElement, viewBoxWidth) {
  const clientWidth = svgElement.clientWidth;
  if (!clientWidth) return 1;
  return 1 / (clientWidth / viewBoxWidth);
}

/**
 * Return the CSS cursor string for a resize handle, accounting for
 * annotation rotation. Handles cycle through 8 directional cursors.
 *
 * @param {string} handleId - Handle identifier: tl, mt, tr, mr, br, mb, bl, ml, mtr
 * @param {number} angleDegrees - Annotation rotation in degrees (Fabric.js convention)
 * @returns {string} CSS cursor value
 */
export function getCursorForHandle(handleId, angleDegrees) {
  if (handleId === 'mtr') return 'crosshair';

  const cursors = [
    'nwse-resize', // 0 - tl / br
    'ns-resize',   // 1 - mt / mb
    'nesw-resize',  // 2 - tr / bl
    'ew-resize',   // 3 - mr / ml
    'nwse-resize', // 4 - br / tl (repeats)
    'ns-resize',   // 5 - mb / mt (repeats)
    'nesw-resize',  // 6 - bl / tr (repeats)
    'ew-resize',   // 7 - ml / mr (repeats)
  ];

  const baseIndices = {
    tl: 0, mt: 1, tr: 2, mr: 3,
    br: 4, mb: 5, bl: 6, ml: 7,
  };

  const baseIndex = baseIndices[handleId];
  if (baseIndex === undefined) return 'default';

  const rotationOffset = Math.round(((angleDegrees % 360 + 360) % 360) / 45) % 8;
  return cursors[(baseIndex + rotationOffset) % 8];
}

/**
 * Snap a degree value to the nearest 45° increment IF within `threshold` degrees of it.
 * Soft snap — outside the threshold, returns the input unchanged.
 * The `% 360` defensive wrap prevents `Math.round(358/45)*45 = 360` from persisting.
 *
 * @param {number} angle - Angle in degrees, expected in [0, 360)
 * @param {number} threshold - Snap engages only when |angle - nearest45| <= threshold (default 3)
 * @returns {number} Snapped angle in [0, 360), or input unchanged if outside threshold
 */
export function snapAngleToNearest45(angle, threshold = 3) {
  const nearest45 = Math.round(angle / 45) * 45;
  if (Math.abs(angle - nearest45) <= threshold) {
    return nearest45 % 360;
  }
  return angle;
}
