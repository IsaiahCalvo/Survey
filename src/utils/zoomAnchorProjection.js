/**
 * Per-page transform-origin projection for cursor-centered zoom.
 *
 * Projects a global zoom anchor (cursor position in document coordinates)
 * into page-local coordinates for use as CSS `transformOrigin`. This ensures
 * annotations scale from the correct anchor point during zoom rather than
 * from the top-left corner of each page's overlay.
 */

/**
 * Compute the local anchor point within a specific page's coordinate system
 * by projecting a global zoom anchor (cursor + scroll in document coordinates).
 *
 * The returned coordinates can be outside page bounds (negative or > page
 * dimensions) for pages far from the cursor. This is mathematically correct --
 * CSS transform-origin works with any coordinate, even outside the element.
 *
 * @param {number} pageNumber - The 1-based page number to compute the anchor for.
 * @param {Object} pageContainers - Map of page number to page host DOM elements.
 * @param {HTMLElement} containerElement - The viewer container DOM element.
 * @param {{ x: number, y: number } | null} globalAnchor - The global zoom anchor
 *   in document coordinates (cursor position + scroll offset).
 * @returns {{ x: number, y: number } | null} Page-local anchor coordinates, or
 *   null if the anchor cannot be computed (caller should fall back to 'top left').
 */
export const computePageLocalAnchor = (pageNumber, pageContainers, containerElement, globalAnchor) => {
  if (!globalAnchor || !containerElement) {
    return null;
  }

  const pageHost = pageContainers[pageNumber];
  if (!pageHost || !pageHost.isConnected) {
    return null;
  }

  const containerRect = containerElement.getBoundingClientRect();
  const pageRect = pageHost.getBoundingClientRect();

  // Page position in document coordinates
  const pageDocX = pageRect.left - containerRect.left + containerElement.scrollLeft;
  const pageDocY = pageRect.top - containerRect.top + containerElement.scrollTop;

  // Project global anchor to page-local coordinates
  const localX = globalAnchor.x - pageDocX;
  const localY = globalAnchor.y - pageDocY;

  return { x: localX, y: localY };
};
