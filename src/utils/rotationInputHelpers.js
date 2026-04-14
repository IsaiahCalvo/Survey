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
 * Issue 3 third pass — CONSTANT radius from shape center:
 *
 * User feedback: "The pill changes width as digit count changes, and an
 * edge-to-edge constant gap makes it LOOK like the pill is drifting farther
 * from the handle when width grows. Instead, keep the pill at a fixed
 * distance from the shape, computed at the worst-case orientation (handle
 * horizontal, pill width facing the shape). That distance, once computed,
 * is held constant around the full orbit."
 *
 * Correct formula uses worst-case AABB projections (the MAX of each rect's
 * width/height halves) so the pill's distance from the handle is a single
 * compile-time constant — and therefore the pill's distance from the shape
 * center (handleRadius + EXTENSION) is constant across all rotations:
 *
 *   EXTENSION  = max(handleW, handleH)/2 + GAP + max(pillW, pillH)/2
 *   pillCenter = handleCenter + unit * EXTENSION
 *              = shapeCenter  + unit * (|handleCenter - shapeCenter| + EXTENSION)
 *
 * For a 16x16 handle and 60x28 pill with GAP=16:
 *   EXTENSION = 8 + 16 + 30 = 54  (constant at every angle)
 *   Edge-to-edge gap at 90°/270° (pill width facing handle) = 16 (spec minimum)
 *   Edge-to-edge gap at 0°/180°  (pill height facing handle) = 32 (larger by design)
 *
 * The edge-to-edge gap now VARIES by angle, but the user explicitly wants
 * visual constancy MEASURED FROM THE SHAPE — not constant edge-to-edge.
 * Since the handle orbits the shape center at a fixed radius (a given shape
 * has a fixed handle offset), constant pillOffset-from-handle ⇒ constant
 * pillRadius-from-shape. That is the user-specified invariant.
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
    // Constant-radius placement: the pill sits along the
    // (shapeCenter → handleCenter) ray at a FIXED offset from the handle
    // center. Offset uses the worst-case AABB projection (the max half of
    // each rect) so that at the orientation where pill width faces the
    // shape, the edge-to-edge gap is exactly `gapAbove` — and at every
    // other orientation the gap is larger (pill never touches the handle).
    // The consequence: pill-center-to-shape-center distance is constant
    // across rotations, which is the user-specified visual invariant.
    const vecX = handleCenterX - shapeCenter.x;
    const vecY = handleCenterY - shapeCenter.y;
    const len = Math.hypot(vecX, vecY);

    // UX: single worst-case extension — independent of rotation angle. Uses
    // the LONGEST half-dimension of each rect so the pill width (pill's
    // long axis) is always fully cleared even when it's the axis facing
    // the shape (90°/270° orientation). At other angles the pill sits
    // farther than strictly needed, but constant distance-from-shape is
    // the user's priority, not constant edge-to-edge.
    const handleHalfMax = Math.max(handleRect.width, handleRect.height) / 2;
    const pillHalfMax = Math.max(inputWidth, inputHeight) / 2;
    const EXTENSION = handleHalfMax + gapAbove + pillHalfMax;

    let pillCenterScreenX;
    let pillCenterScreenY;

    if (len > 0.0001) {
      const unitX = vecX / len;
      const unitY = vecY / len;
      pillCenterScreenX = handleCenterX + unitX * EXTENSION;
      pillCenterScreenY = handleCenterY + unitY * EXTENSION;
    } else {
      // Degenerate: handle exactly at shape center (zero-size shape).
      // Fall back to "above the handle" so we never divide by zero.
      // Use the same constant EXTENSION at unit = (0, -1).
      pillCenterScreenX = handleCenterX;
      pillCenterScreenY = handleCenterY - EXTENSION;
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
