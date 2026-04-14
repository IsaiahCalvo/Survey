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
 * Math:
 *   vec        = handleCenter - shapeCenter
 *   unit       = vec / |vec|                           (radial direction)
 *   halfDiag   = √((W/2)² + (H/2)²)                    (pill half-diagonal)
 *   pillCenter = handleCenter + unit * (halfDiag + gap)
 *   pillTopLeft = pillCenter - (W/2, H/2)
 *
 * Using the half-diagonal for the offset (rather than half-width or
 * half-height) ensures the pill's nearest edge sits ~`gapAbove` pixels from
 * the handle regardless of approach angle.
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
 * @param {number} gapAbove - Default 16 (UI-SPEC `md` spacing token; used as radial gap when shapeCenter is provided)
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
    // Radial placement: pill sits along the (shapeCenter → handleCenter) ray,
    // offset OUTWARD from the handle so its NEAREST EDGE is exactly `gapAbove`
    // pixels from the handle center, regardless of approach angle.
    //
    // Math: project the pill's half-extent onto the unit direction vector
    // (this is the support function of an axis-aligned bounding box). The
    // result is the distance from the pill center to the pill edge in the
    // direction the pill is being placed:
    //
    //   projHalfExtent = |ux| * halfW + |uy| * halfH
    //   d              = projHalfExtent + gapAbove
    //   pillCenter     = handleCenter + unit * d
    //
    // At cardinals this gives the user's expected behavior:
    //   0°   (unit (0,-1)):  proj = 14, d = 30, top edge sits 16px above handle
    //   90°  (unit (1, 0)):  proj = 30, d = 46, left edge sits 16px right of handle
    //   180° (unit (0, 1)):  proj = 14, d = 30, bottom edge sits 16px below handle
    //   270° (unit (-1,0)):  proj = 30, d = 46, right edge sits 16px left of handle
    // At off-axis angles (e.g. 45°) the corner of the pill is slightly farther
    // (max ~20px at the diagonals) — that's the support function being correct.
    const vecX = handleCenterX - shapeCenter.x;
    const vecY = handleCenterY - shapeCenter.y;
    const len = Math.hypot(vecX, vecY);

    let pillCenterScreenX;
    let pillCenterScreenY;

    if (len > 0.0001) {
      const unitX = vecX / len;
      const unitY = vecY / len;
      const halfW = inputWidth / 2;
      const halfH = inputHeight / 2;
      // Support function of an axis-aligned box in direction (|unitX|, |unitY|)
      const projHalfExtent = Math.abs(unitX) * halfW + Math.abs(unitY) * halfH;
      const offset = projHalfExtent + gapAbove;
      pillCenterScreenX = handleCenterX + unitX * offset;
      pillCenterScreenY = handleCenterY + unitY * offset;
    } else {
      // Degenerate: handle exactly at shape center (zero-size shape).
      // Fall back to "above the handle" so we never divide by zero.
      pillCenterScreenX = handleCenterX;
      pillCenterScreenY = handleCenterY - (inputHeight / 2 + gapAbove);
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
