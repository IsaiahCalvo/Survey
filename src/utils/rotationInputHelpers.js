/**
 * Pure helper functions for the EDIT-12 RotationInputField component.
 * Kept in a separate file so they can be unit-tested without React/JSDOM.
 *
 * Phase 12 Plan 02.
 */

/**
 * Normalize a typed degree value to an integer in [0, 360).
 * Accepts string or number. Rounds non-integers. Returns null for invalid input.
 *
 * Per CONTEXT.md: "Integer degrees only — display and accept whole numbers 0-359"
 * and "Invalid input (non-numeric, empty) = silently revert on commit/blur".
 *
 * @param {string | number | null | undefined} rawValue
 * @returns {number | null} Integer in [0, 360) or null if invalid
 */
export function normalizeTypedDegrees(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;

  // Reject empty / whitespace-only strings
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (trimmed === '') return null;
  }

  const num = Number(rawValue);
  if (!Number.isFinite(num)) return null;

  // Round to integer (CONTEXT.md: integer degrees only)
  const rounded = Math.round(num);

  // Wrap into [0, 360)
  return ((rounded % 360) + 360) % 360;
}

/**
 * Compute the screen-space (host-relative) CSS position for the rotation
 * input pill, given the rotation handle's bounding rect, the shape's center
 * (in screen space), and the host div's bounding rect.
 *
 * The pill always sits OUTSIDE the rotation handle on the side AWAY from
 * the shape center, along the same radial vector that the mtr handle itself
 * extends from the shape. This means:
 *
 * - Shape at 0° (upright):  handle above center → pill ABOVE handle
 * - Shape at 90°:           handle right of center → pill RIGHT of handle
 * - Shape at 180°:          handle below center → pill BELOW handle
 * - Shape at 270°:          handle left of center → pill LEFT of handle
 *
 * The pill itself is always axis-aligned to the screen (upright, never
 * rotated with the shape). Only the *anchor point* rotates.
 *
 * Issue 3 second pass — edge-to-edge constant gap:
 *
 * The user's exact spec: "the nearest border of the rotation handle needs
 * to maintain the same distance to the nearest border of the pill, all the
 * way around." The previous formula used only the pill's support function
 * (and an even earlier one used halfDiag), measuring from the handle CENTER
 * to the pill EDGE. That made the pill closer than expected at the cardinals
 * because the handle has its own non-zero size that wasn't being subtracted.
 *
 * Correct formula uses BOTH the handle's support function AND the pill's
 * support function along the same direction:
 *
 *   projHandle = |ux| * handleHalfW + |uy| * handleHalfH
 *   projPill   = |ux| * pillHalfW   + |uy| * pillHalfH
 *   d          = projHandle + GAP_EDGE_TO_EDGE + projPill
 *   pillCenter = handleCenter + unit * d
 *
 * For a 16x16 handle and 60x28 pill with GAP=16:
 *   0°    unit (0,-1):  projHandle=8  projPill=14  d=8+16+14=38
 *   90°   unit (1, 0):  projHandle=8  projPill=30  d=8+16+30=54
 *   180°  unit (0, 1):  projHandle=8  projPill=14  d=38
 *   270°  unit (-1,0):  projHandle=8  projPill=30  d=54
 *
 * The actual edge-to-edge distance (verified by minAABBDistance in the
 * unit tests) is exactly GAP_EDGE_TO_EDGE at every cardinal, regardless
 * of handle or pill aspect ratio. At off-axis directions the rectangles'
 * corners face each other so the perpendicular gap is slightly larger —
 * accepted, the minimum is always >= GAP_EDGE_TO_EDGE.
 *
 * After radial placement, the pill is clamped to the host div with a 4px
 * edge margin so it never renders off-screen near page edges.
 *
 * For backward compatibility with the legacy 0°-only call site (and so the
 * original ~20 unit tests written against the pre-radial signature still
 * pass), if `shapeCenter` is null/undefined the function falls back to the
 * original "always above the handle" behavior — handleTopY − gapAbove
 * − inputHeight.
 *
 * @param {DOMRect | { left: number, top: number, width: number, height: number }} handleRect
 * @param {DOMRect | { left: number, top: number, width: number, height: number }} hostRect
 * @param {{ x: number, y: number } | null | undefined} shapeCenter - Shape center in SCREEN coords (same frame as handleRect). Pass null for legacy axial-above behavior.
 * @param {number} inputWidth - Default 60 (UI-SPEC width token)
 * @param {number} inputHeight - Default 28 (UI-SPEC height token)
 * @param {number} gapAbove - Default 16 (UI-SPEC `md` spacing token; used as edge-to-edge gap when shapeCenter is provided)
 * @param {number} edgeMargin - Default 4 (UI-SPEC viewport edge clamp)
 * @returns {{ left: number, top: number }} CSS-ready coordinates relative to host
 */
export function computeInputPosition(
  handleRect,
  hostRect,
  shapeCenter = null,
  inputWidth = 60,
  inputHeight = 28,
  gapAbove = 16,
  edgeMargin = 4
) {
  // Handle center in screen space
  const handleCenterX = handleRect.left + handleRect.width / 2;
  const handleCenterY = handleRect.top + handleRect.height / 2;

  if (shapeCenter && Number.isFinite(shapeCenter.x) && Number.isFinite(shapeCenter.y)) {
    // Radial placement with edge-to-edge constant gap. The pill sits along
    // the (shapeCenter → handleCenter) ray, offset OUTWARD from the handle
    // so the perpendicular distance between the handle's nearest edge and
    // the pill's nearest edge is exactly `gapAbove` at every cardinal angle.
    const vecX = handleCenterX - shapeCenter.x;
    const vecY = handleCenterY - shapeCenter.y;
    const len = Math.hypot(vecX, vecY);

    let pillCenterScreenX;
    let pillCenterScreenY;

    if (len > 0.0001) {
      const unitX = vecX / len;
      const unitY = vecY / len;
      const handleHalfW = handleRect.width / 2;
      const handleHalfH = handleRect.height / 2;
      const pillHalfW = inputWidth / 2;
      const pillHalfH = inputHeight / 2;
      // Support function for each AABB in direction (|unitX|, |unitY|).
      // projHandle = distance from handleCenter to the handle's edge along the ray.
      // projPill   = distance from pillCenter   to the pill's   edge along the ray.
      const projHandle = Math.abs(unitX) * handleHalfW + Math.abs(unitY) * handleHalfH;
      const projPill = Math.abs(unitX) * pillHalfW + Math.abs(unitY) * pillHalfH;
      // Center-to-center distance: handle's outer edge + 16px gap + pill's outer edge.
      const d = projHandle + gapAbove + projPill;
      pillCenterScreenX = handleCenterX + unitX * d;
      pillCenterScreenY = handleCenterY + unitY * d;
    } else {
      // Degenerate: handle exactly at shape center (zero-size shape).
      // Fall back to "above the handle" so we never divide by zero.
      // Use the same edge-to-edge formula at unit = (0, -1):
      //   d = handleHalfH + gapAbove + pillHalfH
      pillCenterScreenX = handleCenterX;
      pillCenterScreenY = handleCenterY - ((handleRect.height / 2) + gapAbove + (inputHeight / 2));
    }

    // Convert pill CENTER (screen) → pill TOP-LEFT (host-relative)
    const computedLeft = (pillCenterScreenX - hostRect.left) - inputWidth / 2;
    const computedTop = (pillCenterScreenY - hostRect.top) - inputHeight / 2;

    // Clamp to host div with edge margin (vertical clamp now applies on
    // BOTH ends since the pill can sit below the handle when shape is at 180°).
    const left = Math.max(
      edgeMargin,
      Math.min(hostRect.width - inputWidth - edgeMargin, computedLeft)
    );
    const top = Math.max(
      edgeMargin,
      Math.min(hostRect.height - inputHeight - edgeMargin, computedTop)
    );

    return { left, top };
  }

  // Legacy 0°-only fallback: pill always above the handle's top edge.
  // Preserves the original test suite written against the pre-radial signature.
  const handleTopY = handleRect.top;
  const computedLeftLegacy = (handleCenterX - hostRect.left) - inputWidth / 2;
  const computedTopLegacy = (handleTopY - hostRect.top) - gapAbove - inputHeight;

  const leftLegacy = Math.max(
    edgeMargin,
    Math.min(hostRect.width - inputWidth - edgeMargin, computedLeftLegacy)
  );
  const topLegacy = Math.max(edgeMargin, computedTopLegacy);

  return { left: leftLegacy, top: topLegacy };
}
