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

/**
 * Polish round 6: the phone's long-press mark menu must stay in the band
 * between the header and the dock. On a 375x667 phone its ten rows ran 25px
 * over the dock. Given the top the usual placement chose, push it inside
 * `band` ({ top, bottom }); a menu taller than the band gets `maxHeight`
 * (it then scrolls inside). maxHeight is null when the whole menu fits.
 */
export function fitMenuInBand({ top, height, band, margin = FLOATING_UI_MARGIN }) {
  const room = Math.max(0, band.bottom - band.top - margin * 2);
  const h = Math.min(height, room);
  const maxHeight = height > room ? room : null;
  const minTop = band.top + margin;
  const maxTop = band.bottom - margin - h;
  return { top: Math.max(minTop, Math.min(top, maxTop)), maxHeight };
}

const overlapArea = (a, b) => (
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
);

/**
 * Place a menu that belongs to something on screen (owner 2026-10-01, the
 * Pages panel page menu): fully inside `bounds` (already the usable area —
 * under the top bar, above the dock), never wider/taller than that area (a
 * menu taller than it gets `maxHeight` and scrolls), and covering as little
 * of `avoid` (the page thumbnail it acts on) as the space allows.
 *
 * With `avoid`, the menu is tried beside it (right, left — the roomier side
 * first) with its bottom level with the anchor's bottom so it grows up from
 * the button, then above / below it right-aligned to the anchor; every try is
 * pushed inside the bounds and the one that covers least of `avoid` wins
 * (ties keep that order). Without `avoid`, `anchor` is a point (a right-click)
 * and the menu opens down-right of it, flipping left / up where it would not
 * fit, like any context menu.
 *
 * Returns { left, top, maxHeight } in viewport px; maxHeight is null when the
 * whole menu fits.
 */
export function placeAnchoredMenu({
  anchor,
  avoid = null,
  width,
  height,
  bounds,
  margin = FLOATING_UI_MARGIN,
  gap = 6,
}) {
  const box = {
    left: bounds.left + margin,
    top: bounds.top + margin,
    right: bounds.right - margin,
    bottom: bounds.bottom - margin,
  };
  const room = Math.max(0, box.bottom - box.top);
  const h = Math.min(height, room);
  const maxHeight = height > room ? room : null;
  const clampX = (left) => Math.max(box.left, Math.min(left, box.right - width));
  const clampY = (top) => Math.max(box.top, Math.min(top, box.bottom - h));

  if (!avoid) {
    const x = anchor.left;
    const y = anchor.top;
    const left = x + width > box.right && x - width >= box.left ? x - width : x;
    const top = y + h > box.bottom && y - h >= box.top ? y - h : y;
    return { left: clampX(left), top: clampY(top), maxHeight };
  }

  const sideTop = clampY(anchor.bottom - h);
  const besideRight = { left: clampX(avoid.right + gap), top: sideTop };
  const besideLeft = { left: clampX(avoid.left - gap - width), top: sideTop };
  const sides = (box.right - avoid.right) >= (avoid.left - box.left)
    ? [besideRight, besideLeft]
    : [besideLeft, besideRight];
  const alignedLeft = clampX(anchor.right - width);
  const above = { left: alignedLeft, top: clampY(avoid.top - gap - h) };
  const below = { left: alignedLeft, top: clampY(avoid.bottom + gap) };
  const candidates = (avoid.top - box.top) >= (box.bottom - avoid.bottom)
    ? [...sides, above, below]
    : [...sides, below, above];

  let best = null;
  for (const c of candidates) {
    const covered = overlapArea(
      { left: c.left, top: c.top, right: c.left + width, bottom: c.top + h },
      avoid,
    );
    if (!best || covered < best.covered - 0.5) best = { ...c, covered };
  }
  return { left: best.left, top: best.top, maxHeight };
}
