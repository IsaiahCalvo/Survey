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
 * input pill, given the rotation handle's bounding rect and the host
 * div's bounding rect.
 *
 * Per UI-SPEC Positioning Contract:
 * - 16px above the handle's top edge
 * - Horizontally centered on the handle
 * - Clamped to the host div with a 4px edge margin
 * - Always upright (no rotation transform)
 *
 * @param {DOMRect | { left: number, top: number, width: number, height: number }} handleRect
 * @param {DOMRect | { left: number, top: number, width: number, height: number }} hostRect
 * @param {number} inputWidth - Default 60 (UI-SPEC width token)
 * @param {number} inputHeight - Default 28 (UI-SPEC height token)
 * @param {number} gapAbove - Default 16 (UI-SPEC `md` spacing token)
 * @param {number} edgeMargin - Default 4 (UI-SPEC viewport edge clamp)
 * @returns {{ left: number, top: number }} CSS-ready coordinates relative to host
 */
export function computeInputPosition(
  handleRect,
  hostRect,
  inputWidth = 60,
  inputHeight = 28,
  gapAbove = 16,
  edgeMargin = 4
) {
  // Handle center in screen space
  const handleCenterX = handleRect.left + handleRect.width / 2;
  const handleTopY = handleRect.top;

  // Convert to host-relative coordinates
  const computedLeft = (handleCenterX - hostRect.left) - inputWidth / 2;
  const computedTop = (handleTopY - hostRect.top) - gapAbove - inputHeight;

  // Clamp to viewport with edge margin
  const left = Math.max(
    edgeMargin,
    Math.min(hostRect.width - inputWidth - edgeMargin, computedLeft)
  );
  const top = Math.max(edgeMargin, computedTop);

  return { left, top };
}
