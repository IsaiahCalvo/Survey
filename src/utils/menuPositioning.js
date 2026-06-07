/**
 * Calculates a viewport-safe position for a menu/modal to prevent clipping or overflow
 * @param {number} x - Initial x coordinate (clientX)
 * @param {number} y - Initial y coordinate (clientY)
 * @param {Object} options - Configuration options
 * @param {number} options.estimatedWidth - Estimated width of the menu (default: 200)
 * @param {number} options.estimatedHeight - Estimated height of the menu (default: 300)
 * @param {number} options.padding - Minimum padding from viewport edges (default: 10)
 * @param {boolean} options.preferAbove - Prefer positioning above cursor if it would overflow below (default: true)
 * @param {Object} options.constraintRect - Optional bounding rect ({ left, top, right, bottom }) in viewport coordinates
 * @returns {{x: number, y: number}} Adjusted position coordinates
 */
export function calculateViewportSafePosition(x, y, options = {}) {
  const {
    estimatedWidth = 200,
    estimatedHeight = 300,
    padding = 10,
    preferAbove = true,
    constraintRect = null
  } = options;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const resolveBounds = () => {
    if (!constraintRect) {
      return {
        left: padding,
        top: padding,
        right: viewportWidth - padding,
        bottom: viewportHeight - padding
      };
    }

    const parsedLeft = Number.isFinite(constraintRect.left) ? constraintRect.left : padding;
    const parsedTop = Number.isFinite(constraintRect.top) ? constraintRect.top : padding;
    const parsedRight = Number.isFinite(constraintRect.right)
      ? constraintRect.right
      : (Number.isFinite(constraintRect.width) ? parsedLeft + constraintRect.width : viewportWidth - padding);
    const parsedBottom = Number.isFinite(constraintRect.bottom)
      ? constraintRect.bottom
      : (Number.isFinite(constraintRect.height) ? parsedTop + constraintRect.height : viewportHeight - padding);

    const left = Math.max(padding, Math.min(parsedLeft, viewportWidth - padding));
    const top = Math.max(padding, Math.min(parsedTop, viewportHeight - padding));
    const right = Math.max(left, Math.min(parsedRight, viewportWidth - padding));
    const bottom = Math.max(top, Math.min(parsedBottom, viewportHeight - padding));

    return { left, top, right, bottom };
  };

  const bounds = resolveBounds();
  let adjustedX = x;
  let adjustedY = y;

  const minX = bounds.left;
  const maxX = Math.max(minX, bounds.right - estimatedWidth);
  const minY = bounds.top;
  const maxY = Math.max(minY, bounds.bottom - estimatedHeight);

  // Adjust horizontal position to stay inside bounds
  if (adjustedX > maxX) {
    adjustedX = maxX;
  }
  if (adjustedX < minX) {
    adjustedX = minX;
  }

  // Adjust vertical position to stay inside bounds
  const overflowsBottom = adjustedY + estimatedHeight > bounds.bottom;
  if (overflowsBottom && preferAbove) {
    const aboveY = adjustedY - estimatedHeight;
    if (aboveY >= minY) {
      adjustedY = aboveY;
    }
  }

  if (adjustedY > maxY) {
    adjustedY = maxY;
  }
  if (adjustedY < minY) {
    adjustedY = minY;
  }

  return { x: adjustedX, y: adjustedY };
}









