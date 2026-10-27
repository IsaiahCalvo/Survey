// Owner 2026-10-27: the Select tool's drag box over Spaces areas, with the
// same rule as the box over marks (utils/marqueeSelection.js): dragged
// left-to-right it picks the areas wholly inside the box ('window'); dragged
// right-to-left it picks every area the box touches ('crossing').
//
// Areas are flat [x0, y0, x1, y1, ...] outlines in page units (a smoothed
// Lasso area passes its drawn curve, see withRegionOutlineCoordinates).

export const REGION_MARQUEE_MIN_DRAG_PX = 5;

export const regionMarqueeDirection = (startX, endX) => (endX >= startX ? 'window' : 'crossing');

export const regionMarqueeRect = (start, end) => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  right: Math.max(start.x, end.x),
  bottom: Math.max(start.y, end.y),
});

const pointInRect = (x, y, r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

const pointInPolygon = (x, y, coords) => {
  let inside = false;
  const n = coords.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = coords[i * 2];
    const yi = coords[i * 2 + 1];
    const xj = coords[j * 2];
    const yj = coords[j * 2 + 1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
};

const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

const segmentsCross = (a, b, c, d) => {
  const d1 = cross(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = cross(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = cross(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = cross(a.x, a.y, b.x, b.y, d.x, d.y);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
};

export const isOutlineInsideRect = (coords, rect) => {
  if (!Array.isArray(coords) || coords.length < 6) return false;
  for (let i = 0; i < coords.length; i += 2) {
    if (!pointInRect(coords[i], coords[i + 1], rect)) return false;
  }
  return true;
};

export const doesOutlineTouchRect = (coords, rect) => {
  if (!Array.isArray(coords) || coords.length < 6) return false;
  for (let i = 0; i < coords.length; i += 2) {
    if (pointInRect(coords[i], coords[i + 1], rect)) return true;
  }
  const corners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  // The box sits inside the area.
  if (corners.some((corner) => pointInPolygon(corner.x, corner.y, coords))) return true;
  const n = coords.length / 2;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const a = { x: coords[i * 2], y: coords[i * 2 + 1] };
    const b = { x: coords[j * 2], y: coords[j * 2 + 1] };
    for (let k = 0; k < 4; k += 1) {
      if (segmentsCross(a, b, corners[k], corners[(k + 1) % 4])) return true;
    }
  }
  return false;
};

// [{ id, coordinates }] -> the ids the box picks.
export const resolveRegionMarqueeHits = (outlines, rect, direction) => {
  const test = direction === 'crossing' ? doesOutlineTouchRect : isOutlineInsideRect;
  return (Array.isArray(outlines) ? outlines : [])
    .filter((outline) => test(outline.coordinates, rect))
    .map((outline) => outline.id);
};
