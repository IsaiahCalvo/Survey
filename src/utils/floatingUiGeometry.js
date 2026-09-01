export const FLOATING_UI_MARGIN = 8;

// AppShell's desktop #chrome-right-host is a fixed 48px rail.
export const DESKTOP_RIGHT_RAIL_WIDTH = 48;

export function viewportClampDelta(
  rect,
  viewportWidth,
  viewportHeight,
  margin = FLOATING_UI_MARGIN,
) {
  const maxLeft = Math.max(margin, viewportWidth - margin - rect.width);
  const maxTop = Math.max(margin, viewportHeight - margin - rect.height);
  const left = Math.min(Math.max(rect.left, margin), maxLeft);
  const top = Math.min(Math.max(rect.top, margin), maxTop);
  return { x: left - rect.left, y: top - rect.top };
}

export function getPageViewportBounds(
  pageRect,
  viewportWidth,
  viewportHeight,
  rightInset = 0,
) {
  const viewport = {
    left: 0,
    top: 0,
    right: Math.max(0, viewportWidth - rightInset),
    bottom: viewportHeight,
  };

  if (!pageRect) {
    return {
      ...viewport,
      width: viewport.right,
      height: viewport.bottom,
    };
  }

  const left = Math.max(viewport.left, pageRect.left);
  const top = Math.max(viewport.top, pageRect.top);
  const right = Math.min(viewport.right, pageRect.right);
  const bottom = Math.min(viewport.bottom, pageRect.bottom);

  if (right <= left || bottom <= top) {
    return {
      ...viewport,
      width: viewport.right,
      height: viewport.bottom,
    };
  }

  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function clampFloatingMenuPosition({
  x,
  y,
  width,
  height,
  bounds,
  margin = FLOATING_UI_MARGIN,
}) {
  let left = x;
  if (x + width + margin > bounds.right) left = x - width;
  if (left < bounds.left + margin || width + margin * 2 > bounds.width) {
    left = Math.max(margin, bounds.left + margin);
  }

  let top = y;
  if (y + height + margin > bounds.bottom) top = y - height;
  if (top < bounds.top + margin || height + margin * 2 > bounds.height) {
    top = Math.max(margin, bounds.top + margin);
  }

  return { left, top };
}
