/**
 * Calculates a viewport-safe position for a menu/modal to prevent clipping or overflow
 * @param {number} x - Initial x coordinate (clientX)
 * @param {number} y - Initial y coordinate (clientY)
 * @param {Object} options - Configuration options
 * @param {number} options.estimatedWidth - Estimated width of the menu (default: 200)
 * @param {number} options.estimatedHeight - Estimated height of the menu (default: 300)
 * @param {number} options.padding - Minimum padding from viewport edges (default: 10)
 * @param {boolean} options.preferAbove - Prefer positioning above cursor if it would overflow below (default: true)
 * @returns {{x: number, y: number}} Adjusted position coordinates
 */
export function calculateViewportSafePosition(x, y, options = {}) {
  const {
    estimatedWidth = 200,
    estimatedHeight = 300,
    padding = 10,
    preferAbove = true
  } = options;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let adjustedX = x;
  let adjustedY = y;

  // Adjust horizontal position to prevent overflow on right edge
  if (adjustedX + estimatedWidth + padding > viewportWidth) {
    adjustedX = viewportWidth - estimatedWidth - padding;
  }

  // Adjust horizontal position to prevent overflow on left edge
  if (adjustedX < padding) {
    adjustedX = padding;
  }

  // Adjust vertical position to prevent overflow on bottom edge
  if (adjustedY + estimatedHeight + padding > viewportHeight) {
    // If preferAbove is true and there's space above, position above cursor instead
    if (preferAbove && adjustedY - estimatedHeight - padding >= padding) {
      adjustedY = adjustedY - estimatedHeight;
    } else {
      // Otherwise, just move up to fit
      adjustedY = viewportHeight - estimatedHeight - padding;
    }
  }

  // Adjust vertical position to prevent overflow on top edge
  if (adjustedY < padding) {
    adjustedY = padding;
  }

  return { x: adjustedX, y: adjustedY };
}

/**
 * Calculates viewport-safe position using actual element dimensions (use after render)
 * @param {HTMLElement} element - The menu/modal element
 * @param {number} initialX - Initial x coordinate (clientX)
 * @param {number} initialY - Initial y coordinate (clientY)
 * @param {number} padding - Minimum padding from viewport edges (default: 10)
 * @param {boolean} preferAbove - Prefer positioning above cursor if it would overflow below (default: true)
 * @returns {{x: number, y: number}} Adjusted position coordinates
 */
export function calculateViewportSafePositionFromElement(element, initialX, initialY, padding = 10, preferAbove = true) {
  if (!element) {
    return { x: initialX, y: initialY };
  }

  const rect = element.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  return calculateViewportSafePosition(initialX, initialY, {
    estimatedWidth: width,
    estimatedHeight: height,
    padding,
    preferAbove
  });
}









